/**
 * Central daemon spawn helpers.
 * Each helper spawns a detached background process with log file redirection.
 * Reused from: setup commands, daemon resurrection, and runtime helpers.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getSkillHooksEnv } from "../openclaw/config.js";
import logger from "./logger.js";

import {
  ZG_COMPUTE_DIR,
  ZG_MONITOR_LOG_FILE,
  ZG_MONITOR_PID_FILE,
} from "../0g-compute/constants.js";
import {
  CLAUDE_PROXY_DIR,
  CLAUDE_PROXY_LOG_FILE,
  CLAUDE_PROXY_PID_FILE,
} from "../claude/constants.js";
import {
  BOT_DIR,
  BOT_LOG_FILE,
  BOT_PID_FILE,
  LAUNCHER_DIR,
  LAUNCHER_LOG_FILE,
  LAUNCHER_PID_FILE,
} from "../config/paths.js";
// Agent uses Docker (docker compose up/down), not native daemon spawn.
// See src/commands/echo/agent-cmd.ts for Docker-based control plane.

export interface SpawnResult {
  pid: number;
  logFile: string;
}

export type SpawnOutcome =
  | { status: "spawned"; pid: number; logFile: string }
  | { status: "already_running" }
  | { status: "spawn_failed"; error: string };

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

export function isDaemonAlive(pidFile: string): boolean {
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnDetached(
  args: string[],
  logFile: string,
  logDir: string,
): SpawnResult | null {
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const logFd = openSync(logFile, "a");
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...getSkillHooksEnv(), ECHO_NO_RESURRECT: "1" },
    });

    child.unref();
    closeSync(logFd);

    return child.pid != null ? { pid: child.pid, logFile } : null;
  } catch (err) {
    logger.debug(`Daemon spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Spawn BalanceMonitor from saved state as detached background process.
 * Skips if monitor is already alive.
 */
export function spawnMonitorFromState(): SpawnOutcome {
  if (isDaemonAlive(ZG_MONITOR_PID_FILE)) return { status: "already_running" };

  const args = ["0g-compute", "monitor", "start", "--from-state"];
  const result = spawnDetached(args, ZG_MONITOR_LOG_FILE, ZG_COMPUTE_DIR);
  if (!result) return { status: "spawn_failed", error: "spawn returned no PID" };
  return { status: "spawned", pid: result.pid, logFile: result.logFile };
}

/**
 * Spawn MarketMaker (BotDaemon) as detached background process.
 * Skips if bot is already alive.
 */
export function spawnBotDaemon(): SpawnOutcome {
  if (isDaemonAlive(BOT_PID_FILE)) return { status: "already_running" };

  const args = ["marketmaker", "start"];
  const result = spawnDetached(args, BOT_LOG_FILE, BOT_DIR);
  if (!result) return { status: "spawn_failed", error: "spawn returned no PID" };
  return { status: "spawned", pid: result.pid, logFile: result.logFile };
}

/**
 * Spawn Claude translation proxy as detached background process.
 * Skips if proxy is already alive.
 */
export function spawnClaudeProxy(): SpawnOutcome {
  if (isDaemonAlive(CLAUDE_PROXY_PID_FILE)) return { status: "already_running" };

  const args = ["echo", "claude", "proxy", "--daemon-child"];
  const result = spawnDetached(args, CLAUDE_PROXY_LOG_FILE, CLAUDE_PROXY_DIR);
  if (!result) return { status: "spawn_failed", error: "spawn returned no PID" };
  return { status: "spawned", pid: result.pid, logFile: result.logFile };
}

/**
 * Spawn Launcher dashboard server as detached background process.
 * Skips if launcher is already alive.
 */
export function spawnLauncher(): SpawnOutcome {
  if (isDaemonAlive(LAUNCHER_PID_FILE)) return { status: "already_running" };

  const args = ["echo", "launcher", "--daemon-child"];
  const result = spawnDetached(args, LAUNCHER_LOG_FILE, LAUNCHER_DIR);
  if (!result) return { status: "spawn_failed", error: "spawn returned no PID" };
  return { status: "spawned", pid: result.pid, logFile: result.logFile };
}

// spawnAgent() removed — agent runs via Docker compose, not native daemon.
// See: src/commands/echo/agent-cmd.ts
