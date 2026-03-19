/**
 * Pricing heuristics for 0G Compute providers.
 *
 * SDK prices (`inputPrice`, `outputPrice`) are **per-token in neuron**
 * (1 0G = 10^18 neuron).  The CLI needs to:
 *   1. Display prices as "per 1M tokens" (human-readable).
 *   2. Compute a recommended minimum locked balance per provider.
 *
 * Upstream SDK constants for reference:
 *   topUpTriggerThreshold = 1_000_000   (tokens)
 *   topUpTargetThreshold  = 2_000_000   (tokens)
 */

import { formatUnits } from "ethers";

// ── Constants ────────────────────────────────────────────────────────

/** Default token budget — matches upstream `topUpTargetThreshold`. */
export const DEFAULT_TOKEN_BUDGET = 2_000_000n;

/** Alert when locked balance < recommendedMin * alertRatio. */
export const DEFAULT_ALERT_RATIO = 1.2;

/** Minimum recommended locked balance in 0G — floor to avoid tiny values. */
const MIN_RECOMMENDED_OG = 1.0;

// ── ProviderPricing ──────────────────────────────────────────────────

export interface ProviderPricing {
  /** Recommended minimum locked balance in 0G. */
  recommendedMinLockedOg: number;
  /** Alert threshold: balance below this triggers a warning. */
  recommendedAlertLockedOg: number;
  /** Cost (neuron) for the given token budget. */
  costNeuron: bigint;
}

/**
 * Calculate recommended locked balance for a provider.
 *
 * Formula (mirrors upstream SDK top-up logic):
 * ```
 * costNeuron = tokenBudget * (inputPrice + outputPrice)
 * recommendedMinLockedOg = max(1.0, formatUnits(costNeuron, 18))
 * recommendedAlertLockedOg = recommendedMinLockedOg * alertRatio
 * ```
 */
export function calculateProviderPricing(
  inputPriceNeuron: bigint,
  outputPriceNeuron: bigint,
  tokenBudget: bigint = DEFAULT_TOKEN_BUDGET,
  alertRatio: number = DEFAULT_ALERT_RATIO,
): ProviderPricing {
  const costNeuron = tokenBudget * (inputPriceNeuron + outputPriceNeuron);
  const costOg = parseFloat(formatUnits(costNeuron, 18));

  const recommendedMinLockedOg = Math.max(MIN_RECOMMENDED_OG, costOg);
  const recommendedAlertLockedOg = recommendedMinLockedOg * alertRatio;

  return {
    recommendedMinLockedOg,
    recommendedAlertLockedOg,
    costNeuron,
  };
}

// ── Display helpers ──────────────────────────────────────────────────

/**
 * Format a per-token neuron price as "X.XXXX 0G/M tokens".
 *
 * SDK prices are **per single token**.  To get per-1M-tokens:
 * `pricePerM = priceNeuron * 1_000_000`.
 */
export function formatPricePerMTokens(priceNeuron: bigint): string {
  const perM = priceNeuron * 1_000_000n;
  return formatUnits(perM, 18);
}
