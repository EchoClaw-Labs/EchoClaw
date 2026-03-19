/**
 * Compute billing — reads real ledger balance on-chain, tracks burn rate.
 *
 * Uses existing operations.ts (getLedgerBalance, getSubAccountBalance)
 * to read actual on-chain data. Caches to avoid excessive RPC calls.
 */

import { getAuthenticatedBroker } from "../0g-compute/broker-factory.js";
import { getLedgerBalance, getSubAccountBalance } from "../0g-compute/operations.js";
import * as billingRepo from "./db/repos/billing.js";
import * as usageRepo from "./db/repos/usage.js";
import { retryWithBackoff } from "./resilience.js";
import type { LedgerBalance, InferenceConfig } from "./types.js";
import logger from "../utils/logger.js";

const CACHE_TTL_MS = 30_000; // 30s — avoid excessive on-chain reads

let cachedBalance: LedgerBalance | null = null;
let cachedAt = 0;

/**
 * Fetch current ledger balance (cached 30s).
 */
export async function getLedgerState(provider: string): Promise<LedgerBalance | null> {
  const now = Date.now();
  if (cachedBalance && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedBalance;
  }

  try {
    const broker = await getAuthenticatedBroker();
    const ledger = await retryWithBackoff(
      () => getLedgerBalance(broker),
      { maxRetries: 2, baseDelayMs: 1000 },
      "ledger",
    );
    const subAccount = await retryWithBackoff(
      () => getSubAccountBalance(broker, provider),
      { maxRetries: 2, baseDelayMs: 1000 },
      "ledger-sub",
    );

    if (!ledger) return null;

    cachedBalance = {
      ledgerTotalOg: ledger.totalOg,
      ledgerAvailableOg: ledger.availableOg,
      providerLockedOg: subAccount?.lockedOg ?? 0,
      providerPendingRefundOg: subAccount?.pendingRefundOg ?? 0,
      fetchedAt: new Date().toISOString(),
    };
    cachedAt = now;

    return cachedBalance;
  } catch (err) {
    logger.warn("billing.ledger.read_failed", { error: err instanceof Error ? err.message : String(err) });
    return cachedBalance; // return stale cache if available
  }
}

/**
 * Record a billing snapshot after each inference request.
 */
export async function recordBillingSnapshot(provider: string, sessionBurnOg: number): Promise<void> {
  const balance = await getLedgerState(provider);
  if (!balance) return;

  await billingRepo.insertSnapshot({
    ledgerTotalOg: balance.ledgerTotalOg,
    ledgerAvailableOg: balance.ledgerAvailableOg,
    providerLockedOg: balance.providerLockedOg,
    sessionBurnOg,
  });
}

/**
 * Check if balance is below alert threshold.
 */
export function isLowBalance(balance: LedgerBalance, config: InferenceConfig): boolean {
  return balance.providerLockedOg < config.alertThresholdOg;
}

export interface BillingState {
  ledgerTotalOg: number;
  ledgerAvailableOg: number;
  providerLockedOg: number;
  sessionBurnOg: number;
  lifetimeBurnOg: number;
  avgCostPerRequest: number;
  estimatedRequestsRemaining: number;
  lowBalanceThreshold: number;
  isLowBalance: boolean;
  model: string;
  pricing: { inputPerM: string; outputPerM: string };
  fetchedAt: string;
}

/**
 * Build full billing state for API response.
 */
export async function getBillingState(config: InferenceConfig, sessionId?: string): Promise<BillingState> {
  const balance = await getLedgerState(config.provider);
  const usage = await usageRepo.getUsageStats(sessionId);

  const avgCost = usage.requestCount > 0 ? usage.lifetimeCost / usage.requestCount : 0;
  const lockedOg = balance?.providerLockedOg ?? 0;
  const estimatedRemaining = avgCost > 0 ? Math.floor(lockedOg / avgCost) : 0;

  return {
    ledgerTotalOg: balance?.ledgerTotalOg ?? 0,
    ledgerAvailableOg: balance?.ledgerAvailableOg ?? 0,
    providerLockedOg: lockedOg,
    sessionBurnOg: usage.sessionCost,
    lifetimeBurnOg: usage.lifetimeCost,
    avgCostPerRequest: avgCost,
    estimatedRequestsRemaining: estimatedRemaining,
    lowBalanceThreshold: config.alertThresholdOg,
    isLowBalance: balance ? isLowBalance(balance, config) : false,
    model: config.model,
    pricing: {
      inputPerM: config.inputPricePerM.toFixed(4),
      outputPerM: config.outputPricePerM.toFixed(4),
    },
    fetchedAt: balance?.fetchedAt ?? new Date().toISOString(),
  };
}
