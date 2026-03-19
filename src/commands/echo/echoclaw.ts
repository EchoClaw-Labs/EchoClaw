/**
 * EchoClaw Agent — interactive setup flow.
 *
 * Separate product path from "Connect my AI" (provider skill-link flow).
 * EchoClaw is a local autonomous agent in Docker, not an IDE runtime.
 */

import inquirer from "inquirer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { infoBox, successBox, warnBox } from "../../utils/ui.js";
import { loadProviderDotenv, writeAppEnvValue } from "../../providers/env-resolution.js";
import { checkDocker, formatDockerError } from "../../agent/docker-check.js";
import { AGENT_DIR } from "../../agent/constants.js";
import { AGENT_COMPOSE_FILE, AGENT_PROJECT_NAME, getAgentComposeFailureInfo, getAgentUrl, isAgentRunning, runAgentCompose, waitForAgentHealth } from "../../agent/compose.js";
import { EchoError } from "../../errors.js";
import { ensureAgentPasswordReadyForContainer } from "../../password/compat.js";

const TOKEN_FILE = join(AGENT_DIR, "agent.token");

function formatStartFailure(err: unknown): string {
  if (err instanceof EchoError) {
    return err.hint ? `${err.message}\n\nHint: ${err.hint}` : err.message;
  }
  const failure = getAgentComposeFailureInfo(err, { defaultHint: "Make sure Docker is running and retry." });
  return failure.hint ? `${failure.message}\n\nHint: ${failure.hint}` : failure.message;
}

export async function runInteractiveEchoClaw(): Promise<void> {
  infoBox("EchoClaw Agent", [
    "Autonomous AI trading agent powered by 0G Compute.",
    "Runs locally in Docker on http://localhost:4201.",
    "First start pulls a prebuilt multi-arch agent image matched to your npm package version.",
    "Uses your current wallet and compute provider setup.",
  ].join("\n"));

  // Check Docker
  const docker = checkDocker();
  const dockerError = formatDockerError(docker);
  if (dockerError) {
    warnBox("Docker Required", dockerError);
    return;
  }

  if (!existsSync(AGENT_COMPOSE_FILE)) {
    warnBox("Not Found", "docker-compose.yml not found. Reinstall echoclaw.");
    return;
  }

  // Check if already running
  if (isAgentRunning()) {
    successBox("EchoClaw Agent", `Already running at ${getAgentUrl()}`);
    await promptTavilyKey();
    await openBrowser();
    return;
  }

  // Start agent
  const { start } = await inquirer.prompt([{
    type: "confirm",
    name: "start",
    message: "Start EchoClaw Agent now?",
    default: true,
  }]);

  if (!start) return;

  try {
    loadProviderDotenv();
    ensureAgentPasswordReadyForContainer();
    runAgentCompose(["up", "-d"], {
      stdio: "inherit",
      timeoutMs: 120_000,
    });
  } catch (err) {
    warnBox("Start Failed", formatStartFailure(err));
    return;
  }

  // Wait for health
  const healthy = await waitForAgentHealth();

  if (!healthy) {
    warnBox("EchoClaw Agent", `Containers started but agent not healthy yet.\nCheck: docker compose -p ${AGENT_PROJECT_NAME} logs agent`);
    return;
  }

  successBox("EchoClaw Agent", `Running at ${getAgentUrl()}`);

  // Optional Tavily key
  await promptTavilyKey();

  // Open browser
  await openBrowser();
}

async function promptTavilyKey(): Promise<void> {
  // Check if already configured
  loadProviderDotenv();
  if (process.env.TAVILY_API_KEY) return;

  const { wantSearch } = await inquirer.prompt([{
    type: "confirm",
    name: "wantSearch",
    message: "Enable web search? (optional — 1,000 free/month at tavily.com, no card)",
    default: false,
  }]);

  if (!wantSearch) return;

  const { key } = await inquirer.prompt([{
    type: "input",
    name: "key",
    message: "Tavily API key (get one at https://tavily.com):",
    validate: (val: string) => {
      if (!val.trim()) return true; // allow skip
      if (!val.startsWith("tvly-")) return "Key must start with tvly-";
      if (val.length < 20) return "Key too short";
      return true;
    },
  }]);

  if (!key.trim()) return;

  writeAppEnvValue("TAVILY_API_KEY", key.trim());
  process.env.TAVILY_API_KEY = key.trim();

  // Restart agent to pick up new env
  try {
    runAgentCompose(["restart", "agent"], { stdio: "pipe", timeoutMs: 30_000 });
    successBox("Web Search", "Tavily key saved. Agent restarted with web search enabled.");
  } catch {
    warnBox("Web Search", "Key saved but agent restart failed. Restart manually: echoclaw echo agent start");
  }
}

async function openBrowser(): Promise<void> {
  try {
    const { exec } = await import("node:child_process");
    const { platform } = await import("node:os");
    const url = getAgentUrl();
    const cmd = platform() === "darwin" ? `open "${url}"` : platform() === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  } catch { /* non-fatal */ }
}
