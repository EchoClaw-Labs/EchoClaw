/**
 * Claude management API handlers.
 *
 * Health, config inject/remove/restore, proxy start/stop.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { getClaudeProxyHealth } from "../../commands/echo/claude-health.js";
import { loadConfig } from "../../config/store.js";
import { injectClaudeSettings, removeClaudeSettings, restoreClaudeSettings } from "../../commands/claude/config-cmd.js";
import { spawnClaudeProxy } from "../../utils/daemon-spawn.js";
import { CLAUDE_PROXY_PID_FILE, CLAUDE_PROXY_DIR, CLAUDE_PROXY_STOPPED_FILE } from "../../claude/constants.js";
import logger from "../../utils/logger.js";

// ── GET /api/claude/health ───────────────────────────────────────

const handleHealth: RouteHandler = async (_req, res) => {
  const health = await getClaudeProxyHealth();
  jsonResponse(res, 200, health);
};

// ── POST /api/claude/inject ──────────────────────────────────────

const handleInject: RouteHandler = async (_req, res, params) => {
  const scope = (params.body?.scope as string) ?? "project-local";
  const cfg = loadConfig();
  const result = injectClaudeSettings(cfg, scope);

  jsonResponse(res, 200, {
    phase: "claude", status: "applied",
    summary: `Claude settings injected to ${result.settingsPath}`,
    settingsPath: result.settingsPath, port: result.port,
  });
};

// ── POST /api/claude/remove ──────────────────────────────────────

const handleRemove: RouteHandler = async (_req, res, params) => {
  const scope = (params.body?.scope as string) ?? "project-local";
  const result = removeClaudeSettings(scope);

  jsonResponse(res, 200, {
    phase: "claude", status: "applied",
    summary: result.changed ? "EchoClaw settings removed." : "Nothing to remove.",
    ...result,
  });
};

// ── POST /api/claude/restore ─────────────────────────────────────

const handleRestore: RouteHandler = async (_req, res, params) => {
  const scope = (params.body?.scope as string) ?? "project-local";
  const force = params.body?.force === true;
  const result = restoreClaudeSettings(scope, { force });

  jsonResponse(res, 200, {
    phase: "claude", status: "applied",
    summary: `Settings restored: ${result.path}`,
    ...result,
  });
};

// ── POST /api/claude/proxy/start ─────────────────────────────────

const handleProxyStart: RouteHandler = async (_req, res) => {
  try {
    if (existsSync(CLAUDE_PROXY_STOPPED_FILE)) unlinkSync(CLAUDE_PROXY_STOPPED_FILE);
  } catch { /* ignore */ }

  const result = spawnClaudeProxy();
  if (result.status === "already_running") {
    jsonResponse(res, 200, { phase: "claude", status: "applied", summary: "Proxy already running." });
    return;
  }
  if (result.status === "spawn_failed") {
    errorResponse(res, 500, "CLAUDE_PROXY_START_FAILED", `Failed: ${result.error}`);
    return;
  }

  logger.info(`[launcher] Claude proxy started (PID ${result.pid})`);
  jsonResponse(res, 200, {
    phase: "claude", status: "applied",
    summary: `Proxy started (PID ${result.pid})`,
    pid: result.pid, logFile: result.logFile,
  });
};

// ── POST /api/claude/proxy/stop ──────────────────────────────────

const handleProxyStop: RouteHandler = async (_req, res) => {
  if (!existsSync(CLAUDE_PROXY_PID_FILE)) {
    errorResponse(res, 400, "CLAUDE_PROXY_NOT_RUNNING", "Proxy is not running.");
    return;
  }

  const pid = parseInt(readFileSync(CLAUDE_PROXY_PID_FILE, "utf-8").trim(), 10);
  try { process.kill(pid, 0); } catch {
    unlinkSync(CLAUDE_PROXY_PID_FILE);
    errorResponse(res, 400, "CLAUDE_PROXY_NOT_RUNNING", `Stale PID ${pid}.`);
    return;
  }

  try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    try { process.kill(pid, 0); } catch {
      try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* */ }
      if (!existsSync(CLAUDE_PROXY_DIR)) mkdirSync(CLAUDE_PROXY_DIR, { recursive: true });
      writeFileSync(CLAUDE_PROXY_STOPPED_FILE, String(Date.now()), "utf-8");
      jsonResponse(res, 200, { phase: "claude", status: "applied", summary: `Proxy stopped (PID ${pid}).`, pid });
      return;
    }
  }

  try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
  try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* */ }

  logger.warn(`[launcher] Claude proxy force-killed (PID ${pid})`);
  jsonResponse(res, 200, { phase: "claude", status: "applied", summary: `Proxy force-killed (PID ${pid}).`, pid, method: "SIGKILL" });
};

// ── Registration ─────────────────────────────────────────────────

export function registerClaudeRoutes(): void {
  registerRoute("GET", "/api/claude/health", handleHealth);
  registerRoute("POST", "/api/claude/inject", handleInject);
  registerRoute("POST", "/api/claude/remove", handleRemove);
  registerRoute("POST", "/api/claude/restore", handleRestore);
  registerRoute("POST", "/api/claude/proxy/start", handleProxyStart);
  registerRoute("POST", "/api/claude/proxy/stop", handleProxyStop);
}
