import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address } from "viem";
import { getAddress, zeroAddress } from "viem";
import { POOLS_CACHE_FILE, ensureJaineDir } from "./paths.js";
import { FACTORY_ABI, FEE_TIERS, type FeeTier } from "./abi/factory.js";
import { getCoreTokenAddresses } from "./coreTokens.js";
import { getPublicClient } from "../wallet/client.js";
import { loadConfig } from "../config/store.js";
import logger from "../utils/logger.js";
import { subgraphClient } from "./subgraph/client.js";
import { SUBGRAPH_DEFAULTS } from "./subgraph/constants.js";

const CACHE_VERSION = 1;

export interface PoolInfo {
  address: Address;
  token0: Address;
  token1: Address;
  fee: FeeTier;
}

export interface PoolsCache {
  version: number;
  chainId: number;
  generatedAt: string;
  pools: PoolInfo[];
}

/**
 * Load pools cache from disk
 */
export function loadPoolsCache(): PoolsCache | null {
  if (!existsSync(POOLS_CACHE_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(POOLS_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as PoolsCache;

    // Validate version and chain
    if (parsed.version !== CACHE_VERSION) {
      logger.debug(`Pool cache version mismatch: ${parsed.version} != ${CACHE_VERSION}`);
      return null;
    }

    const cfg = loadConfig();
    if (parsed.chainId !== cfg.chain.chainId) {
      logger.debug(`Pool cache chain mismatch: ${parsed.chainId} != ${cfg.chain.chainId}`);
      return null;
    }

    return parsed;
  } catch (err) {
    logger.error(`Failed to parse pool cache: ${err}`);
    return null;
  }
}

/**
 * Save pools cache to disk (atomic write)
 */
export function savePoolsCache(cache: PoolsCache): void {
  ensureJaineDir();

  const dir = dirname(POOLS_CACHE_FILE);
  const tmpFile = join(dir, `.pools-cache.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(cache, null, 2), "utf-8");
    renameSync(tmpFile, POOLS_CACHE_FILE);
    logger.debug(`Pool cache saved: ${cache.pools.length} pools`);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Scan factory for pools between core tokens
 * @param feeTiers - Fee tiers to scan (defaults to all standard tiers)
 * @param onProgress - Optional progress callback (poolsFound, pairsScanned)
 */
export async function scanCorePools(
  feeTiers: readonly FeeTier[] = FEE_TIERS,
  onProgress?: (poolsFound: number, pairsScanned: number) => void
): Promise<PoolInfo[]> {
  const cfg = loadConfig();
  const client = getPublicClient();
  const factoryAddress = cfg.protocol.jaineFactory;

  const coreTokens = getCoreTokenAddresses();
  const pools: PoolInfo[] = [];
  let pairsScanned = 0;

  // Generate all unique token pairs
  const pairs: [Address, Address][] = [];
  for (let i = 0; i < coreTokens.length; i++) {
    for (let j = i + 1; j < coreTokens.length; j++) {
      pairs.push([coreTokens[i], coreTokens[j]]);
    }
  }

  // Scan each pair × fee tier sequentially (avoid rate limiting)
  for (const [tokenA, tokenB] of pairs) {
    for (const fee of feeTiers) {
      try {
        const poolAddress = await client.readContract({
          address: factoryAddress,
          abi: FACTORY_ABI,
          functionName: "getPool",
          args: [tokenA, tokenB, fee],
        });

        if (poolAddress && poolAddress !== zeroAddress) {
          // Sort tokens to ensure consistent ordering (token0 < token1)
          const [token0, token1] =
            tokenA.toLowerCase() < tokenB.toLowerCase()
              ? [tokenA, tokenB]
              : [tokenB, tokenA];

          pools.push({
            address: getAddress(poolAddress),
            token0: getAddress(token0),
            token1: getAddress(token1),
            fee,
          });
        }
      } catch (err) {
        logger.debug(`Failed to query pool ${tokenA}/${tokenB}/${fee}: ${err}`);
        // Continue scanning other pools
      }
    }
    pairsScanned++;
    if (onProgress) {
      onProgress(pools.length, pairsScanned);
    }
  }

  return pools;
}

/**
 * Get pool for specific token pair and fee
 */
export async function getPool(
  tokenA: Address,
  tokenB: Address,
  fee: FeeTier
): Promise<Address | null> {
  const cfg = loadConfig();
  const client = getPublicClient();

  try {
    const poolAddress = await client.readContract({
      address: cfg.protocol.jaineFactory,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [tokenA, tokenB, fee],
    });

    if (poolAddress && poolAddress !== zeroAddress) {
      return getAddress(poolAddress);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sync pool cache from Goldsky subgraph (fast, read-only).
 * Fetches top pools by TVL and maps them to PoolInfo format.
 */
export async function syncPoolsFromSubgraph(
  maxPools: number = SUBGRAPH_DEFAULTS.DEFAULT_POOL_LIMIT,
  onProgress?: (poolsFetched: number) => void
): Promise<PoolInfo[]> {
  const pools = await subgraphClient.getTopPools(maxPools);

  if (onProgress) onProgress(pools.length);

  // Deduplicate by pool address (lowercase) and map to PoolInfo
  const seen = new Map<string, PoolInfo>();

  for (const sp of pools) {
    const key = sp.id.toLowerCase();
    if (seen.has(key)) continue;

    const fee = parseInt(sp.feeTier, 10);
    // Only include pools with valid fee tiers
    if (!FEE_TIERS.includes(fee as FeeTier)) {
      logger.debug(`[Subgraph] Skipping pool ${sp.id} with unknown fee tier ${fee}`);
      continue;
    }

    seen.set(key, {
      address: getAddress(sp.id),
      token0: getAddress(sp.token0.id),
      token1: getAddress(sp.token1.id),
      fee: fee as FeeTier,
    });
  }

  return Array.from(seen.values());
}

/**
 * Find pools containing a specific token from cache
 */
export function findPoolsForToken(token: Address, cache?: PoolsCache | null): PoolInfo[] {
  const c = cache ?? loadPoolsCache();
  if (!c) return [];

  const tokenLower = token.toLowerCase();
  return c.pools.filter(
    (p) => p.token0.toLowerCase() === tokenLower || p.token1.toLowerCase() === tokenLower
  );
}

/**
 * Find pool between two tokens from cache
 * Returns all matching pools (different fee tiers)
 */
export function findPoolsBetweenTokens(
  tokenA: Address,
  tokenB: Address,
  cache?: PoolsCache | null
): PoolInfo[] {
  const c = cache ?? loadPoolsCache();
  if (!c) return [];

  const aLower = tokenA.toLowerCase();
  const bLower = tokenB.toLowerCase();

  return c.pools.filter((p) => {
    const t0 = p.token0.toLowerCase();
    const t1 = p.token1.toLowerCase();
    return (t0 === aLower && t1 === bLower) || (t0 === bLower && t1 === aLower);
  });
}
