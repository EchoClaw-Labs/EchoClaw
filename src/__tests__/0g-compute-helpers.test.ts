import { describe, it, expect } from "vitest";
import {
  normalizeSubAccount,
  normalizeInferTuple,
  serializeSubAccount,
} from "../0g-compute/account.js";
import {
  calculateProviderPricing,
  formatPricePerMTokens,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_ALERT_RATIO,
} from "../0g-compute/pricing.js";

// ── normalizeSubAccount ──────────────────────────────────────────────

describe("normalizeSubAccount", () => {
  it("should normalize named properties", () => {
    const account = {
      balance: 5_000000000000000000n, // 5 0G
      pendingRefund: 1_200000000000000000n, // 1.2 0G
    };
    const result = normalizeSubAccount(account);
    expect(result.totalOg).toBeCloseTo(5.0, 4);
    expect(result.pendingRefundOg).toBeCloseTo(1.2, 4);
    expect(result.lockedOg).toBeCloseTo(3.8, 4);
    expect(result.rawBalance).toBe("5000000000000000000");
    expect(result.rawPendingRefund).toBe("1200000000000000000");
  });

  it("should normalize indexed tuple (fallback)", () => {
    // Simulates AccountStructOutput tuple [user, provider, nonce, balance, pendingRefund, signer]
    const account: Record<number | string, unknown> = {
      0: "0xUserAddr",
      1: "0xProviderAddr",
      2: 42n,
      3: 3_000000000000000000n, // 3 0G
      4: 500000000000000000n,   // 0.5 0G
      5: "0xSigner",
    };
    const result = normalizeSubAccount(account);
    expect(result.totalOg).toBeCloseTo(3.0, 4);
    expect(result.pendingRefundOg).toBeCloseTo(0.5, 4);
    expect(result.lockedOg).toBeCloseTo(2.5, 4);
  });

  it("should handle zero balances", () => {
    const result = normalizeSubAccount({ balance: 0n, pendingRefund: 0n });
    expect(result.totalOg).toBe(0);
    expect(result.pendingRefundOg).toBe(0);
    expect(result.lockedOg).toBe(0);
    expect(result.rawBalance).toBe("0");
    expect(result.rawPendingRefund).toBe("0");
  });

  it("should handle large values", () => {
    // 1 million 0G
    const balance = 1_000_000_000000000000000000n;
    const pending = 500_000_000000000000000000n;
    const result = normalizeSubAccount({ balance, pendingRefund: pending });
    expect(result.totalOg).toBeCloseTo(1_000_000, 0);
    expect(result.pendingRefundOg).toBeCloseTo(500_000, 0);
    expect(result.lockedOg).toBeCloseTo(500_000, 0);
  });

  it("should default to 0 when properties are missing", () => {
    const result = normalizeSubAccount({});
    expect(result.totalOg).toBe(0);
    expect(result.pendingRefundOg).toBe(0);
    expect(result.lockedOg).toBe(0);
  });
});

// ── normalizeInferTuple ──────────────────────────────────────────────

describe("normalizeInferTuple", () => {
  it("should normalize a typical [provider, balance, pendingRefund] tuple", () => {
    const tuple: [string, bigint, bigint] = [
      "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
      10_000000000000000000n, // 10 0G
      2_000000000000000000n,  // 2 0G
    ];
    const result = normalizeInferTuple(tuple);
    expect(result.provider).toBe("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01");
    expect(result.totalOg).toBeCloseTo(10.0, 4);
    expect(result.pendingRefundOg).toBeCloseTo(2.0, 4);
    expect(result.lockedOg).toBeCloseTo(8.0, 4);
  });

  it("should handle zeros", () => {
    const result = normalizeInferTuple(["0x0000", 0n, 0n]);
    expect(result.totalOg).toBe(0);
    expect(result.lockedOg).toBe(0);
  });
});

// ── serializeSubAccount ──────────────────────────────────────────────

describe("serializeSubAccount", () => {
  it("should produce a plain object with numeric/string fields", () => {
    const sa = normalizeSubAccount({
      balance: 5_000000000000000000n,
      pendingRefund: 1_200000000000000000n,
    });
    const serialized = serializeSubAccount(sa);
    expect(serialized.totalOg).toBeCloseTo(5.0, 4);
    expect(serialized.pendingRefundOg).toBeCloseTo(1.2, 4);
    expect(serialized.lockedOg).toBeCloseTo(3.8, 4);
    expect(serialized.rawBalance).toBe("5000000000000000000");
    expect(serialized.rawPendingRefund).toBe("1200000000000000000");
    // Should be JSON-safe
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});

// ── calculateProviderPricing ─────────────────────────────────────────

describe("calculateProviderPricing", () => {
  it("should compute recommended min with known prices", () => {
    // inputPrice = 500000 neuron/token, outputPrice = 1000000 neuron/token
    const input = 500_000n;
    const output = 1_000_000n;
    const result = calculateProviderPricing(input, output);

    // costNeuron = 2_000_000 * (500_000 + 1_000_000) = 3_000_000_000_000
    // costOg = 3_000_000_000_000 / 10^18 = 0.000003
    // max(1.0, 0.000003) = 1.0 (floor)
    expect(result.recommendedMinLockedOg).toBe(1.0);
    expect(result.recommendedAlertLockedOg).toBeCloseTo(1.2, 4);
    expect(result.costNeuron).toBe(3_000_000_000_000n);
  });

  it("should exceed floor for expensive providers", () => {
    // inputPrice = 1_000_000_000_000 neuron/token (0.000001 0G/token)
    // outputPrice = 1_000_000_000_000 neuron/token
    const price = 1_000_000_000_000n;
    const result = calculateProviderPricing(price, price);

    // costNeuron = 2_000_000 * 2_000_000_000_000 = 4_000_000_000_000_000_000
    // costOg = 4.0
    expect(result.recommendedMinLockedOg).toBeCloseTo(4.0, 4);
    expect(result.recommendedAlertLockedOg).toBeCloseTo(4.8, 4);
  });

  it("should use custom budget and ratio", () => {
    const price = 1_000_000_000_000n;
    const result = calculateProviderPricing(price, price, 1_000_000n, 1.5);

    // costNeuron = 1_000_000 * 2_000_000_000_000 = 2_000_000_000_000_000_000
    // costOg = 2.0
    expect(result.recommendedMinLockedOg).toBeCloseTo(2.0, 4);
    expect(result.recommendedAlertLockedOg).toBeCloseTo(3.0, 4);
  });

  it("should floor at 1.0 0G for very cheap providers", () => {
    const result = calculateProviderPricing(1n, 1n);
    expect(result.recommendedMinLockedOg).toBe(1.0);
  });

  it("should export correct defaults", () => {
    expect(DEFAULT_TOKEN_BUDGET).toBe(2_000_000n);
    expect(DEFAULT_ALERT_RATIO).toBe(1.2);
  });
});

// ── formatPricePerMTokens ────────────────────────────────────────────

describe("formatPricePerMTokens", () => {
  it("should multiply by 1M and format in 0G", () => {
    // 1_000_000_000_000 neuron/token → 1_000_000_000_000 * 1_000_000 = 1e18 neuron per M tokens = 1.0 0G
    const result = formatPricePerMTokens(1_000_000_000_000n);
    expect(parseFloat(result)).toBeCloseTo(1.0, 6);
  });

  it("should handle small prices", () => {
    // 100 neuron/token → 100_000_000 neuron per M tokens → 0.0000000001 0G
    const result = formatPricePerMTokens(100n);
    expect(parseFloat(result)).toBeGreaterThan(0);
    expect(parseFloat(result)).toBeLessThan(0.001);
  });

  it("should return '0.0' for zero price", () => {
    const result = formatPricePerMTokens(0n);
    expect(parseFloat(result)).toBe(0);
  });
});
