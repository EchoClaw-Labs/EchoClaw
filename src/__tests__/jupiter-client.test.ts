import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("../config/store.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

const originalFetch = globalThis.fetch;

describe("jupiter client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getJupiterBaseUrl", () => {
    it("returns api.jup.ag when API key is set", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "test-key" } });
      const { getJupiterBaseUrl } = await import("../chains/solana/jupiter-client.js");
      expect(getJupiterBaseUrl()).toBe("https://api.jup.ag");
    });

    it("returns lite-api.jup.ag when no API key", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });
      const { getJupiterBaseUrl } = await import("../chains/solana/jupiter-client.js");
      expect(getJupiterBaseUrl()).toBe("https://lite-api.jup.ag");
    });
  });

  describe("getJupiterHeaders", () => {
    it("includes x-api-key when key is set", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "my-key" } });
      const { getJupiterHeaders } = await import("../chains/solana/jupiter-client.js");
      expect(getJupiterHeaders()).toEqual({ "x-api-key": "my-key" });
    });

    it("returns empty object when no key", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });
      const { getJupiterHeaders } = await import("../chains/solana/jupiter-client.js");
      expect(getJupiterHeaders()).toEqual({});
    });
  });

  describe("jupiterSearchTokens", () => {
    it("calls /tokens/v2/search with query param", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "mint1", symbol: "TEST", name: "Test", decimals: 6, icon: "https://img.test" }],
      });

      const { jupiterSearchTokens } = await import("../chains/solana/jupiter-client.js");
      const result = await jupiterSearchTokens("TEST");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/tokens/v2/search?query=TEST"),
        expect.any(Object),
      );
      expect(result[0].id).toBe("mint1");
      expect(result[0].icon).toBe("https://img.test");
    });
  });

  describe("jupiterGetTokensByMint", () => {
    it("uses /tokens/v2/search (not /tokens/v2/{mints})", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "mint1", symbol: "A", name: "A", decimals: 6 }],
      });

      const { jupiterGetTokensByMint } = await import("../chains/solana/jupiter-client.js");
      await jupiterGetTokensByMint(["mint1", "mint2"]);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain("/tokens/v2/search?query=mint1,mint2");
      expect(calledUrl).not.toContain("/tokens/v2/mint1");
    });
  });

  describe("jupiterGetPrices", () => {
    it("calls /price/v3 with comma-separated ids", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { mint1: { price: "150.25" } } }),
      });

      const { jupiterGetPrices } = await import("../chains/solana/jupiter-client.js");
      const prices = await jupiterGetPrices(["mint1"]);

      expect(prices.get("mint1")).toBe(150.25);
    });
  });
});
