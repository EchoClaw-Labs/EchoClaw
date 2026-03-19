# Jaine Subgraph Reference

This module is the authoritative guide for read-only market intelligence via:
`echoclaw jaine subgraph ...`

## Scope

In scope:
- `echoclaw jaine subgraph meta`
- `echoclaw jaine subgraph pools *`
- `echoclaw jaine subgraph pool *`
- `echoclaw jaine subgraph swaps`
- `echoclaw jaine subgraph lp *`
- `echoclaw jaine subgraph dex-stats`
- `echoclaw jaine subgraph token`
- `echoclaw jaine subgraph top-tokens`

Out of scope:
- on-chain trading and LP tx execution (`references/jaine-dex.md`)
- wallet lifecycle and native transfers (`references/wallet-transfers.md`)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- config initialized (`echoclaw config init --json`)
- `services.jaineSubgraphUrl` available in config (default Goldsky endpoint)

No wallet, no keystore password, and no `--yes` are required.

## Command Map

### Root

```bash
echoclaw jaine subgraph meta --json
echoclaw jaine subgraph pools --help
echoclaw jaine subgraph pool --help
echoclaw jaine subgraph swaps <pool> [--limit <n>] --json
echoclaw jaine subgraph lp --help
echoclaw jaine subgraph dex-stats [--days <n>] --json
echoclaw jaine subgraph token <address> --json
echoclaw jaine subgraph top-tokens [--limit <n>] [--by tvl|volume] --json
```

### Pools group

```bash
echoclaw jaine subgraph pools top [--limit <n>] [--min-tvl <usd>] --json
echoclaw jaine subgraph pools newest [--limit <n>] --json
echoclaw jaine subgraph pools for-token <token> [--limit <n>] --json
echoclaw jaine subgraph pools for-pair <tokenA> <tokenB> [--limit <n>] --json
```

Defaults:
- `--limit` default: `20`

### Pool (single pool) group

```bash
echoclaw jaine subgraph pool info <id> --json
echoclaw jaine subgraph pool days <id> [--days <n>] --json
echoclaw jaine subgraph pool hours <id> [--hours <n>] --json
```

Defaults:
- `--days` default: `7`
- `--hours` default: `24`

### LP events group

```bash
echoclaw jaine subgraph lp mints <pool> [--limit <n>] --json
echoclaw jaine subgraph lp burns <pool> [--limit <n>] --json
echoclaw jaine subgraph lp collects <pool> [--limit <n>] --json
```

## Input Validation and Limits

- Address args are validated with EVM address validation and normalized to lowercase.
- Numeric limit-like args are validated to range `1..1000`.
- Invalid `--by` in `top-tokens` falls back to `tvl` (only `volume` switches mode).

## JSON Contracts (stable shapes)

Subgraph meta:

```json
{
  "success": true,
  "meta": {
    "block": { "number": 123456, "timestamp": 1710000000, "hash": "0x..." },
    "deployment": "Qm...",
    "hasIndexingErrors": false
  }
}
```

Top pools:

```json
{
  "success": true,
  "pools": [
    {
      "id": "0x...",
      "feeTier": "3000",
      "totalValueLockedUSD": "12345.67",
      "volumeUSD": "98765.43",
      "txCount": "123",
      "token0": { "id": "0x...", "symbol": "w0G", "name": "Wrapped 0G", "decimals": "18" },
      "token1": { "id": "0x...", "symbol": "USDC", "name": "USD Coin", "decimals": "6" }
    }
  ]
}
```

Pool day data:

```json
{
  "success": true,
  "poolId": "0x...",
  "dayData": [
    {
      "date": 1710000000,
      "tvlUSD": "12345.67",
      "volumeUSD": "456.78",
      "feesUSD": "1.23",
      "open": "1.01",
      "high": "1.05",
      "low": "0.99",
      "close": "1.02",
      "txCount": "42"
    }
  ]
}
```

Top tokens:

```json
{
  "success": true,
  "tokens": [
    {
      "id": "0x...",
      "symbol": "w0G",
      "name": "Wrapped 0G",
      "totalValueLockedUSD": "12345.67",
      "volumeUSD": "98765.43",
      "poolCount": "12",
      "derivedETH": "0.0003"
    }
  ],
  "sortedBy": "tvl"
}
```

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "SUBGRAPH_TIMEOUT",
    "message": "Subgraph request timed out after 15000ms",
    "hint": "Try again or check network connectivity"
  }
}
```

## Error Codes (subgraph-relevant)

Command-level:
- `INVALID_ADDRESS`
- `INVALID_AMOUNT`
- `POOL_NOT_FOUND`
- `TOKEN_NOT_FOUND`

Client/network-level:
- `SUBGRAPH_API_ERROR`
- `SUBGRAPH_RATE_LIMITED`
- `SUBGRAPH_TIMEOUT`
- `SUBGRAPH_INVALID_RESPONSE`

## Reliability Model

Client behavior:
- timeout: `15000ms`
- token bucket rate limit: `5 req/sec`
- max concurrent requests: `2`
- retry policy: up to `2` retries with exponential backoff + jitter

Operational implication:
- repeated burst calls may return rate-limit/timeouts before retries recover
- for automation, prefer smaller `--limit` and incremental polling

## Agent-safe flows

### Flow A: health check + top pools

```bash
echoclaw jaine subgraph meta --json
echoclaw jaine subgraph pools top --limit 20 --json
```

### Flow B: inspect a pair and recent swaps

```bash
echoclaw jaine subgraph pools for-pair 0xTokenA 0xTokenB --limit 20 --json
echoclaw jaine subgraph swaps 0xPoolAddress --limit 20 --json
```

### Flow C: pool analytics window

```bash
echoclaw jaine subgraph pool info 0xPoolAddress --json
echoclaw jaine subgraph pool days 0xPoolAddress --days 7 --json
echoclaw jaine subgraph pool hours 0xPoolAddress --hours 24 --json
```

### Flow D: token leaderboard + macro stats

```bash
echoclaw jaine subgraph top-tokens --by volume --limit 20 --json
echoclaw jaine subgraph dex-stats --days 7 --json
```

## Safety Rules

1. Treat this module as read-only intelligence; never assume execution side effects.
2. Always pass full EVM addresses for `pool/token` args.
3. Keep `--limit` bounded for automation loops (recommended <= 100).
4. On `SUBGRAPH_*` errors, retry with backoff before changing strategy.
5. Use `meta` as first probe to detect indexing or endpoint health issues.

## Cross-references

- Trading and LP execution: `references/jaine-dex.md`
- Wallet and native transfers: `references/wallet-transfers.md`
