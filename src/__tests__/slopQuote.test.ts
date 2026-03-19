import { describe, it, expect } from "vitest";
import {
  ceilDiv,
  calculateTokensOut,
  calculateOgOut,
  calculateSpotPrice,
  calculatePartialFill,
  applySlippage,
  calculateGraduationProgress,
  PRECISION,
  GRADUATION_THRESHOLD_BPS,
} from "../slop/quote.js";

describe("slop/quote", () => {
  describe("ceilDiv", () => {
    it("should return 0 for 0/n", () => {
      expect(ceilDiv(0n, 5n)).toBe(0n);
    });

    it("should round up for non-exact division", () => {
      expect(ceilDiv(7n, 3n)).toBe(3n); // ceil(7/3) = 3
      expect(ceilDiv(10n, 3n)).toBe(4n); // ceil(10/3) = 4
      expect(ceilDiv(1n, 2n)).toBe(1n); // ceil(1/2) = 1
    });

    it("should not round up for exact division", () => {
      expect(ceilDiv(6n, 3n)).toBe(2n);
      expect(ceilDiv(100n, 10n)).toBe(10n);
    });

    it("should throw on division by zero", () => {
      expect(() => ceilDiv(5n, 0n)).toThrow("Division by zero");
    });

    it("should match Solidity ceilDiv behavior", () => {
      // Large numbers - matches (a - 1) / b + 1 formula
      const a = 10n ** 18n + 1n;
      const b = 10n ** 9n;
      expect(ceilDiv(a, b)).toBe(10n ** 9n + 1n);
    });
  });

  describe("calculateTokensOut", () => {
    // Test values based on typical slop.money config
    const virtualOg = 10n ** 18n; // 1 0G virtual
    const virtualToken = 100_000n * 10n ** 18n; // 100k tokens virtual
    const k = virtualOg * virtualToken;

    it("should calculate tokens for a buy", () => {
      const ogIn = 10n ** 17n; // 0.1 0G
      const tokensOut = calculateTokensOut(k, virtualOg, virtualToken, ogIn);

      // With 0.1 0G in, we get fewer tokens due to constant product
      expect(tokensOut).toBeGreaterThan(0n);
      expect(tokensOut).toBeLessThan(virtualToken);
    });

    it("should return fewer tokens for same input as reserves deplete", () => {
      const ogIn = 10n ** 17n;

      // First buy
      const tokensOut1 = calculateTokensOut(k, virtualOg, virtualToken, ogIn);

      // Simulate state after first buy
      const newOgReserves = virtualOg + ogIn;
      const newTokenReserves = virtualToken - tokensOut1;
      const newK = newOgReserves * newTokenReserves;

      // Second buy of same amount
      const tokensOut2 = calculateTokensOut(newK, newOgReserves, newTokenReserves, ogIn);

      // Second buy should yield fewer tokens (price went up)
      expect(tokensOut2).toBeLessThan(tokensOut1);
    });

    it("should throw for zero input", () => {
      expect(() => calculateTokensOut(k, virtualOg, virtualToken, 0n)).toThrow(
        "0G amount must be > 0"
      );
    });

    it("should not drain entire pool for huge input", () => {
      const hugeOgIn = 10n ** 30n;
      const tokensOut = calculateTokensOut(k, virtualOg, virtualToken, hugeOgIn);

      const newOgReserves = virtualOg + hugeOgIn;
      const expectedNewTokenReserves = k === 0n ? 0n : ((k - 1n) / newOgReserves) + 1n;
      const expectedTokensOut = virtualToken - expectedNewTokenReserves;
      expect(tokensOut).toBe(expectedTokensOut);
    });
  });

  describe("calculateOgOut", () => {
    const virtualOg = 10n ** 18n;
    const virtualToken = 100_000n * 10n ** 18n;
    const k = virtualOg * virtualToken;

    it("should calculate 0G for a sell", () => {
      const tokensIn = 1000n * 10n ** 18n; // 1000 tokens
      const ogOut = calculateOgOut(k, virtualOg, virtualToken, tokensIn);

      expect(ogOut).toBeGreaterThan(0n);
      expect(ogOut).toBeLessThan(virtualOg);
    });

    it("should return more 0G for same token input as token reserves deplete", () => {
      const tokensIn = 1000n * 10n ** 18n;

      // First sell
      const ogOut1 = calculateOgOut(k, virtualOg, virtualToken, tokensIn);

      // Simulate state after first sell
      const newOgReserves = virtualOg - ogOut1;
      const newTokenReserves = virtualToken + tokensIn;
      const newK = newOgReserves * newTokenReserves;

      // Second sell
      const ogOut2 = calculateOgOut(newK, newOgReserves, newTokenReserves, tokensIn);

      // Second sell should yield less 0G (price went down)
      expect(ogOut2).toBeLessThan(ogOut1);
    });

    it("should throw for zero input", () => {
      expect(() => calculateOgOut(k, virtualOg, virtualToken, 0n)).toThrow(
        "Token amount must be > 0"
      );
    });
  });

  describe("calculateSpotPrice", () => {
    it("should calculate price with 18 decimal precision", () => {
      const ogReserves = 10n ** 18n; // 1 0G
      const tokenReserves = 100_000n * 10n ** 18n; // 100k tokens

      const price = calculateSpotPrice(ogReserves, tokenReserves);

      // Price = 1/100000 * 1e18 = 1e13
      expect(price).toBe(10n ** 13n);
    });

    it("should increase as tokens are bought", () => {
      const ogReserves1 = 10n ** 18n;
      const tokenReserves1 = 100_000n * 10n ** 18n;
      const price1 = calculateSpotPrice(ogReserves1, tokenReserves1);

      // After some buys (more 0G, fewer tokens)
      const ogReserves2 = 2n * 10n ** 18n;
      const tokenReserves2 = 50_000n * 10n ** 18n;
      const price2 = calculateSpotPrice(ogReserves2, tokenReserves2);

      expect(price2).toBeGreaterThan(price1);
    });

    it("should throw for zero token reserves", () => {
      expect(() => calculateSpotPrice(10n ** 18n, 0n)).toThrow(
        "Token reserves must be > 0"
      );
    });
  });

  describe("calculatePartialFill", () => {
    // Config similar to production
    const virtualOg = 10n ** 18n;
    const curveSupply = 800_000_000n * 10n ** 18n; // 800M tokens
    const virtualToken = curveSupply + 200_000_000n * 10n ** 18n; // +200M virtual offset
    const buyFeeBps = 100n; // 1%

    it("should return full fill when not hitting graduation cap", () => {
      const ogAmount = 10n ** 17n; // 0.1 0G
      const result = calculatePartialFill(
        virtualOg,
        virtualToken,
        virtualToken,
        curveSupply,
        ogAmount,
        buyFeeBps
      );

      expect(result.hitCap).toBe(false);
      expect(result.refund).toBe(0n);
      expect(result.tokensOut).toBeGreaterThan(0n);
      expect(result.feeUsed).toBeGreaterThan(0n);
    });

    it("should apply correct fee calculation", () => {
      const ogAmount = 10n ** 18n; // 1 0G
      const result = calculatePartialFill(
        virtualOg,
        virtualToken,
        virtualToken,
        curveSupply,
        ogAmount,
        buyFeeBps
      );

      // Fee should be 1% of input
      const expectedFee = ogAmount / 100n;
      expect(result.feeUsed).toBe(expectedFee);
      expect(result.ogUsed).toBe(ogAmount - expectedFee);
    });

    it("should throw when graduation threshold already reached", () => {
      // Token reserves at exactly 20% of curve supply (80% sold)
      const tokenReservesAt80 = virtualToken - (curveSupply * 80n / 100n);

      expect(() =>
        calculatePartialFill(
          virtualOg * 5n, // Higher OG reserves after 80% sold
          tokenReservesAt80,
          virtualToken,
          curveSupply,
          10n ** 17n,
          buyFeeBps
        )
      ).toThrow("Graduation threshold reached");
    });
  });

  describe("applySlippage", () => {
    it("should reduce amount by slippage percentage", () => {
      const amount = 1000n * 10n ** 18n;
      const slippageBps = 50n; // 0.5%

      const result = applySlippage(amount, slippageBps);

      // 0.5% slippage = 99.5% of original
      expect(result).toBe((amount * 9950n) / 10000n);
    });

    it("should return original amount for 0 slippage", () => {
      const amount = 1000n * 10n ** 18n;
      expect(applySlippage(amount, 0n)).toBe(amount);
    });

    it("should return 0 for 100% slippage", () => {
      const amount = 1000n * 10n ** 18n;
      expect(applySlippage(amount, 10000n)).toBe(0n);
    });

    it("should throw for invalid slippage", () => {
      expect(() => applySlippage(1000n, -1n)).toThrow("Invalid slippage");
      expect(() => applySlippage(1000n, 10001n)).toThrow("Invalid slippage");
    });
  });

  describe("calculateGraduationProgress", () => {
    const curveSupply = 800_000_000n * 10n ** 18n;
    const virtualToken = curveSupply + 200_000_000n * 10n ** 18n;

    it("should return 0 at start (no tokens sold)", () => {
      const progress = calculateGraduationProgress(virtualToken, virtualToken, curveSupply);
      expect(progress).toBe(0n);
    });

    it("should return 8000 (80%) at graduation threshold", () => {
      const tokensSold = (curveSupply * 80n) / 100n;
      const tokenReserves = virtualToken - tokensSold;

      const progress = calculateGraduationProgress(tokenReserves, virtualToken, curveSupply);
      expect(progress).toBe(8000n);
    });

    it("should return 10000 (100%) when all curve supply sold", () => {
      const tokenReserves = virtualToken - curveSupply;

      const progress = calculateGraduationProgress(tokenReserves, virtualToken, curveSupply);
      expect(progress).toBe(10000n);
    });

    it("should handle zero curve supply", () => {
      const progress = calculateGraduationProgress(1000n, 1000n, 0n);
      expect(progress).toBe(0n);
    });
  });

  describe("constants", () => {
    it("PRECISION should be 1e18", () => {
      expect(PRECISION).toBe(10n ** 18n);
    });

    it("GRADUATION_THRESHOLD_BPS should be 8000", () => {
      expect(GRADUATION_THRESHOLD_BPS).toBe(8000n);
    });
  });
});
