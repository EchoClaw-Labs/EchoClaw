/**
 * Portfolio snapshots repo — time-series of portfolio state.
 */

import { query, queryOne, execute } from "../client.js";

export interface PortfolioSnapshot {
  id: number;
  timestamp: string;
  totalUsd: number;
  positions: Array<{ chain: string; token: string; symbol: string; amount: string; usdValue: number }>;
  activeChains: string[];
  pnlVsPrev: number | null;
  pnlPctVsPrev: number | null;
  snapshotSource: string;
}

export async function insertSnapshot(snapshot: {
  totalUsd: number;
  positions: PortfolioSnapshot["positions"];
  activeChains: string[];
  pnlVsPrev?: number;
  pnlPctVsPrev?: number;
  source?: string;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO portfolio_snapshots (total_usd, positions, active_chains, pnl_vs_prev, pnl_pct_vs_prev, snapshot_source)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [snapshot.totalUsd, JSON.stringify(snapshot.positions), snapshot.activeChains,
     snapshot.pnlVsPrev ?? null, snapshot.pnlPctVsPrev ?? null, snapshot.source ?? "cron"],
  );
  return rows[0]?.id ?? 0;
}

export async function getLatest(): Promise<PortfolioSnapshot | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1",
  );
  return row ? rowToSnapshot(row) : null;
}

export async function getHistory(range: "24h" | "7d" | "30d" | "all" = "24h"): Promise<PortfolioSnapshot[]> {
  const intervals: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "all": "100 years" };
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM portfolio_snapshots WHERE timestamp > NOW() - INTERVAL '${intervals[range]}' ORDER BY timestamp ASC`,
  );
  return rows.map(rowToSnapshot);
}

export async function getActiveChains(): Promise<string[]> {
  const row = await queryOne<{ chains: string[] }>(
    "SELECT active_chains AS chains FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1",
  );
  return row?.chains ?? ["0g", "solana"];
}

function rowToSnapshot(r: Record<string, unknown>): PortfolioSnapshot {
  return {
    id: r.id as number, timestamp: r.timestamp as string, totalUsd: Number(r.total_usd),
    positions: r.positions as PortfolioSnapshot["positions"], activeChains: r.active_chains as string[],
    pnlVsPrev: r.pnl_vs_prev != null ? Number(r.pnl_vs_prev) : null,
    pnlPctVsPrev: r.pnl_pct_vs_prev != null ? Number(r.pnl_pct_vs_prev) : null,
    snapshotSource: r.snapshot_source as string,
  };
}
