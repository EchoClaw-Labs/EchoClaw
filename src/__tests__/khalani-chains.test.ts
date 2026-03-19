import { afterEach, describe, expect, it, vi } from "vitest";
import { getChain, getChainExplorerUrl, getChainFamily, getChainRpcUrl, resolveChainId, clearKhalaniChainsCache } from "../khalani/chains.js";
import { ErrorCodes } from "../errors.js";
import type { KhalaniChain } from "../khalani/types.js";

const CHAINS: KhalaniChain[] = [
  {
    type: "eip155",
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://eth.example"] } },
    blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
  },
  {
    type: "solana",
    id: 20011000000,
    name: "Solana",
    nativeCurrency: { name: "Sol", symbol: "SOL", decimals: 9 },
    rpcUrls: { default: { http: ["https://solana.example"] } },
  },
];

afterEach(() => {
  clearKhalaniChainsCache();
});

describe("khalani chain helpers", () => {
  it("resolves aliases and exact chain names", () => {
    expect(resolveChainId("eth", CHAINS)).toBe(1);
    expect(resolveChainId("solana", CHAINS)).toBe(20011000000);
    expect(resolveChainId("Ethereum", CHAINS)).toBe(1);
  });

  it("resolves numeric chain ID from string", () => {
    expect(resolveChainId("42161")).toBe(42161);
    expect(resolveChainId("8453")).toBe(8453);
    expect(resolveChainId("1")).toBe(1);
  });

  it("throws KHALANI_UNSUPPORTED_CHAIN for empty string", () => {
    expect(() => resolveChainId("")).toThrow();
    try {
      resolveChainId("");
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN);
    }
  });

  it("throws KHALANI_UNSUPPORTED_CHAIN for unknown name without chain list", () => {
    expect(() => resolveChainId("unknown_chain")).toThrow();
    try {
      resolveChainId("unknown_chain");
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN);
    }
  });

  it("throws KHALANI_UNSUPPORTED_CHAIN for unknown name with chain list", () => {
    expect(() => resolveChainId("nonexistent", CHAINS)).toThrow();
    try {
      resolveChainId("nonexistent", CHAINS);
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN);
    }
  });

  it("resolves whitespace-trimmed input", () => {
    expect(resolveChainId("  eth  ")).toBe(1);
    expect(resolveChainId("  42161  ")).toBe(42161);
  });

  it("returns chain family and rpc url", () => {
    expect(getChainFamily(1, CHAINS)).toBe("eip155");
    expect(getChainFamily(20011000000, CHAINS)).toBe("solana");
    expect(getChainRpcUrl(1, CHAINS)).toBe("https://eth.example");
    expect(getChainExplorerUrl(1, CHAINS)).toBe("https://etherscan.io");
  });

  it("returns undefined explorer url when chain has no block explorers", () => {
    expect(getChainExplorerUrl(20011000000, CHAINS)).toBeUndefined();
  });

  describe("getChain", () => {
    it("returns the chain matching chainId", () => {
      const chain = getChain(1, CHAINS);
      expect(chain.name).toBe("Ethereum");
      expect(chain.type).toBe("eip155");
    });

    it("throws KHALANI_UNSUPPORTED_CHAIN for unknown chainId", () => {
      expect(() => getChain(999999, CHAINS)).toThrow();
      try {
        getChain(999999, CHAINS);
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN);
      }
    });
  });

  describe("getChainRpcUrl", () => {
    it("throws when chain has no rpcUrls", () => {
      const noRpcChains: KhalaniChain[] = [
        { type: "eip155", id: 99, name: "NoRPC", nativeCurrency: { name: "X", symbol: "X", decimals: 18 } },
      ];
      expect(() => getChainRpcUrl(99, noRpcChains)).toThrow();
    });
  });

  describe("clearKhalaniChainsCache", () => {
    it("is callable and does not throw", () => {
      // clearKhalaniChainsCache resets internal cache state
      expect(() => clearKhalaniChainsCache()).not.toThrow();
    });
  });
});
