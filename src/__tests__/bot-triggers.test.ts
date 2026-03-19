import { describe, it, expect } from "vitest";
import { evaluateTrigger } from "../bot/triggers.js";
import type { TokenUpdatePayload, BotOrder, Trigger } from "../bot/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeUpdate(overrides: Partial<TokenUpdatePayload> = {}): TokenUpdatePayload {
  return {
    address: "0xabc",
    name: "TestToken",
    symbol: "TT",
    description: "",
    imageUrl: "",
    creatorAddress: "0xcreator",
    createdAt: 1000,
    price: 0.001,
    marketCap: 1000,
    priceChange24h: 0,
    volume24h: 0,
    holders: 10,
    bondingProgress: 50,
    status: "active",
    liquidity: 100,
    trades24h: 5,
    totalSupply: 1_000_000,
    ranks: {},
    ...overrides,
  };
}

function makeOrder(overrides: Partial<BotOrder> = {}): BotOrder {
  return {
    id: "test-order-1",
    token: "0xabc" as `0x${string}`,
    side: "buy",
    trigger: { type: "onNewBuy" },
    size: { mode: "absolute", amountOg: "1" },
    slippageBps: 100,
    cooldownMs: 5000,
    state: "armed",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("evaluateTrigger", () => {
  // ── onNewBuy ────────────────────────────────────────────────────

  describe("onNewBuy", () => {
    const trigger: Trigger = { type: "onNewBuy" };

    it("fires when lastTrade is buy + tx_hash differs from lastProcessedTxHash", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "buy",
          wallet_address: "0xbuyer",
          amount_og: 5,
          amount_token: 1000,
          price_per_token: 0.005,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger, lastProcessedTxHash: "0xoldtx" });
      const result = evaluateTrigger(trigger, update, order);
      expect(result.fired).toBe(true);
      expect(result.reason).toContain("New buy");
    });

    it("does NOT fire when no lastTrade", () => {
      const update = makeUpdate({ lastTrade: undefined });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("does NOT fire when lastTrade is sell", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xtx",
          tx_type: "sell",
          wallet_address: "0xseller",
          amount_og: 1,
          amount_token: 100,
          price_per_token: 0.01,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("does NOT fire when tx_hash === lastProcessedTxHash (anti-duplicate)", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xsametx",
          tx_type: "buy",
          wallet_address: "0xbuyer",
          amount_og: 5,
          amount_token: 1000,
          price_per_token: 0.005,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger, lastProcessedTxHash: "0xsametx" });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("does NOT fire when wallet === ignoreWallet", () => {
      const triggerWithIgnore: Trigger = {
        type: "onNewBuy",
        ignoreWallet: "0xMyWallet" as `0x${string}`,
      };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "buy",
          wallet_address: "0xmywallet", // lowercase match
          amount_og: 5,
          amount_token: 1000,
          price_per_token: 0.005,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithIgnore });
      expect(evaluateTrigger(triggerWithIgnore, update, order).fired).toBe(false);
    });

    it("does NOT fire when amount_og < minAmountOg", () => {
      const triggerWithMin: Trigger = { type: "onNewBuy", minAmountOg: 10 };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "buy",
          wallet_address: "0xbuyer",
          amount_og: 5,
          amount_token: 1000,
          price_per_token: 0.005,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithMin });
      expect(evaluateTrigger(triggerWithMin, update, order).fired).toBe(false);
    });

    it("fires when amount_og >= minAmountOg", () => {
      const triggerWithMin: Trigger = { type: "onNewBuy", minAmountOg: 5 };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "buy",
          wallet_address: "0xbuyer",
          amount_og: 5,
          amount_token: 1000,
          price_per_token: 0.005,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithMin });
      expect(evaluateTrigger(triggerWithMin, update, order).fired).toBe(true);
    });
  });

  // ── onNewSell ───────────────────────────────────────────────────

  describe("onNewSell", () => {
    const trigger: Trigger = { type: "onNewSell" };

    it("fires on sell trade", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "sell",
          wallet_address: "0xseller",
          amount_og: 3,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger, lastProcessedTxHash: "0xoldtx" });
      const result = evaluateTrigger(trigger, update, order);
      expect(result.fired).toBe(true);
      expect(result.reason).toContain("New sell");
    });

    it("does NOT fire on buy trade", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "buy",
          wallet_address: "0xbuyer",
          amount_og: 3,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("does NOT fire when tx_hash === lastProcessedTxHash (anti-duplicate)", () => {
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xsametx",
          tx_type: "sell",
          wallet_address: "0xseller",
          amount_og: 3,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger, lastProcessedTxHash: "0xsametx" });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("does NOT fire when wallet === ignoreWallet", () => {
      const triggerWithIgnore: Trigger = {
        type: "onNewSell",
        ignoreWallet: "0xMyWallet" as `0x${string}`,
      };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "sell",
          wallet_address: "0xmywallet",
          amount_og: 3,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithIgnore });
      expect(evaluateTrigger(triggerWithIgnore, update, order).fired).toBe(false);
    });

    it("does NOT fire when amount_og < minAmountOg", () => {
      const triggerWithMin: Trigger = { type: "onNewSell", minAmountOg: 10 };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "sell",
          wallet_address: "0xseller",
          amount_og: 5,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithMin });
      expect(evaluateTrigger(triggerWithMin, update, order).fired).toBe(false);
    });

    it("fires when amount_og >= minAmountOg", () => {
      const triggerWithMin: Trigger = { type: "onNewSell", minAmountOg: 3 };
      const update = makeUpdate({
        lastTrade: {
          tx_hash: "0xnewtx",
          tx_type: "sell",
          wallet_address: "0xseller",
          amount_og: 3,
          amount_token: 500,
          price_per_token: 0.006,
          timestamp_ms: Date.now(),
        },
      });
      const order = makeOrder({ trigger: triggerWithMin });
      expect(evaluateTrigger(triggerWithMin, update, order).fired).toBe(true);
    });
  });

  // ── priceAbove ──────────────────────────────────────────────────

  describe("priceAbove", () => {
    const trigger: Trigger = { type: "priceAbove", threshold: 0.005 };

    it("fires when price >= threshold", () => {
      const update = makeUpdate({ price: 0.006 });
      const order = makeOrder({ trigger });
      const result = evaluateTrigger(trigger, update, order);
      expect(result.fired).toBe(true);
      expect(result.reason).toContain(">=");
    });

    it("does NOT fire when price < threshold", () => {
      const update = makeUpdate({ price: 0.004 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("fires at exact threshold (boundary)", () => {
      const update = makeUpdate({ price: 0.005 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(true);
    });
  });

  // ── priceBelow ──────────────────────────────────────────────────

  describe("priceBelow", () => {
    const trigger: Trigger = { type: "priceBelow", threshold: 0.005 };

    it("fires when price <= threshold", () => {
      const update = makeUpdate({ price: 0.004 });
      const order = makeOrder({ trigger });
      const result = evaluateTrigger(trigger, update, order);
      expect(result.fired).toBe(true);
      expect(result.reason).toContain("<=");
    });

    it("does NOT fire when price > threshold", () => {
      const update = makeUpdate({ price: 0.006 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("fires at exact threshold (boundary)", () => {
      const update = makeUpdate({ price: 0.005 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(true);
    });
  });

  // ── bondingProgressAbove ────────────────────────────────────────

  describe("bondingProgressAbove", () => {
    const trigger: Trigger = { type: "bondingProgressAbove", threshold: 75 };

    it("fires when bondingProgress >= threshold", () => {
      const update = makeUpdate({ bondingProgress: 80 });
      const order = makeOrder({ trigger });
      const result = evaluateTrigger(trigger, update, order);
      expect(result.fired).toBe(true);
      expect(result.reason).toContain(">=");
    });

    it("does NOT fire below threshold", () => {
      const update = makeUpdate({ bondingProgress: 50 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(false);
    });

    it("fires at exact threshold (boundary)", () => {
      const update = makeUpdate({ bondingProgress: 75 });
      const order = makeOrder({ trigger });
      expect(evaluateTrigger(trigger, update, order).fired).toBe(true);
    });
  });
});
