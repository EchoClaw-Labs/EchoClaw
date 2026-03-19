import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../config/store.js", () => ({
  loadConfig: vi.fn(() => ({
    solana: { cluster: "mainnet-beta", explorerUrl: "https://explorer.solana.com" },
  })),
}));

const {
  validateSolanaAddress,
  parseSolAmount,
  parseSplAmount,
  lamportsToSol,
  solToLamports,
  tokenAmountToUi,
  solanaExplorerUrl,
  shortenSolanaAddress,
} = await import("../chains/solana/validation.js");

const { ErrorCodes } = await import("../errors.js");

describe("solana validation", () => {
  describe("validateSolanaAddress", () => {
    it("accepts valid base58 address", () => {
      const addr = "11111111111111111111111111111111";
      expect(validateSolanaAddress(addr)).toBe(addr);
    });

    it("throws for invalid address", () => {
      expect(() => validateSolanaAddress("not-a-valid-address!!!")).toThrow();
    });

    it("throws with SOLANA_INVALID_ADDRESS code", () => {
      try {
        validateSolanaAddress("invalid");
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.SOLANA_INVALID_ADDRESS);
      }
    });
  });

  describe("parseSolAmount", () => {
    it("parses '1.5' correctly", () => {
      const { lamports, ui } = parseSolAmount("1.5");
      expect(ui).toBe(1.5);
      expect(lamports).toBe(BigInt(1_500_000_000));
    });

    it("parses '0' correctly", () => {
      const { lamports, ui } = parseSolAmount("0");
      expect(ui).toBe(0);
      expect(lamports).toBe(BigInt(0));
    });

    it("throws for negative amount", () => {
      expect(() => parseSolAmount("-1")).toThrow();
    });

    it("throws for non-numeric", () => {
      expect(() => parseSolAmount("abc")).toThrow();
    });

    it("throws for absurdly large amount", () => {
      expect(() => parseSolAmount("9999999999")).toThrow();
    });
  });

  describe("parseSplAmount", () => {
    it("parses amount with 6 decimals", () => {
      const { atomic, ui } = parseSplAmount("100", 6);
      expect(ui).toBe(100);
      expect(atomic).toBe(BigInt(100_000_000));
    });

    it("parses amount with 9 decimals", () => {
      const { atomic } = parseSplAmount("1", 9);
      expect(atomic).toBe(BigInt(1_000_000_000));
    });
  });

  describe("lamportsToSol / solToLamports roundtrip", () => {
    it("converts 1 SOL correctly", () => {
      expect(lamportsToSol(BigInt(1_000_000_000))).toBe(1);
      expect(solToLamports(1)).toBe(BigInt(1_000_000_000));
    });

    it("handles fractional SOL", () => {
      const sol = 0.5;
      const lamports = solToLamports(sol);
      expect(lamportsToSol(lamports)).toBeCloseTo(sol, 6);
    });
  });

  describe("tokenAmountToUi", () => {
    it("converts USDC amount (6 decimals)", () => {
      expect(tokenAmountToUi("1000000", 6)).toBe(1);
    });

    it("converts SOL amount (9 decimals)", () => {
      expect(tokenAmountToUi(BigInt(2_500_000_000), 9)).toBe(2.5);
    });
  });

  describe("solanaExplorerUrl", () => {
    it("builds mainnet tx URL", () => {
      const url = solanaExplorerUrl("abc123", "tx");
      expect(url).toBe("https://explorer.solana.com/tx/abc123");
    });

    it("builds address URL", () => {
      const url = solanaExplorerUrl("abc123", "address");
      expect(url).toBe("https://explorer.solana.com/address/abc123");
    });
  });

  describe("shortenSolanaAddress", () => {
    it("shortens long address", () => {
      const addr = "So11111111111111111111111111111111111111112";
      expect(shortenSolanaAddress(addr)).toBe("So11...1112");
    });

    it("returns short address unchanged", () => {
      expect(shortenSolanaAddress("abc")).toBe("abc");
    });
  });
});
