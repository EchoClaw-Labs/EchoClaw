import { EchoError, ErrorCodes } from "../../errors.js";
import { loadConfig } from "../../config/store.js";
import logger from "../../utils/logger.js";
import { TokenBucket, ConcurrencyLimiter } from "../../utils/rateLimit.js";
import { SUBGRAPH_DEFAULTS } from "./constants.js";
import * as Q from "./queries.js";
import type {
  GraphQLResponse,
  SubgraphMeta,
  SubgraphPool,
  SubgraphSwap,
  SubgraphMint,
  SubgraphBurn,
  SubgraphCollect,
  SubgraphPoolDayData,
  SubgraphPoolHourData,
  SubgraphDexDayData,
  SubgraphToken,
} from "./types.js";

// --- Rate limiting instances ---

const bucket = new TokenBucket(SUBGRAPH_DEFAULTS.RATE_LIMIT_PER_SEC);
const limiter = new ConcurrencyLimiter(SUBGRAPH_DEFAULTS.MAX_CONCURRENT);

// --- Helpers ---

function getSubgraphUrl(): string {
  return loadConfig().services.jaineSubgraphUrl;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof EchoError) {
    return err.code === ErrorCodes.SUBGRAPH_RATE_LIMITED ||
           err.code === ErrorCodes.SUBGRAPH_TIMEOUT ||
           err.code === ErrorCodes.SUBGRAPH_API_ERROR;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = SUBGRAPH_DEFAULTS.MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isRetryable(err) || attempt === maxRetries) throw lastError;
      const backoff = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      logger.warn(`[Subgraph] Retry ${attempt + 1}/${maxRetries} after ${Math.round(backoff)}ms: ${lastError.message}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

// --- Core GraphQL POST ---

async function postGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  await bucket.acquire();
  await limiter.acquire();

  const start = Date.now();

  try {
    return await withRetry(async () => {
      const url = getSubgraphUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SUBGRAPH_DEFAULTS.TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });

        if (res.status === 429) {
          throw new EchoError(ErrorCodes.SUBGRAPH_RATE_LIMITED, "Subgraph HTTP 429");
        }
        if (!res.ok) {
          throw new EchoError(ErrorCodes.SUBGRAPH_API_ERROR, `Subgraph HTTP ${res.status}`);
        }

        const json = (await res.json()) as GraphQLResponse<T>;

        if (json.errors && json.errors.length > 0) {
          const msg = json.errors.map(e => e.message).join("; ");
          throw new EchoError(ErrorCodes.SUBGRAPH_INVALID_RESPONSE, `GraphQL errors: ${msg}`);
        }

        if (!json.data) {
          throw new EchoError(ErrorCodes.SUBGRAPH_INVALID_RESPONSE, "Missing data in response");
        }

        return json.data;
      } catch (err) {
        if (err instanceof EchoError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new EchoError(
            ErrorCodes.SUBGRAPH_TIMEOUT,
            `Subgraph request timed out after ${SUBGRAPH_DEFAULTS.TIMEOUT_MS}ms`,
            "Try again or check network connectivity"
          );
        }
        throw new EchoError(
          ErrorCodes.SUBGRAPH_API_ERROR,
          err instanceof Error ? err.message : "Subgraph request failed"
        );
      } finally {
        clearTimeout(timer);
      }
    });
  } finally {
    limiter.release();
    const durationMs = Date.now() - start;
    logger.debug(`[Subgraph] query ${durationMs}ms`);
  }
}

// --- Public API ---

interface PaginationOpts {
  limit?: number;
  skip?: number;
}

export const subgraphClient = {
  async getMeta(): Promise<SubgraphMeta> {
    const data = await postGraphQL<{ _meta: SubgraphMeta }>(Q.META);
    return data._meta;
  },

  async getTopPools(limit: number = SUBGRAPH_DEFAULTS.DEFAULT_POOL_LIMIT, skip = 0): Promise<SubgraphPool[]> {
    const data = await postGraphQL<{ pools: SubgraphPool[] }>(Q.POOLS_TOP_TVL, {
      first: Math.min(limit, 1000),
      skip,
    });
    return data.pools;
  },

  async getPoolsForToken(token: string, opts?: PaginationOpts): Promise<SubgraphPool[]> {
    const data = await postGraphQL<{ pools: SubgraphPool[] }>(Q.POOLS_FOR_TOKEN, {
      token: token.toLowerCase(),
      first: Math.min(opts?.limit ?? 100, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.pools;
  },

  async getPoolsForPair(tokenA: string, tokenB: string, opts?: PaginationOpts): Promise<SubgraphPool[]> {
    const data = await postGraphQL<{ pools: SubgraphPool[] }>(Q.POOLS_FOR_PAIR, {
      tokenA: tokenA.toLowerCase(),
      tokenB: tokenB.toLowerCase(),
      first: Math.min(opts?.limit ?? 100, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.pools;
  },

  async getNewestPools(limit = 20): Promise<SubgraphPool[]> {
    const data = await postGraphQL<{ pools: SubgraphPool[] }>(Q.NEWEST_POOLS, {
      first: Math.min(limit, 1000),
    });
    return data.pools;
  },

  async getPool(id: string): Promise<SubgraphPool | null> {
    const data = await postGraphQL<{ pool: SubgraphPool | null }>(Q.POOL_GET, {
      id: id.toLowerCase(),
    });
    return data.pool;
  },

  async getPoolDayData(poolId: string, opts?: PaginationOpts): Promise<SubgraphPoolDayData[]> {
    const data = await postGraphQL<{ poolDayDatas: SubgraphPoolDayData[] }>(Q.POOL_DAY_DATA, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 30, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.poolDayDatas;
  },

  async getPoolHourData(poolId: string, opts?: PaginationOpts): Promise<SubgraphPoolHourData[]> {
    const data = await postGraphQL<{ poolHourDatas: SubgraphPoolHourData[] }>(Q.POOL_HOUR_DATA, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 24, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.poolHourDatas;
  },

  async getRecentSwaps(poolId: string, opts?: PaginationOpts): Promise<SubgraphSwap[]> {
    const data = await postGraphQL<{ swaps: SubgraphSwap[] }>(Q.RECENT_SWAPS, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 20, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.swaps;
  },

  async getMints(poolId: string, opts?: PaginationOpts): Promise<SubgraphMint[]> {
    const data = await postGraphQL<{ mints: SubgraphMint[] }>(Q.MINTS, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 20, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.mints;
  },

  async getBurns(poolId: string, opts?: PaginationOpts): Promise<SubgraphBurn[]> {
    const data = await postGraphQL<{ burns: SubgraphBurn[] }>(Q.BURNS, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 20, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.burns;
  },

  async getCollects(poolId: string, opts?: PaginationOpts): Promise<SubgraphCollect[]> {
    const data = await postGraphQL<{ collects: SubgraphCollect[] }>(Q.COLLECTS, {
      poolId: poolId.toLowerCase(),
      first: Math.min(opts?.limit ?? 20, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.collects;
  },

  async getDexDayData(limit = 30): Promise<SubgraphDexDayData[]> {
    const data = await postGraphQL<{ jaineDexDayDatas: SubgraphDexDayData[] }>(Q.DEX_DAY_DATA, {
      first: Math.min(limit, 1000),
    });
    return data.jaineDexDayDatas;
  },

  async getToken(id: string): Promise<SubgraphToken | null> {
    const data = await postGraphQL<{ token: SubgraphToken | null }>(Q.TOKEN_INFO, {
      id: id.toLowerCase(),
    });
    return data.token;
  },

  async getTopTokens(opts?: PaginationOpts & { by?: "tvl" | "volume" }): Promise<SubgraphToken[]> {
    const query = opts?.by === "volume" ? Q.TOP_TOKENS_BY_VOLUME : Q.TOP_TOKENS_BY_TVL;
    const data = await postGraphQL<{ tokens: SubgraphToken[] }>(query, {
      first: Math.min(opts?.limit ?? 20, 1000),
      skip: opts?.skip ?? 0,
    });
    return data.tokens;
  },
};
