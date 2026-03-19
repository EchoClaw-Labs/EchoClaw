/**
 * Subgraph response types.
 * All BigInt/BigDecimal scalars come as strings from GraphQL JSON.
 * Conversion to number/bigint happens in the mapping layer.
 */

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// --- Core entity types ---

export interface SubgraphToken {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
  totalSupply: string;
  volume: string;
  volumeUSD: string;
  untrackedVolumeUSD: string;
  feesUSD: string;
  txCount: string;
  poolCount: string;
  totalValueLocked: string;
  totalValueLockedUSD: string;
  totalValueLockedUSDUntracked: string;
  derivedETH: string;
}

export interface SubgraphPool {
  id: string;
  createdAtTimestamp: string;
  createdAtBlockNumber: string;
  token0: { id: string; symbol: string; name: string; decimals: string };
  token1: { id: string; symbol: string; name: string; decimals: string };
  feeTier: string;
  liquidity: string;
  sqrtPrice: string;
  token0Price: string;
  token1Price: string;
  tick: string | null;
  observationIndex: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  totalValueLockedToken0: string;
  totalValueLockedToken1: string;
  totalValueLockedUSD: string;
  totalValueLockedETH: string;
  liquidityProviderCount: string;
}

export interface SubgraphSwap {
  id: string;
  timestamp: string;
  pool: { id: string };
  token0: { id: string; symbol: string };
  token1: { id: string; symbol: string };
  sender: string;
  recipient: string;
  origin: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  sqrtPriceX96: string;
  tick: string;
}

export interface SubgraphMint {
  id: string;
  timestamp: string;
  pool: { id: string };
  token0: { id: string; symbol: string };
  token1: { id: string; symbol: string };
  owner: string;
  sender: string | null;
  origin: string;
  amount: string;
  amount0: string;
  amount1: string;
  amountUSD: string | null;
  tickLower: string;
  tickUpper: string;
}

export interface SubgraphBurn {
  id: string;
  timestamp: string;
  pool: { id: string };
  token0: { id: string; symbol: string };
  token1: { id: string; symbol: string };
  owner: string | null;
  origin: string;
  amount: string;
  amount0: string;
  amount1: string;
  amountUSD: string | null;
  tickLower: string;
  tickUpper: string;
}

export interface SubgraphCollect {
  id: string;
  timestamp: string;
  pool: { id: string };
  owner: string | null;
  amount0: string;
  amount1: string;
  amountUSD: string | null;
  tickLower: string;
  tickUpper: string;
}

export interface SubgraphPoolDayData {
  id: string;
  date: number;
  pool: { id: string };
  liquidity: string;
  sqrtPrice: string;
  token0Price: string;
  token1Price: string;
  tick: string | null;
  tvlUSD: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SubgraphPoolHourData {
  id: string;
  periodStartUnix: number;
  pool: { id: string };
  liquidity: string;
  sqrtPrice: string;
  token0Price: string;
  token1Price: string;
  tick: string | null;
  tvlUSD: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SubgraphDexDayData {
  id: string;
  date: number;
  volumeETH: string;
  volumeUSD: string;
  volumeUSDUntracked: string;
  feesUSD: string;
  txCount: string;
  tvlUSD: string;
}

export interface SubgraphMeta {
  block: { number: number; timestamp: number | null; hash: string | null };
  deployment: string;
  hasIndexingErrors: boolean;
}
