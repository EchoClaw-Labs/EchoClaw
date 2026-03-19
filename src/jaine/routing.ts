import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import { loadPoolsCache, type PoolInfo, type PoolsCache } from "./poolCache.js";
import { encodePath, encodePathForExactOutput, formatPath } from "./pathEncoding.js";
import { getTokenSymbol } from "./coreTokens.js";
import { QUOTER_ABI } from "./abi/quoter.js";
import { getPublicClient } from "../wallet/client.js";
import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_CANDIDATES = 20;

export interface Route {
  tokens: Address[];
  fees: number[];
  pools: Address[];
}

export interface QuotedRoute extends Route {
  amountIn: bigint;
  amountOut: bigint;
  encodedPath: Hex;
  gasEstimate: bigint;
}

/**
 * Build a graph of pools for routing
 */
function buildPoolGraph(
  pools: PoolInfo[]
): Map<string, Map<string, PoolInfo[]>> {
  // Graph: token -> (neighbor token -> pools)
  const graph = new Map<string, Map<string, PoolInfo[]>>();

  const ensureNode = (token: string) => {
    if (!graph.has(token)) {
      graph.set(token, new Map());
    }
  };

  for (const pool of pools) {
    const t0 = pool.token0.toLowerCase();
    const t1 = pool.token1.toLowerCase();

    ensureNode(t0);
    ensureNode(t1);

    // Add bidirectional edges
    const t0Neighbors = graph.get(t0)!;
    const t1Neighbors = graph.get(t1)!;

    if (!t0Neighbors.has(t1)) {
      t0Neighbors.set(t1, []);
    }
    t0Neighbors.get(t1)!.push(pool);

    if (!t1Neighbors.has(t0)) {
      t1Neighbors.set(t0, []);
    }
    t1Neighbors.get(t0)!.push(pool);
  }

  return graph;
}

/**
 * BFS to find all routes between tokenIn and tokenOut
 */
function findAllRoutes(
  tokenIn: Address,
  tokenOut: Address,
  pools: PoolInfo[],
  maxHops: number
): Route[] {
  const graph = buildPoolGraph(pools);
  const routes: Route[] = [];
  const inLower = tokenIn.toLowerCase();
  const outLower = tokenOut.toLowerCase();

  // BFS state: [currentToken, path of tokens, path of fees, path of pool addresses, visited set]
  type BFSState = {
    current: string;
    tokens: Address[];
    fees: number[];
    pools: Address[];
    visited: Set<string>;
  };

  const queue: BFSState[] = [
    {
      current: inLower,
      tokens: [getAddress(tokenIn)],
      fees: [],
      pools: [],
      visited: new Set([inLower]),
    },
  ];

  while (queue.length > 0) {
    const state = queue.shift()!;
    const { current, tokens, fees, pools: routePools, visited } = state;

    // Check if we reached destination
    if (current === outLower) {
      routes.push({
        tokens: [...tokens],
        fees: [...fees],
        pools: [...routePools],
      });
      continue;
    }

    // Don't explore further if max hops reached
    if (tokens.length > maxHops) {
      continue;
    }

    // Get neighbors
    const neighbors = graph.get(current);
    if (!neighbors) continue;

    for (const [neighborToken, poolsToNeighbor] of neighbors) {
      // Skip if already visited (no cycles)
      if (visited.has(neighborToken)) continue;

      // For each pool option to this neighbor
      for (const pool of poolsToNeighbor) {
        queue.push({
          current: neighborToken,
          tokens: [...tokens, getAddress(neighborToken as Address)],
          fees: [...fees, pool.fee],
          pools: [...routePools, pool.address],
          visited: new Set([...visited, neighborToken]),
        });
      }
    }
  }

  return routes;
}

/**
 * Quote a route using the quoter contract
 */
async function quoteRoute(
  route: Route,
  amountIn: bigint,
  quoterAddress: Address,
  direction: "exactInput" | "exactOutput"
): Promise<QuotedRoute | null> {
  const client = getPublicClient();

  try {
    if (direction === "exactInput") {
      const path = encodePath(route.tokens, route.fees);

      // QuoterV1 returns single uint256, not tuple
      const amountOut = await client.readContract({
        address: quoterAddress,
        abi: QUOTER_ABI,
        functionName: "quoteExactInput",
        args: [path, amountIn],
      });

      return {
        ...route,
        amountIn,
        amountOut,
        encodedPath: path,
        gasEstimate: 0n,
      };
    } else {
      // exactOutput - path is reversed
      const path = encodePathForExactOutput(route.tokens, route.fees);

      // QuoterV1 returns single uint256, not tuple
      const amountInRequired = await client.readContract({
        address: quoterAddress,
        abi: QUOTER_ABI,
        functionName: "quoteExactOutput",
        args: [path, amountIn], // amountIn is actually amountOut for exactOutput
      });

      return {
        ...route,
        amountIn: amountInRequired,
        amountOut: amountIn, // The desired output
        encodedPath: path,
        gasEstimate: 0n,
      };
    }
  } catch (err) {
    logger.debug(`Quote failed for route: ${err}`);
    return null;
  }
}

export interface FindRouteOptions {
  maxHops?: number;
  maxCandidates?: number;
  cache?: PoolsCache | null;
}

/**
 * Find the best route for a swap (exactInput)
 * @param tokenIn - Input token address
 * @param tokenOut - Output token address
 * @param amountIn - Input amount
 * @param options - Routing options
 * @returns Best route or null if no route found
 */
export async function findBestRouteExactInput(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  options: FindRouteOptions = {}
): Promise<QuotedRoute | null> {
  const { maxHops = DEFAULT_MAX_HOPS, maxCandidates = DEFAULT_MAX_CANDIDATES } = options;
  const cache = options.cache !== undefined ? options.cache : loadPoolsCache();

  if (!cache || cache.pools.length === 0) {
    throw new EchoError(
      ErrorCodes.NO_ROUTE_FOUND,
      "Pool cache is empty",
      "Run: echoclaw jaine pools scan-core"
    );
  }

  const cfg = loadConfig();
  const quoterAddress = cfg.protocol.quoter;

  // Find all possible routes
  const routes = findAllRoutes(tokenIn, tokenOut, cache.pools, maxHops);

  if (routes.length === 0) {
    return null;
  }

  // Limit candidates
  const candidates = routes.slice(0, maxCandidates);

  // Quote all routes in parallel (with limit)
  const quotedRoutes: QuotedRoute[] = [];

  // Process in batches of 5 to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((route) => quoteRoute(route, amountIn, quoterAddress, "exactInput"))
    );

    for (const result of results) {
      if (result) {
        quotedRoutes.push(result);
      }
    }
  }

  if (quotedRoutes.length === 0) {
    return null;
  }

  // Sort by amountOut descending, then by fewer hops
  quotedRoutes.sort((a, b) => {
    const amountDiff = b.amountOut - a.amountOut;
    if (amountDiff !== 0n) {
      return amountDiff > 0n ? 1 : -1;
    }
    return a.tokens.length - b.tokens.length;
  });

  return quotedRoutes[0];
}

/**
 * Find the best route for a swap (exactOutput)
 * @param tokenIn - Input token address
 * @param tokenOut - Output token address
 * @param amountOut - Desired output amount
 * @param options - Routing options
 * @returns Best route or null if no route found
 */
export async function findBestRouteExactOutput(
  tokenIn: Address,
  tokenOut: Address,
  amountOut: bigint,
  options: FindRouteOptions = {}
): Promise<QuotedRoute | null> {
  const { maxHops = DEFAULT_MAX_HOPS, maxCandidates = DEFAULT_MAX_CANDIDATES } = options;
  const cache = options.cache !== undefined ? options.cache : loadPoolsCache();

  if (!cache || cache.pools.length === 0) {
    throw new EchoError(
      ErrorCodes.NO_ROUTE_FOUND,
      "Pool cache is empty",
      "Run: echoclaw jaine pools scan-core"
    );
  }

  const cfg = loadConfig();
  const quoterAddress = cfg.protocol.quoter;

  // Find all possible routes
  const routes = findAllRoutes(tokenIn, tokenOut, cache.pools, maxHops);

  if (routes.length === 0) {
    return null;
  }

  // Limit candidates
  const candidates = routes.slice(0, maxCandidates);

  // Quote all routes
  const quotedRoutes: QuotedRoute[] = [];

  const batchSize = 5;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((route) => quoteRoute(route, amountOut, quoterAddress, "exactOutput"))
    );

    for (const result of results) {
      if (result) {
        quotedRoutes.push(result);
      }
    }
  }

  if (quotedRoutes.length === 0) {
    return null;
  }

  // Sort by amountIn ascending (minimize input), then by fewer hops
  quotedRoutes.sort((a, b) => {
    const amountDiff = a.amountIn - b.amountIn;
    if (amountDiff !== 0n) {
      return amountDiff > 0n ? 1 : -1;
    }
    return a.tokens.length - b.tokens.length;
  });

  return quotedRoutes[0];
}

/**
 * Format route for display
 */
export function formatRoute(
  route: Route,
  userAliases?: Record<string, Address>
): string {
  return formatPath(route.tokens, route.fees, (addr) =>
    getTokenSymbol(addr, userAliases)
  );
}
