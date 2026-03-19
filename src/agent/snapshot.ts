/**
 * Portfolio snapshot builder.
 *
 * Collects balances from all active chains via Khalani + native CLI,
 * calculates total USD, compares with previous snapshot for P&L.
 */

import { execFile } from "node:child_process";
import * as snapshotsRepo from "./db/repos/snapshots.js";
import { query } from "./db/client.js";
import logger from "../utils/logger.js";

interface Position {
  chain: string;
  token: string;
  symbol: string;
  amount: string;
  usdValue: number;
}

/**
 * Take a full portfolio snapshot across all active chains.
 * Calls CLI commands to fetch balances, stores in DB.
 */
export async function takeSnapshot(source = "cron"): Promise<number> {
  const activeChains = await getActiveChains();
  const positions: Position[] = [];

  // EVM balances (0G + any chain agent traded on)
  try {
    const evmResult = await runCli(["khalani", "tokens", "balances", "--wallet", "eip155", "--json"]);
    const evmData = JSON.parse(evmResult);
    if (evmData.success && Array.isArray(evmData.balances)) {
      for (const b of evmData.balances) {
        positions.push({
          chain: b.chainAlias ?? b.chainId ?? "evm",
          token: b.tokenAddress ?? "native",
          symbol: b.symbol ?? "???",
          amount: b.balance ?? "0",
          usdValue: Number(b.usdValue ?? 0),
        });
      }
    }
  } catch (err) {
    logger.warn("snapshot.evm.failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Solana balances
  try {
    const solResult = await runCli(["khalani", "tokens", "balances", "--wallet", "solana", "--json"]);
    const solData = JSON.parse(solResult);
    if (solData.success && Array.isArray(solData.balances)) {
      for (const b of solData.balances) {
        positions.push({
          chain: "solana",
          token: b.tokenAddress ?? b.mint ?? "native",
          symbol: b.symbol ?? "SOL",
          amount: b.balance ?? "0",
          usdValue: Number(b.usdValue ?? 0),
        });
      }
    }
  } catch (err) {
    logger.warn("snapshot.solana.failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // 0G native balance fallback
  try {
    const ogResult = await runCli(["wallet", "balance", "--json"]);
    const ogData = JSON.parse(ogResult);
    if (ogData.success && ogData.balance != null) {
      const existing = positions.find(p => p.chain === "0g" && p.symbol === "0G");
      if (!existing) {
        positions.push({
          chain: "0g", token: "native", symbol: "0G",
          amount: String(ogData.balance), usdValue: Number(ogData.usdValue ?? 0),
        });
      }
    }
  } catch (err) { logger.debug("snapshot.0g_balance.fallback", { error: err instanceof Error ? err.message : String(err) }); }

  const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);

  // Compare with previous
  const prev = await snapshotsRepo.getLatest();
  let pnlVsPrev: number | undefined;
  let pnlPctVsPrev: number | undefined;
  if (prev && prev.totalUsd > 0) {
    pnlVsPrev = totalUsd - prev.totalUsd;
    pnlPctVsPrev = (pnlVsPrev / prev.totalUsd) * 100;
  }

  const id = await snapshotsRepo.insertSnapshot({
    totalUsd, positions, activeChains,
    pnlVsPrev, pnlPctVsPrev, source,
  });

  logger.info("snapshot.captured", { totalUsd: totalUsd.toFixed(2), positions: positions.length, chains: activeChains.length });
  return id;
}

/** Get active chains from trades + defaults. */
async function getActiveChains(): Promise<string[]> {
  const defaults = new Set(["0g", "solana"]);
  try {
    const rows = await query<{ chain: string }>("SELECT DISTINCT chain FROM trades");
    for (const r of rows) defaults.add(r.chain);
  } catch { /* expected: no trades table or rows yet */ }
  return [...defaults];
}

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("echoclaw", [...args], { timeout: 30_000, maxBuffer: 512 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}
