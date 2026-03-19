import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config/store before importing client
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({
    services: {
      jaineSubgraphUrl: "https://api.goldsky.com/test/subgraph",
    },
  }),
}));

// Mock logger to suppress output in tests
vi.mock("../utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { subgraphClient } from "../jaine/subgraph/client.js";

const originalFetch = globalThis.fetch;

describe("subgraph client", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(data: unknown, ok = true, status = 200) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok,
      status,
      json: async () => data,
    });
  }

  describe("getMeta", () => {
    it("should return meta data", async () => {
      mockFetchResponse({
        data: {
          _meta: {
            block: { number: 12345, timestamp: 1700000000, hash: "0xabc" },
            deployment: "test-deployment",
            hasIndexingErrors: false,
          },
        },
      });

      const meta = await subgraphClient.getMeta();
      expect(meta.block.number).toBe(12345);
      expect(meta.deployment).toBe("test-deployment");
      expect(meta.hasIndexingErrors).toBe(false);
    });
  });

  describe("getTopPools", () => {
    it("should return pools array", async () => {
      mockFetchResponse({
        data: {
          pools: [
            {
              id: "0xabc123",
              feeTier: "3000",
              token0: { id: "0xtoken0", symbol: "TK0", name: "Token0", decimals: "18" },
              token1: { id: "0xtoken1", symbol: "TK1", name: "Token1", decimals: "18" },
              totalValueLockedUSD: "100000",
              volumeUSD: "50000",
              txCount: "100",
            },
          ],
        },
      });

      const pools = await subgraphClient.getTopPools(10);
      expect(pools).toHaveLength(1);
      expect(pools[0].id).toBe("0xabc123");
      expect(pools[0].feeTier).toBe("3000");
    });

    it("should pass correct variables", async () => {
      mockFetchResponse({ data: { pools: [] } });

      await subgraphClient.getTopPools(50, 10);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
      );
      expect(body.variables.first).toBe(50);
      expect(body.variables.skip).toBe(10);
    });

    it("should cap limit at 1000", async () => {
      mockFetchResponse({ data: { pools: [] } });

      await subgraphClient.getTopPools(5000);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
      );
      expect(body.variables.first).toBe(1000);
    });
  });

  describe("getPoolsForToken", () => {
    it("should lowercase the token address", async () => {
      mockFetchResponse({ data: { pools: [] } });

      await subgraphClient.getPoolsForToken("0xABCDEF");

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
      );
      expect(body.variables.token).toBe("0xabcdef");
    });
  });

  describe("error handling", () => {
    it("should throw SUBGRAPH_API_ERROR on HTTP 500", async () => {
      // Retryable: provide responses for initial + 2 retries
      mockFetchResponse({}, false, 500);
      mockFetchResponse({}, false, 500);
      mockFetchResponse({}, false, 500);

      await expect(subgraphClient.getMeta()).rejects.toThrow("Subgraph HTTP 500");
    });

    it("should throw SUBGRAPH_RATE_LIMITED on HTTP 429", async () => {
      // Retryable: provide responses for initial + 2 retries
      mockFetchResponse({}, false, 429);
      mockFetchResponse({}, false, 429);
      mockFetchResponse({}, false, 429);

      await expect(subgraphClient.getMeta()).rejects.toThrow("Subgraph HTTP 429");
    });

    it("should throw SUBGRAPH_INVALID_RESPONSE on GraphQL errors", async () => {
      mockFetchResponse({
        errors: [{ message: "Field 'foo' not found" }],
      });

      await expect(subgraphClient.getMeta()).rejects.toThrow("GraphQL errors");
    });

    it("should throw SUBGRAPH_INVALID_RESPONSE on missing data", async () => {
      mockFetchResponse({});

      await expect(subgraphClient.getMeta()).rejects.toThrow("Missing data");
    });
  });

  describe("getPool", () => {
    it("should return null when pool not found", async () => {
      mockFetchResponse({ data: { pool: null } });

      const result = await subgraphClient.getPool("0x1234567890123456789012345678901234567890");
      expect(result).toBeNull();
    });
  });

  describe("getDexDayData", () => {
    it("should return day data", async () => {
      mockFetchResponse({
        data: {
          jaineDexDayDatas: [
            { id: "1", date: 1700000000, volumeUSD: "1000", feesUSD: "10", tvlUSD: "5000", txCount: "50" },
          ],
        },
      });

      const result = await subgraphClient.getDexDayData(1);
      expect(result).toHaveLength(1);
      expect(result[0].volumeUSD).toBe("1000");
    });
  });
});
