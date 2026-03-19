import { describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "" } }),
}));

const { getLendRates, getLendPositions } = await import("../chains/solana/lend-service.js");

describe("lend service", () => {
  describe("getLendRates", () => {
    it("maps address/assetAddress and parses string rates to numbers", async () => {
      mockFetchJson.mockResolvedValueOnce([
        {
          id: "jl1",
          address: "jlTokenAddr",
          assetAddress: "usdcAddr",
          name: "jlUSDC",
          symbol: "jlUSDC",
          decimals: 6,
          totalAssets: "1000000",
          totalSupply: "900000",
          supplyRate: "0.045",
          rewardsRate: "0.01",
          totalRate: "0.055",
        },
      ]);

      const rates = await getLendRates();
      expect(rates).toHaveLength(1);
      expect(rates[0].address).toBe("jlTokenAddr");
      expect(rates[0].assetAddress).toBe("usdcAddr");
      expect(rates[0].supplyRate).toBe(0.045);
      expect(rates[0].rewardsRate).toBe(0.01);
      expect(rates[0].totalRate).toBe(0.055);
    });
  });

  describe("getLendPositions", () => {
    it("maps nested token.symbol and top-level shares", async () => {
      mockFetchJson.mockResolvedValueOnce([
        {
          ownerAddress: "wallet1",
          token: { id: "jl1", address: "jlAddr", symbol: "jlUSDC", name: "jlUSDC" },
          shares: "500000",
          underlyingAssets: "550000",
          underlyingBalance: "550000",
          allowance: "0",
        },
      ]);

      const positions = await getLendPositions("wallet1");
      expect(positions).toHaveLength(1);
      expect(positions[0].tokenSymbol).toBe("jlUSDC");
      expect(positions[0].tokenAddress).toBe("jlAddr");
      expect(positions[0].shares).toBe("500000");
    });
  });
});
