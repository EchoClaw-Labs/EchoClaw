/**
 * Daemon management API handlers.
 *
 * Status, start, stop for: proxy, monitor, bot, launcher.
 * Reuses existing daemon-spawn and PID utilities.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import type { RouteHandler, DaemonStatus, DaemonsResponse } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { isDaemonAlive, spawnMonitorFromState, spawnBotDaemon, spawnClaudeProxy } from "../../utils/daemon-spawn.js";
import { CLAUDE_PROXY_PID_FILE, CLAUDE_PROXY_DIR, CLAUDE_PROXY_STOPPED_FILE } from "../../claude/constants.js";
import { ZG_MONITOR_PID_FILE, ZG_COMPUTE_DIR } from "../../0g-compute/constants.js";
import { BOT_PID_FILE, BOT_DIR, BOT_STOPPED_FILE } from "../../config/paths.js";
import logger from "../../utils/logger.js";

// ── Daemon registry ──────────────────────────────────────────────

interface DaemonEntry {
  name: string;
  pidFile: string;
  dir: string;
  stoppedFile: string;
  spawn: () => ReturnType<typeof spawnClaudeProxy>;
}

const DAEMONS: Record<string, DaemonEntry> = {
  proxy: {
    name: "proxy",
    pidFile: CLAUDE_PROXY_PID_FILE,
    dir: CLAUDE_PROXY_DIR,
    stoppedFile: CLAUDE_PROXY_STOPPED_FILE,
    spawn: spawnClaudeProxy,
  },
  monitor: {
    name: "monitor",
    pidFile: ZG_MONITOR_PID_FILE,
    dir: ZG_COMPUTE_DIR,
    stoppedFile: "", // monitor uses its own stopped file
    spawn: spawnMonitorFromState,
  },
  bot: {
    name: "bot",
    pidFile: BOT_PID_FILE,
    dir: BOT_DIR,
    stoppedFile: BOT_STOPPED_FILE,
    spawn: spawnBotDaemon,
  },
};

function getDaemonPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function buildDaemonStatus(entry: DaemonEntry): DaemonStatus {
  const pid = getDaemonPid(entry.pidFile);
  return { name: entry.name, running: pid !== null, pid };
}

// ── GET /api/daemons ─────────────────────────────────────────────

const handleList: RouteHandler = async (_req, res) => {
  const daemons = Object.values(DAEMONS).map(buildDaemonStatus);
  const response: DaemonsResponse = { daemons };
  jsonResponse(res, 200, response);
};

// ── POST /api/daemons/:name/start ────────────────────────────────

const handleStart: RouteHandler = async (_req, res, params) => {
  const name = params.segments.name;
  const entry = DAEMONS[name];

  if (!entry) {
    errorResponse(res, 404, "DAEMON_NOT_FOUND", `Unknown daemon: ${name}. Available: ${Object.keys(DAEMONS).join(", ")}`);
    return;
  }

  // Clear stopped marker
  if (entry.stoppedFile) {
    try {
      if (existsSync(entry.stoppedFile)) unlinkSync(entry.stoppedFile);
    } catch { /* ignore */ }
  }

  const result = entry.spawn();

  if (result.status === "already_running") {
    jsonResponse(res, 200, { status: "already_running", name });
    return;
  }

  if (result.status === "spawn_failed") {
    errorResponse(res, 500, "DAEMON_SPAWN_FAILED", `Failed to start ${name}: ${result.error}`);
    return;
  }

  logger.info(`[launcher] daemon started: ${name} (PID ${result.pid})`);
  jsonResponse(res, 200, { status: "spawned", name, pid: result.pid, logFile: result.logFile });
};

// ── POST /api/daemons/:name/stop ─────────────────────────────────

const STOP_TIMEOUT_MS = 5000;
const STOP_POLL_MS = 500;

const handleStop: RouteHandler = async (_req, res, params) => {
  const name = params.segments.name;
  const entry = DAEMONS[name];

  if (!entry) {
    errorResponse(res, 404, "DAEMON_NOT_FOUND", `Unknown daemon: ${name}`);
    return;
  }

  const pid = getDaemonPid(entry.pidFile);
  if (pid === null) {
    errorResponse(res, 400, "DAEMON_NOT_RUNNING", `${name} is not running`);
    return;
  }

  // SIGTERM
  try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }

  // Poll for exit
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, STOP_POLL_MS));
    try {
      process.kill(pid, 0);
    } catch {
      // Exited
      try { if (existsSync(entry.pidFile)) unlinkSync(entry.pidFile); } catch { /* ignore */ }
      if (entry.stoppedFile) {
        if (!existsSync(entry.dir)) mkdirSync(entry.dir, { recursive: true });
        writeFileSync(entry.stoppedFile, String(Date.now()), "utf-8");
      }
      logger.info(`[launcher] daemon stopped: ${name} (PID ${pid})`);
      jsonResponse(res, 200, { status: "stopped", name, pid });
      return;
    }
  }

  // SIGKILL fallback
  try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
  try { if (existsSync(entry.pidFile)) unlinkSync(entry.pidFile); } catch { /* ignore */ }
  if (entry.stoppedFile) {
    if (!existsSync(entry.dir)) mkdirSync(entry.dir, { recursive: true });
    writeFileSync(entry.stoppedFile, String(Date.now()), "utf-8");
  }

  logger.warn(`[launcher] daemon force-killed: ${name} (PID ${pid})`);
  jsonResponse(res, 200, { status: "killed", name, pid, method: "SIGKILL" });
};

// ── Registration ─────────────────────────────────────────────────

export function registerDaemonRoutes(): void {
  registerRoute("GET", "/api/daemons", handleList);
  registerRoute("POST", "/api/daemons/:name/start", handleStart);
  registerRoute("POST", "/api/daemons/:name/stop", handleStop);
}
