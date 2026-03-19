/**
 * Unified daemon resurrection — checks all registered daemons and
 * respawns them if they should be running but aren't.
 *
 * Called from cli.ts preAction hook — MUST be non-blocking and never throw.
 */

import { existsSync, readFileSync } from "node:fs";
import logger from "./logger.js";

export interface DaemonResurrectConfig {
  name: string;
  pidFile: string;
  shouldBeRunning: () => boolean;
  resurrect: () => void;
}

function isDaemonAlive(pidFile: string): boolean {
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check all registered daemons, resurrect if needed.
 * Logic: if shouldBeRunning() && !alive → spawn. No exceptions.
 */
export function maybeResurrectDaemons(configs: DaemonResurrectConfig[]): void {
  for (const cfg of configs) {
    try {
      if (isDaemonAlive(cfg.pidFile)) continue;
      if (!cfg.shouldBeRunning()) continue;
      logger.debug(`[Resurrect] ${cfg.name} not running, respawning...`);
      const outcome = cfg.resurrect() as any;
      if (outcome && typeof outcome === "object" && "status" in outcome) {
        logger.debug(`[Resurrect] ${cfg.name}: ${outcome.status}`);
      }
    } catch {
      // Never let resurrection failure break the CLI
    }
  }
}
