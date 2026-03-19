/**
 * Pure function trigger evaluation — no side effects.
 * Each trigger type checks conditions against a TokenUpdatePayload.
 */

import type { Trigger, TokenUpdatePayload, BotOrder } from "./types.js";

export interface TriggerResult {
  fired: boolean;
  reason?: string;
}

/**
 * Evaluate whether a trigger fires for a given token update.
 *
 * Anti-duplicate: onNewBuy/onNewSell check lastProcessedTxHash on the order
 * to prevent re-firing on the same trade.
 */
export function evaluateTrigger(
  trigger: Trigger,
  update: TokenUpdatePayload,
  order: BotOrder
): TriggerResult {
  switch (trigger.type) {
    case "onNewBuy":
      return evaluateOnNewBuy(trigger, update, order);
    case "onNewSell":
      return evaluateOnNewSell(trigger, update, order);
    case "priceAbove":
      return evaluatePriceAbove(trigger, update);
    case "priceBelow":
      return evaluatePriceBelow(trigger, update);
    case "bondingProgressAbove":
      return evaluateBondingProgressAbove(trigger, update);
    default:
      return { fired: false };
  }
}

function evaluateOnNewBuy(
  trigger: Extract<Trigger, { type: "onNewBuy" }>,
  update: TokenUpdatePayload,
  order: BotOrder
): TriggerResult {
  const trade = update.lastTrade;
  if (!trade) return { fired: false };
  if (trade.tx_type !== "buy") return { fired: false };

  // Anti-duplicate: skip if already processed this tx
  if (trade.tx_hash === order.lastProcessedTxHash) return { fired: false };

  // Ignore own wallet trades
  if (trigger.ignoreWallet && trade.wallet_address.toLowerCase() === trigger.ignoreWallet.toLowerCase()) {
    return { fired: false };
  }

  // Min amount filter
  if (trigger.minAmountOg !== undefined && trade.amount_og < trigger.minAmountOg) {
    return { fired: false };
  }

  return {
    fired: true,
    reason: `New buy: ${trade.amount_og} 0G by ${trade.wallet_address.slice(0, 10)}.. (tx: ${trade.tx_hash.slice(0, 10)}..)`,
  };
}

function evaluateOnNewSell(
  trigger: Extract<Trigger, { type: "onNewSell" }>,
  update: TokenUpdatePayload,
  order: BotOrder
): TriggerResult {
  const trade = update.lastTrade;
  if (!trade) return { fired: false };
  if (trade.tx_type !== "sell") return { fired: false };

  if (trade.tx_hash === order.lastProcessedTxHash) return { fired: false };

  if (trigger.ignoreWallet && trade.wallet_address.toLowerCase() === trigger.ignoreWallet.toLowerCase()) {
    return { fired: false };
  }

  if (trigger.minAmountOg !== undefined && trade.amount_og < trigger.minAmountOg) {
    return { fired: false };
  }

  return {
    fired: true,
    reason: `New sell: ${trade.amount_og} 0G by ${trade.wallet_address.slice(0, 10)}.. (tx: ${trade.tx_hash.slice(0, 10)}..)`,
  };
}

function evaluatePriceAbove(
  trigger: Extract<Trigger, { type: "priceAbove" }>,
  update: TokenUpdatePayload
): TriggerResult {
  if (update.price >= trigger.threshold) {
    return {
      fired: true,
      reason: `Price ${update.price} >= threshold ${trigger.threshold}`,
    };
  }
  return { fired: false };
}

function evaluatePriceBelow(
  trigger: Extract<Trigger, { type: "priceBelow" }>,
  update: TokenUpdatePayload
): TriggerResult {
  if (update.price <= trigger.threshold) {
    return {
      fired: true,
      reason: `Price ${update.price} <= threshold ${trigger.threshold}`,
    };
  }
  return { fired: false };
}

function evaluateBondingProgressAbove(
  trigger: Extract<Trigger, { type: "bondingProgressAbove" }>,
  update: TokenUpdatePayload
): TriggerResult {
  if (update.bondingProgress >= trigger.threshold) {
    return {
      fired: true,
      reason: `Bonding progress ${update.bondingProgress.toFixed(1)}% >= threshold ${trigger.threshold.toFixed(1)}%`,
    };
  }
  return { fired: false };
}
