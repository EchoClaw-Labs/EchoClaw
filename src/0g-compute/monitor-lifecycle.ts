/**
 * Shared monitor daemon lifecycle helpers.
 * Used by both the standalone wizard and the onboard flow.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  ZG_MONITOR_PID_FILE,
  ZG_MONITOR_SHUTDOWN_FILE,
  ZG_MONITOR_STATE_FILE,
} from "./constants.js";
import { writeStderr } from "../utils/output.js";
import { colors } from "../utils/ui.js";

export interface StopResult {
  stopped: boolean;
  error?: string;
}

/** Read and validate the monitor PID file. Returns the PID or null. */
export function getMonitorPid(): number | null {
  if (!existsSync(ZG_MONITOR_PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(ZG_MONITOR_PID_FILE, "utf-8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    process.kill(pid, 0); // throws if not alive
    return pid;
  } catch {
    return null;
  }
}

/**
 * Check if the running monitor is tracking the given provider address.
 * Returns true only when a monitor is alive AND its state includes the provider.
 */
export function isMonitorTrackingProvider(provider: string): boolean {
  const pid = getMonitorPid();
  if (pid === null) return false;

  if (!existsSync(ZG_MONITOR_STATE_FILE)) return false;
  try {
    const state = JSON.parse(readFileSync(ZG_MONITOR_STATE_FILE, "utf-8")) as {
      providers?: string[];
    };
    const tracked = (state.providers ?? []).map(p => p.toLowerCase());
    return tracked.includes(provider.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Stop an existing monitor daemon.
 * Flow: SIGTERM → poll 5 s → shutdown file → poll 10 s → SIGKILL.
 * Cleans up PID and shutdown files on success.
 */
export async function stopMonitorDaemon(
  opts?: { silent?: boolean },
): Promise<StopResult> {
  if (!existsSync(ZG_MONITOR_PID_FILE)) {
    return { stopped: true }; // nothing to stop
  }

  const raw = readFileSync(ZG_MONITOR_PID_FILE, "utf-8").trim();
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    cleanup();
    return { stopped: true };
  }

  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err: any) {
    if (err?.code !== "ESRCH") {
      return { stopped: false, error: `Cannot manage process ${pid}: ${err?.code ?? err}` };
    }
    // ESRCH = already dead
    cleanup();
    return { stopped: true };
  }

  if (!opts?.silent) {
    writeStderr(colors.muted(`  Stopping existing monitor (PID ${pid})...`));
  }

  // 1. SIGTERM
  try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }

  // 2. Poll up to 5 s (500 ms intervals)
  const deadline1 = Date.now() + 5000;
  while (Date.now() < deadline1) {
    await new Promise(r => setTimeout(r, 500));
    try { process.kill(pid, 0); } catch { alive = false; break; }
  }

  // 3. Shutdown file fallback, poll up to 10 s (1 s intervals)
  if (alive) {
    writeFileSync(ZG_MONITOR_SHUTDOWN_FILE, String(Date.now()), "utf-8");
    const deadline2 = Date.now() + 10000;
    while (Date.now() < deadline2) {
      await new Promise(r => setTimeout(r, 1000));
      try { process.kill(pid, 0); } catch { alive = false; break; }
    }
  }

  // 4. Last resort: SIGKILL
  if (alive) {
    try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 1000));
    try {
      process.kill(pid, 0);
      return { stopped: false, error: `Could not stop monitor (PID ${pid}). Stop it manually.` };
    } catch {
      // dead now
    }
  }

  cleanup();
  return { stopped: true };
}

function cleanup(): void {
  try { unlinkSync(ZG_MONITOR_PID_FILE); } catch { /* ignore */ }
  try { if (existsSync(ZG_MONITOR_SHUTDOWN_FILE)) unlinkSync(ZG_MONITOR_SHUTDOWN_FILE); } catch { /* ignore */ }
}
