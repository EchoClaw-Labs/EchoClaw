/**
 * Portfolio handlers.
 *
 * GET /api/agent/portfolio — latest snapshot (current state)
 * GET /api/agent/portfolio/history — time-series for chart
 * GET /api/agent/portfolio/chains — active chains with trade counts
 */

import { registerRoute, jsonResponse } from "../routes.js";
import * as snapshotsRepo from "../db/repos/snapshots.js";
import { query } from "../db/client.js";
import { takeSnapshot } from "../snapshot.js";

export function registerPortfolioRoutes(): void {
  // Latest portfolio state
  registerRoute("GET", "/api/agent/portfolio", async (_req, res) => {
    const latest = await snapshotsRepo.getLatest();
    if (!latest) {
      // Take first snapshot on-demand
      await takeSnapshot("manual");
      const fresh = await snapshotsRepo.getLatest();
      jsonResponse(res, 200, fresh ?? { totalUsd: 0, positions: [], activeChains: ["0g", "solana"] });
      return;
    }
    jsonResponse(res, 200, latest);
  });

  // History for P&L chart
  registerRoute("GET", "/api/agent/portfolio/history", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const validRanges = new Set(["24h", "7d", "30d", "all"]);
    const rawRange = url.searchParams.get("range") ?? "24h";
    const range = (validRanges.has(rawRange) ? rawRange : "24h") as "24h" | "7d" | "30d" | "all";
    const snapshots = await snapshotsRepo.getHistory(range);
    jsonResponse(res, 200, { range, snapshots, count: snapshots.length });
  });

  // Active chains with trade counts
  registerRoute("GET", "/api/agent/portfolio/chains", async (_req, res) => {
    const chainStats = await query<{ chain: string; trade_count: string }>(
      "SELECT chain, COUNT(*) AS trade_count FROM trades GROUP BY chain ORDER BY COUNT(*) DESC",
    );

    const activeChains = await snapshotsRepo.getActiveChains();
    const latest = await snapshotsRepo.getLatest();

    // Group positions by chain from latest snapshot
    const chainBalances: Record<string, Array<{ token: string; symbol: string; amount: string; usdValue: number }>> = {};
    if (latest) {
      for (const p of latest.positions) {
        if (!chainBalances[p.chain]) chainBalances[p.chain] = [];
        chainBalances[p.chain].push(p);
      }
    }

    const chains = activeChains.map(chain => ({
      chain,
      tradeCount: parseInt(chainStats.find(c => c.chain === chain)?.trade_count ?? "0", 10),
      totalUsd: (chainBalances[chain] ?? []).reduce((s, p) => s + p.usdValue, 0),
      tokens: chainBalances[chain] ?? [],
    }));

    jsonResponse(res, 200, { chains });
  });
}
