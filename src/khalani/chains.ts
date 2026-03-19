import { EchoError, ErrorCodes } from "../errors.js";
import type { ChainFamily, KhalaniChain } from "./types.js";
import { getKhalaniClient } from "./client.js";

export const CHAIN_ALIASES: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  arb: 42161,
  arbitrum: 42161,
  base: 8453,
  op: 10,
  optimism: 10,
  sol: 20011000000,
  solana: 20011000000,
  "0g": 16661,
  zerogravity: 16661,
  poly: 137,
  polygon: 137,
  bsc: 56,
  bnb: 56,
  avax: 43114,
  avalanche: 43114,
  scroll: 534352,
  linea: 59144,
  zksync: 324,
  mantle: 5000,
  monad: 143,
};

const CHAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedChains: KhalaniChain[] | null = null;
let cachedAt = 0;

function isCacheExpired(): boolean {
  return Date.now() - cachedAt > CHAIN_CACHE_TTL_MS;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function getCachedKhalaniChains(forceRefresh = false): Promise<KhalaniChain[]> {
  if (cachedChains && !forceRefresh && !isCacheExpired()) {
    return cachedChains;
  }

  cachedChains = await getKhalaniClient().getChains();
  cachedAt = Date.now();
  return cachedChains;
}

export function clearKhalaniChainsCache(): void {
  cachedChains = null;
  cachedAt = 0;
}

export function resolveChainId(input: string, chains?: KhalaniChain[]): number {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new EchoError(ErrorCodes.KHALANI_UNSUPPORTED_CHAIN, "Chain value cannot be empty.");
  }
  if (normalized in CHAIN_ALIASES) {
    return CHAIN_ALIASES[normalized];
  }

  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  if (chains) {
    const slug = slugify(normalized);
    const matched = chains.find((chain) => slugify(chain.name) === slug);
    if (matched) {
      return matched.id;
    }
  }

  throw new EchoError(
    ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
    `Unsupported chain: ${input}`,
    "Run `echoclaw khalani chains --json` to inspect supported chains."
  );
}

export function getChain(chainId: number, chains: KhalaniChain[]): KhalaniChain {
  const chain = chains.find((entry) => entry.id === chainId);
  if (!chain) {
    throw new EchoError(
      ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
      `Chain ${chainId} is not in the current Khalani registry.`,
      "Refresh chains and retry."
    );
  }
  return chain;
}

export function getChainFamily(chainId: number, chains: KhalaniChain[]): ChainFamily {
  return getChain(chainId, chains).type;
}

export function getChainRpcUrl(chainId: number, chains: KhalaniChain[]): string {
  const rpcUrl = getChain(chainId, chains).rpcUrls?.default?.http?.[0];
  if (!rpcUrl) {
    throw new EchoError(
      ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
      `Chain ${chainId} does not expose an RPC URL in Khalani metadata.`,
    );
  }
  return rpcUrl;
}

export function getChainExplorerUrl(chainId: number, chains: KhalaniChain[]): string | undefined {
  return getChain(chainId, chains).blockExplorers?.default?.url;
}
