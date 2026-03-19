/**
 * Solana token resolution chain.
 * Resolution order: well-known → file cache → Jupiter Token API v2.
 * Used by swap, transfer, and browse commands to resolve symbols to metadata.
 */

import type { TokenMetadata } from "../types.js";
import { getWellKnownBySymbol, getWellKnownByMint } from "./constants.js";
import { getCachedToken, cacheTokens } from "./token-cache.js";
import { jupiterSearchTokens, jupiterGetTokensByMint } from "./jupiter-client.js";
import type { JupiterTokenInfo } from "./jupiter-client.js";

function jupiterToMeta(j: JupiterTokenInfo): TokenMetadata {
  return {
    chain: "solana",
    address: j.id,
    symbol: j.symbol,
    name: j.name,
    decimals: j.decimals,
    logoUri: j.icon,
  };
}

function looksLikeMint(query: string): boolean {
  return query.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(query);
}

/**
 * Resolve a single token by symbol or mint address.
 * Returns undefined if not found anywhere.
 */
export async function resolveToken(symbolOrMint: string): Promise<TokenMetadata | undefined> {
  // 1. Well-known (instant, offline)
  const wellKnown = looksLikeMint(symbolOrMint)
    ? getWellKnownByMint(symbolOrMint)
    : getWellKnownBySymbol(symbolOrMint);
  if (wellKnown) return wellKnown;

  // 2. File cache (TTL 24h)
  const cached = getCachedToken(symbolOrMint);
  if (cached) return cached;

  // 3. Jupiter Token API
  try {
    if (looksLikeMint(symbolOrMint)) {
      const results = await jupiterGetTokensByMint([symbolOrMint]);
      if (results.length > 0) {
        const tokens = results.map(jupiterToMeta);
        cacheTokens(tokens);
        return tokens[0];
      }
    } else {
      const results = await jupiterSearchTokens(symbolOrMint);
      if (results.length > 0) {
        // Prefer exact symbol match (case-insensitive)
        const exact = results.find(
          (r) => r.symbol.toLowerCase() === symbolOrMint.toLowerCase(),
        );
        const best = exact ?? results[0];
        const tokens = results.map(jupiterToMeta);
        cacheTokens(tokens);
        return jupiterToMeta(best);
      }
    }
  } catch {
    // Jupiter unavailable — return undefined
  }

  return undefined;
}

/**
 * Resolve multiple tokens in batch.
 * Returns a map keyed by the original query string.
 */
export async function resolveTokens(
  queries: string[],
): Promise<Map<string, TokenMetadata>> {
  const result = new Map<string, TokenMetadata>();
  const pending: string[] = [];

  // Quick pass: well-known + cache
  for (const q of queries) {
    const wellKnown = looksLikeMint(q) ? getWellKnownByMint(q) : getWellKnownBySymbol(q);
    if (wellKnown) {
      result.set(q, wellKnown);
      continue;
    }
    const cached = getCachedToken(q);
    if (cached) {
      result.set(q, cached);
      continue;
    }
    pending.push(q);
  }

  // Batch Jupiter lookup for remaining
  if (pending.length > 0) {
    const mints = pending.filter(looksLikeMint);
    const symbols = pending.filter((q) => !looksLikeMint(q));

    if (mints.length > 0) {
      try {
        const fetched = await jupiterGetTokensByMint(mints);
        const tokens = fetched.map(jupiterToMeta);
        cacheTokens(tokens);
        for (const mint of mints) {
          const match = tokens.find((t) => t.address === mint);
          if (match) result.set(mint, match);
        }
      } catch { /* fallthrough */ }
    }

    for (const sym of symbols) {
      const resolved = await resolveToken(sym);
      if (resolved) result.set(sym, resolved);
    }
  }

  return result;
}
