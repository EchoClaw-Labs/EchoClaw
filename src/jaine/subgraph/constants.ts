export const SUBGRAPH_DEFAULTS = {
  DEFAULT_URL: "https://api.goldsky.com/api/public/project_cmgl0cagfjymu01wc2mojevm6/subgraphs/jaine-v3-goldsky/0.0.2/gn",
  TIMEOUT_MS: 15_000,
  RATE_LIMIT_PER_SEC: 5,
  MAX_CONCURRENT: 2,
  MAX_RETRIES: 2,
  DEFAULT_POOL_LIMIT: 500,
} as const;
