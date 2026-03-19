/**
 * Loop state repo — persists loop engine lifecycle in DB.
 */

import { queryOne, execute } from "../client.js";
import type { LoopState } from "../../types.js";

export async function getLoopState(): Promise<LoopState> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT active, mode, interval_ms, started_at, last_cycle_at, cycle_count FROM loop_state WHERE id = 1",
  );
  if (!row) return { active: false, mode: "restricted", intervalMs: 300_000, startedAt: null, lastCycleAt: null, cycleCount: 0 };
  return {
    active: row.active as boolean,
    mode: row.mode as LoopState["mode"],
    intervalMs: row.interval_ms as number,
    startedAt: row.started_at as string | null,
    lastCycleAt: row.last_cycle_at as string | null,
    cycleCount: row.cycle_count as number,
  };
}

export async function startLoop(mode: "full" | "restricted", intervalMs = 300_000): Promise<void> {
  await execute(
    "UPDATE loop_state SET active = TRUE, mode = $1, interval_ms = $2, started_at = NOW() WHERE id = 1",
    [mode, intervalMs],
  );
}

export async function stopLoop(): Promise<void> {
  await execute("UPDATE loop_state SET active = FALSE WHERE id = 1");
}

export async function recordCycle(): Promise<void> {
  await execute("UPDATE loop_state SET last_cycle_at = NOW(), cycle_count = cycle_count + 1 WHERE id = 1");
}
