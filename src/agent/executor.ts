/**
 * CLI command executor for the Echo Agent.
 *
 * Spawns echoclaw CLI processes, captures output, enforces timeouts.
 * Pass-through: model constructs CLI args from SKILL.md reference docs.
 * --json ensured for output parsing. --yes ensured after user approval.
 */

import { execFile } from "node:child_process";
import { DEFAULT_TOOL_TIMEOUT_MS, ONCHAIN_TOOL_TIMEOUT_MS } from "./constants.js";
import { isMutating, supportsYes } from "./tool-registry.js";
import type { ToolCall, ToolResult } from "./types.js";
import logger from "../utils/logger.js";

/** Flags whose values must never appear in logs. */
const REDACTED_FLAGS = new Set([
  "--private-key", "--privateKey", "--secret", "--password", "--passphrase",
  "--token", "--api-key", "--apiKey", "--mnemonic", "--seed",
]);

let nextToolId = 1;

function generateToolId(): string {
  return `tool-${nextToolId++}`;
}

/** Redact sensitive flag values from CLI args for safe logging. */
export function redactArgs(args: string[]): string {
  const safe: string[] = [];
  for (let i = 0; i < args.length; i++) {
    safe.push(args[i]);
    if (REDACTED_FLAGS.has(args[i]) && i + 1 < args.length) {
      safe.push("[REDACTED]");
      i++;
    }
  }
  return safe.join(" ");
}

/**
 * Split a CLI args string respecting quoted substrings.
 * Handles both single and double quotes.
 *
 * "SOL USDC --amount 1" → ["SOL", "USDC", "--amount", "1"]
 * '--prompt "a futuristic city" --json' → ["--prompt", "a futuristic city", "--json"]
 */
export function shellSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Build CLI argument array from command + args.
 *
 * Pass-through: model constructs full CLI args from SKILL.md reference docs.
 * --json ensured for output parsing. --yes ensured after explicit user approval.
 */
function buildCliArgs(
  command: string,
  args: Record<string, string | boolean | number>,
  confirmed: boolean,
): string[] {
  const parts = command.replace(/_/g, " ").split(/\s+/);

  if (typeof args.args === "string" && args.args.trim()) {
    parts.push(...shellSplit(args.args));
  }

  if (!parts.includes("--json")) parts.push("--json");
  // Ensure --yes only for commands that actually declare the flag
  if (confirmed && supportsYes(command) && !parts.includes("--yes")) parts.push("--yes");

  return parts;
}

function getTimeout(command: string): number {
  return isMutating(command) ? ONCHAIN_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS;
}

/**
 * Execute a tool call by spawning echoclaw CLI.
 */
export function executeTool(call: ToolCall, confirmed: boolean): Promise<ToolResult> {
  const id = generateToolId();
  const args = buildCliArgs(call.command, call.args, confirmed && call.confirm);
  const timeout = getTimeout(call.command);
  const startTime = Date.now();

  logger.info("agent.tool.execute", { command: call.command, confirmed: confirmed && call.confirm });
  logger.debug("agent.tool.args", { command: call.command, args: `echoclaw ${redactArgs(args)}` });

  return new Promise((resolve) => {
    execFile("echoclaw", args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;

      if (error) {
        const isTimeout = error.killed || error.code === "ETIMEDOUT";
        const errorOutput = isTimeout
          ? `Command timed out after ${timeout}ms`
          : stderr.trim() || stdout.trim() || error.message;

        logger.warn("agent.tool.failed", { command: call.command, durationMs, error: errorOutput.slice(0, 200) });
        resolve({ id, command: call.command, success: false, output: errorOutput, durationMs });
        return;
      }

      const output = stdout.trim();
      logger.debug("agent.tool.ok", { command: call.command, durationMs, output: output.slice(0, 100) });
      resolve({ id, command: call.command, success: true, output, durationMs });
    });
  });
}

/**
 * Check if a command is a mutating operation that should require confirmation.
 */
export function isMutatingCommand(command: string): boolean {
  return isMutating(command);
}
