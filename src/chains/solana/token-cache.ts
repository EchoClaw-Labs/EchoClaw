/**
 * File-based token metadata cache for Solana.
 * Stores resolved token metadata with 24h TTL.
 * Atomic writes using tmp+rename pattern from config/store.ts.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { SOLANA_TOKEN_CACHE_FILE } from "../../config/paths.js";
import { ensureConfigDir } from "../../config/store.js";
import type { TokenMetadata } from "../types.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  meta: TokenMetadata;
  updatedAt: number;
}

interface TokenCacheFile {
  version: 1;
  tokens: Record<string, CacheEntry>;
}

function emptyCache(): TokenCacheFile {
  return { version: 1, tokens: {} };
}

export function loadTokenCache(): TokenCacheFile {
  if (!existsSync(SOLANA_TOKEN_CACHE_FILE)) return emptyCache();
  try {
    const raw = readFileSync(SOLANA_TOKEN_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TokenCacheFile;
    if (parsed.version !== 1) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

export function saveTokenCache(cache: TokenCacheFile): void {
  ensureConfigDir();
  const dir = dirname(SOLANA_TOKEN_CACHE_FILE);
  const tmpFile = join(dir, `.solana-token-cache.tmp.${Date.now()}.json`);
  try {
    writeFileSync(tmpFile, JSON.stringify(cache, null, 2), "utf-8");
    renameSync(tmpFile, SOLANA_TOKEN_CACHE_FILE);
  } catch {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function isStale(entry: CacheEntry): boolean {
  return Date.now() - entry.updatedAt > CACHE_TTL_MS;
}

export function getCachedToken(mintOrSymbol: string): TokenMetadata | undefined {
  const cache = loadTokenCache();
  const normalizedQuery = mintOrSymbol.toLowerCase();

  // Direct mint lookup
  const byMint = cache.tokens[mintOrSymbol];
  if (byMint && !isStale(byMint)) return byMint.meta;

  // Symbol scan
  for (const entry of Object.values(cache.tokens)) {
    if (entry.meta.symbol.toLowerCase() === normalizedQuery && !isStale(entry)) {
      return entry.meta;
    }
  }

  return undefined;
}

export function cacheTokens(tokens: TokenMetadata[]): void {
  const cache = loadTokenCache();
  const now = Date.now();
  for (const meta of tokens) {
    cache.tokens[meta.address] = { meta, updatedAt: now };
  }
  saveTokenCache(cache);
}
