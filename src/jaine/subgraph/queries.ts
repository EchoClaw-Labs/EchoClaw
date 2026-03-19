/**
 * GraphQL query strings for Jaine V3 subgraph.
 * Plain strings — zero npm dependencies.
 */

const POOL_FIELDS = `
  id
  createdAtTimestamp
  createdAtBlockNumber
  token0 { id symbol name decimals }
  token1 { id symbol name decimals }
  feeTier
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  observationIndex
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  totalValueLockedToken0
  totalValueLockedToken1
  totalValueLockedUSD
  totalValueLockedETH
  liquidityProviderCount
`;

const TOKEN_FIELDS = `
  id
  symbol
  name
  decimals
  totalSupply
  volume
  volumeUSD
  untrackedVolumeUSD
  feesUSD
  txCount
  poolCount
  totalValueLocked
  totalValueLockedUSD
  totalValueLockedUSDUntracked
  derivedETH
`;

const POOL_DAY_DATA_FIELDS = `
  id
  date
  pool { id }
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  tvlUSD
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  open high low close
`;

const POOL_HOUR_DATA_FIELDS = `
  id
  periodStartUnix
  pool { id }
  liquidity
  sqrtPrice
  token0Price
  token1Price
  tick
  tvlUSD
  volumeToken0
  volumeToken1
  volumeUSD
  feesUSD
  txCount
  open high low close
`;

const SWAP_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  sender
  recipient
  origin
  amount0
  amount1
  amountUSD
  sqrtPriceX96
  tick
`;

const MINT_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  owner
  sender
  origin
  amount
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

const BURN_FIELDS = `
  id
  timestamp
  pool { id }
  token0 { id symbol }
  token1 { id symbol }
  owner
  origin
  amount
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

const COLLECT_FIELDS = `
  id
  timestamp
  pool { id }
  owner
  amount0
  amount1
  amountUSD
  tickLower
  tickUpper
`;

const DEX_DAY_DATA_FIELDS = `
  id
  date
  volumeETH
  volumeUSD
  volumeUSDUntracked
  feesUSD
  txCount
  tvlUSD
`;

// --- Queries ---

export const META = `{
  _meta {
    block { number timestamp hash }
    deployment
    hasIndexingErrors
  }
}`;

export const POOLS_TOP_TVL = `query PoolsTopTvl($first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOLS_FOR_TOKEN = `query PoolsForToken($token: Bytes!, $first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
    where: { or: [{ token0: $token }, { token1: $token }] }
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOLS_FOR_PAIR = `query PoolsForPair($tokenA: Bytes!, $tokenB: Bytes!, $first: Int!, $skip: Int!) {
  pools(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
    where: { or: [
      { token0: $tokenA, token1: $tokenB },
      { token0: $tokenB, token1: $tokenA }
    ] }
  ) {
    ${POOL_FIELDS}
  }
}`;

export const NEWEST_POOLS = `query NewestPools($first: Int!) {
  pools(
    first: $first
    orderBy: createdAtTimestamp
    orderDirection: desc
  ) {
    ${POOL_FIELDS}
  }
}`;

export const POOL_GET = `query PoolGet($id: ID!) {
  pool(id: $id) {
    ${POOL_FIELDS}
  }
}`;

export const POOL_DAY_DATA = `query PoolDayData($poolId: String!, $first: Int!, $skip: Int!) {
  poolDayDatas(
    first: $first
    skip: $skip
    orderBy: date
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${POOL_DAY_DATA_FIELDS}
  }
}`;

export const POOL_HOUR_DATA = `query PoolHourData($poolId: String!, $first: Int!, $skip: Int!) {
  poolHourDatas(
    first: $first
    skip: $skip
    orderBy: periodStartUnix
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${POOL_HOUR_DATA_FIELDS}
  }
}`;

export const RECENT_SWAPS = `query RecentSwaps($poolId: String!, $first: Int!, $skip: Int!) {
  swaps(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${SWAP_FIELDS}
  }
}`;

export const MINTS = `query Mints($poolId: String!, $first: Int!, $skip: Int!) {
  mints(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${MINT_FIELDS}
  }
}`;

export const BURNS = `query Burns($poolId: String!, $first: Int!, $skip: Int!) {
  burns(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${BURN_FIELDS}
  }
}`;

export const COLLECTS = `query Collects($poolId: String!, $first: Int!, $skip: Int!) {
  collects(
    first: $first
    skip: $skip
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolId }
  ) {
    ${COLLECT_FIELDS}
  }
}`;

export const DEX_DAY_DATA = `query DexDayData($first: Int!) {
  jaineDexDayDatas(
    first: $first
    orderBy: date
    orderDirection: desc
  ) {
    ${DEX_DAY_DATA_FIELDS}
  }
}`;

export const TOKEN_INFO = `query TokenInfo($id: ID!) {
  token(id: $id) {
    ${TOKEN_FIELDS}
  }
}`;

export const TOP_TOKENS_BY_TVL = `query TopTokensByTvl($first: Int!, $skip: Int!) {
  tokens(
    first: $first
    skip: $skip
    orderBy: totalValueLockedUSD
    orderDirection: desc
  ) {
    ${TOKEN_FIELDS}
  }
}`;

export const TOP_TOKENS_BY_VOLUME = `query TopTokensByVolume($first: Int!, $skip: Int!) {
  tokens(
    first: $first
    skip: $skip
    orderBy: volumeUSD
    orderDirection: desc
  ) {
    ${TOKEN_FIELDS}
  }
}`;
