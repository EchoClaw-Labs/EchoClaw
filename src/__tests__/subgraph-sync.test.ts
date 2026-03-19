import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({
    services: {
      jaineSubgraphUrl: "https://api.goldsky.com/test/subgraph",
    },
    chain: { chainId: 16600 },
    protocol: { jaineFactory: "0x1234" },
  }),
}));

vi.mock("../utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../wallet/client.js", () => ({
  getPublicClient: vi.fn(),
}));

// Mock the subgraph client
vi.mock("../jaine/subgraph/client.js", () => ({
  subgraphClient: {
    getTopPools: vi.fn(),
  },
}));

import { syncPoolsFromSubgraph } from "../jaine/poolCache.js";
import { subgraphClient } from "../jaine/subgraph/client.js";

describe("syncPoolsFromSubgraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should map SubgraphPool to PoolInfo with checksummed addresses", async () => {
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "0x1234567890abcdef1234567890abcdef12345678",
        feeTier: "3000",
        token0: { id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "TK0", name: "Token0", decimals: "18" },
        token1: { id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "TK1", name: "Token1", decimals: "18" },
        totalValueLockedUSD: "100000",
      },
    ]);

    const result = await syncPoolsFromSubgraph(100);

    expect(result).toHaveLength(1);
    // Should be checksummed
    expect(result[0].address).toBe("0x1234567890AbcdEF1234567890aBcdef12345678");
    expect(result[0].fee).toBe(3000);
  });

  it("should call onProgress callback", async () => {
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const onProgress = vi.fn();
    await syncPoolsFromSubgraph(100, onProgress);

    expect(onProgress).toHaveBeenCalledWith(0);
  });

  it("should deduplicate pools by address", async () => {
    const pool = {
      id: "0x1234567890abcdef1234567890abcdef12345678",
      feeTier: "3000",
      token0: { id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "TK0", name: "Token0", decimals: "18" },
      token1: { id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "TK1", name: "Token1", decimals: "18" },
      totalValueLockedUSD: "100000",
    };
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([pool, pool]);

    const result = await syncPoolsFromSubgraph(100);
    expect(result).toHaveLength(1);
  });

  it("should handle empty response", async () => {
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await syncPoolsFromSubgraph(100);
    expect(result).toHaveLength(0);
  });

  it("should skip pools with unknown fee tiers", async () => {
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "0x1234567890abcdef1234567890abcdef12345678",
        feeTier: "9999", // Unknown fee tier
        token0: { id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "TK0", name: "Token0", decimals: "18" },
        token1: { id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", symbol: "TK1", name: "Token1", decimals: "18" },
        totalValueLockedUSD: "100000",
      },
    ]);

    const result = await syncPoolsFromSubgraph(100);
    expect(result).toHaveLength(0);
  });

  it("should pass maxPools to subgraphClient", async () => {
    (subgraphClient.getTopPools as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await syncPoolsFromSubgraph(250);

    expect(subgraphClient.getTopPools).toHaveBeenCalledWith(250);
  });
});
