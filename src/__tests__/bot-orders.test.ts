import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock paths before importing orders module
const testDir = join(tmpdir(), `echo-bot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const testOrdersFile = join(testDir, "orders.json");

vi.mock("../config/paths.js", () => ({
  BOT_DIR: testDir,
  BOT_ORDERS_FILE: testOrdersFile,
  CONFIG_DIR: testDir,
}));

vi.mock("../utils/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  loadOrders,
  saveOrders,
  addOrder,
  removeOrder,
  updateOrder,
  armOrder,
  disarmOrder,
  getArmedOrdersForToken,
  markFilled,
  markFailed,
  setLastProcessedTxHash,
  listOrders,
} = await import("../bot/orders.js");

const { EchoError } = await import("../errors.js");

describe("bot/orders", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  // ── loadOrders ──────────────────────────────────────────────────

  describe("loadOrders", () => {
    it("returns empty default when no file", () => {
      const file = loadOrders();
      expect(file.version).toBe(1);
      expect(file.orders).toEqual([]);
    });

    it("parses valid file", () => {
      mkdirSync(testDir, { recursive: true });
      const data = {
        version: 1,
        orders: [
          {
            id: "abc",
            token: "0xabc",
            side: "buy",
            trigger: { type: "onNewBuy" },
            size: { mode: "absolute", amountOg: "1" },
            slippageBps: 100,
            cooldownMs: 5000,
            state: "armed",
            createdAt: 1000,
          },
        ],
      };
      writeFileSync(testOrdersFile, JSON.stringify(data), "utf-8");
      const file = loadOrders();
      expect(file.orders).toHaveLength(1);
      expect(file.orders[0].id).toBe("abc");
    });

    it("returns empty on invalid JSON", () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testOrdersFile, "not valid json {{{", "utf-8");
      const file = loadOrders();
      expect(file.version).toBe(1);
      expect(file.orders).toEqual([]);
    });

    it("returns empty on unknown version", () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testOrdersFile, JSON.stringify({ version: 999, orders: [] }), "utf-8");
      const file = loadOrders();
      expect(file.version).toBe(1);
      expect(file.orders).toEqual([]);
    });
  });

  // ── addOrder ────────────────────────────────────────────────────

  describe("addOrder", () => {
    it("creates order with UUID, state=armed, persists to file", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      expect(order.id).toBeDefined();
      expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(order.state).toBe("armed");
      expect(order.token).toBe("0xabc");

      // Verify persisted
      const file = loadOrders();
      expect(file.orders).toHaveLength(1);
      expect(file.orders[0].id).toBe(order.id);
    });

    it("multiple orders accumulate", () => {
      addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      addOrder({
        token: "0xdef" as `0x${string}`,
        side: "sell",
        trigger: { type: "priceAbove", threshold: 0.01 },
        size: { mode: "all" },
        slippageBps: 50,
        cooldownMs: 3000,
      });

      const file = loadOrders();
      expect(file.orders).toHaveLength(2);
    });
  });

  // ── removeOrder ─────────────────────────────────────────────────

  describe("removeOrder", () => {
    it("sets state=cancelled, returns true", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      const result = removeOrder(order.id);
      expect(result).toBe(true);

      const file = loadOrders();
      expect(file.orders[0].state).toBe("cancelled");
    });

    it("returns false for non-existent id", () => {
      expect(removeOrder("non-existent")).toBe(false);
    });
  });

  // ── updateOrder ─────────────────────────────────────────────────

  describe("updateOrder", () => {
    it("patches slippageBps/cooldownMs", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      const updated = updateOrder(order.id, { slippageBps: 200, cooldownMs: 10000 });
      expect(updated.slippageBps).toBe(200);
      expect(updated.cooldownMs).toBe(10000);
    });

    it("throws BOT_ORDER_NOT_FOUND for bad id", () => {
      expect(() => updateOrder("bad-id", { slippageBps: 100 })).toThrow(EchoError);
    });
  });

  // ── armOrder ────────────────────────────────────────────────────

  describe("armOrder", () => {
    it("sets state to armed from cancelled", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      removeOrder(order.id); // state → cancelled
      const rearmed = armOrder(order.id);
      expect(rearmed.state).toBe("armed");
    });

    it("sets state to armed from disarmed", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      disarmOrder(order.id); // state → disarmed
      const rearmed = armOrder(order.id);
      expect(rearmed.state).toBe("armed");
    });

    it("throws on filled orders (Fix 4)", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      markFilled(order.id, "0xtxhash");

      expect(() => armOrder(order.id)).toThrow(EchoError);
      expect(() => armOrder(order.id)).toThrow(/Cannot arm order in state "filled"/);
    });

    it("throws on failed orders (Fix 4)", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      markFailed(order.id, "some error");

      expect(() => armOrder(order.id)).toThrow(EchoError);
      expect(() => armOrder(order.id)).toThrow(/Cannot arm order in state "failed"/);
    });

    it("throws on armed orders (already armed)", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      expect(() => armOrder(order.id)).toThrow(/Cannot arm order in state "armed"/);
    });
  });

  // ── disarmOrder ─────────────────────────────────────────────────

  describe("disarmOrder", () => {
    it("sets state to disarmed (not cancelled) (Fix 3)", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      const disarmed = disarmOrder(order.id);
      expect(disarmed.state).toBe("disarmed");

      // Verify persisted
      const file = loadOrders();
      expect(file.orders[0].state).toBe("disarmed");
    });
  });

  // ── getArmedOrdersForToken ──────────────────────────────────────

  describe("getArmedOrdersForToken", () => {
    it("filters by token (case-insensitive) + state=armed", () => {
      addOrder({
        token: "0xABC" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      addOrder({
        token: "0xDEF" as `0x${string}`,
        side: "sell",
        trigger: { type: "priceAbove", threshold: 0.01 },
        size: { mode: "all" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      const o3 = addOrder({
        token: "0xABC" as `0x${string}`,
        side: "sell",
        trigger: { type: "priceAbove", threshold: 0.02 },
        size: { mode: "all" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      disarmOrder(o3.id); // disarmed → not returned

      const armed = getArmedOrdersForToken("0xabc");
      expect(armed).toHaveLength(1);
      expect(armed[0].token).toBe("0xABC");
    });
  });

  // ── markFilled ──────────────────────────────────────────────────

  describe("markFilled", () => {
    it("sets state, filledAt, filledTxHash", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      markFilled(order.id, "0xtxhash123");

      const file = loadOrders();
      const filled = file.orders[0];
      expect(filled.state).toBe("filled");
      expect(filled.filledTxHash).toBe("0xtxhash123");
      expect(filled.filledAt).toBeDefined();
    });
  });

  // ── markFailed ──────────────────────────────────────────────────

  describe("markFailed", () => {
    it("sets state, failReason", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      markFailed(order.id, "insufficient balance");

      const file = loadOrders();
      expect(file.orders[0].state).toBe("failed");
      expect(file.orders[0].failReason).toBe("insufficient balance");
    });
  });

  // ── setLastProcessedTxHash ──────────────────────────────────────

  describe("setLastProcessedTxHash", () => {
    it("updates field", () => {
      const order = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });

      setLastProcessedTxHash(order.id, "0xhash999");

      const file = loadOrders();
      expect(file.orders[0].lastProcessedTxHash).toBe("0xhash999");
    });
  });

  // ── listOrders ──────────────────────────────────────────────────

  describe("listOrders", () => {
    it("filters by token and/or state", () => {
      addOrder({
        token: "0xabc" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "1" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      const o2 = addOrder({
        token: "0xabc" as `0x${string}`,
        side: "sell",
        trigger: { type: "priceAbove", threshold: 0.01 },
        size: { mode: "all" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      addOrder({
        token: "0xdef" as `0x${string}`,
        side: "buy",
        trigger: { type: "onNewBuy" },
        size: { mode: "absolute", amountOg: "2" },
        slippageBps: 100,
        cooldownMs: 5000,
      });
      disarmOrder(o2.id);

      // All orders
      expect(listOrders({ state: "all" })).toHaveLength(3);

      // Filter by token
      expect(listOrders({ token: "0xabc", state: "all" })).toHaveLength(2);

      // Filter by state
      expect(listOrders({ state: "armed" })).toHaveLength(2);
      expect(listOrders({ state: "disarmed" })).toHaveLength(1);

      // Filter by both
      expect(listOrders({ token: "0xabc", state: "armed" })).toHaveLength(1);
    });
  });
});
