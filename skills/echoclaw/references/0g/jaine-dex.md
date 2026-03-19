# Jaine DEX Reference

This module is the authoritative guide for `echoclaw jaine` trading commands:
- token aliases
- pool discovery/cache
- w0G wrap/unwrap
- allowances
- swaps
- LP position lifecycle

## Scope

In scope:
- `echoclaw jaine tokens *`
- `echoclaw jaine pools *`
- `echoclaw jaine w0g *`
- `echoclaw jaine allowance *`
- `echoclaw jaine swap *`
- `echoclaw jaine lp *`

Out of scope:
- `echoclaw jaine subgraph *` (separate module: `references/jaine-subgraph.md`)
- wallet setup/import/backup and native transfers (see `references/wallet-transfers.md`)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- config initialized (`echoclaw config init --json`)
- for signing operations: wallet + keystore + `ECHO_KEYSTORE_PASSWORD`

Important dependency:
- route search for `swap` and `pools find --amount-in` requires local pool cache
- refresh cache with: `echoclaw jaine pools scan-core --json`

## Command Map

### 1) Token aliases

```bash
echoclaw jaine tokens list --json
echoclaw jaine tokens add-alias <symbol> <address> --json
echoclaw jaine tokens remove-alias <symbol> --json
```

### 2) Pool discovery and cache

```bash
echoclaw jaine pools scan-core [--source subgraph|rpc] [--max-pools <n>] [--fee-tiers <csv>] --json
echoclaw jaine pools for-token <token> --json
echoclaw jaine pools find <tokenIn> <tokenOut> [--amount-in <amount>] --json
```

Notes:
- default source: `subgraph`
- default `max-pools`: `500`
- default fee tiers: `100,500,3000,10000`

### 3) Wrapped 0G

```bash
echoclaw jaine w0g balance --json
echoclaw jaine w0g wrap --amount <0G> --yes --json
echoclaw jaine w0g unwrap --amount <w0G> --yes --json
```

### 4) Allowances

```bash
echoclaw jaine allowance show <token> [--spender router|nft] --json
echoclaw jaine allowance revoke <token> [--spender router|nft] --yes --json
```

Caveat:
- in current implementation `allowance show --spender ...` is accepted but output still includes both router and nft allowances.

### 5) Swaps

```bash
echoclaw jaine swap sell <tokenIn> <tokenOut> \
  --amount-in <amount> \
  [--slippage-bps <bps>] [--deadline-sec <sec>] [--recipient <address>] \
  [--max-hops <n>] [--approve-exact] [--dry-run] [--yes] --json

echoclaw jaine swap buy <tokenIn> <tokenOut> \
  --amount-out <amount> \
  [--slippage-bps <bps>] [--deadline-sec <sec>] [--recipient <address>] \
  [--max-hops <n>] [--approve-exact] [--dry-run] [--yes] --json
```

Defaults:
- `--slippage-bps`: `50`
- `--deadline-sec`: `90`
- `--max-hops`: `3` (internally clamped to `1..4`)

### 6) LP positions

```bash
echoclaw jaine lp list --json
echoclaw jaine lp show <tokenId> --json

echoclaw jaine lp add \
  --token0 <token> --token1 <token> --fee <100|500|3000|10000> \
  --amount0 <amount> --amount1 <amount> --yes \
  [--range-pct <percent>] [--tick-lower <tick>] [--tick-upper <tick>] \
  [--create-pool] [--sqrt-price-x96 <uint160>] [--approve-exact] --json

echoclaw jaine lp increase <tokenId> \
  --amount0 <amount> --amount1 <amount> --yes [--approve-exact] --json

echoclaw jaine lp collect <tokenId> --yes [--recipient <address>] --json

echoclaw jaine lp remove <tokenId> \
  --percent <1-100> --yes [--burn] [--slippage-bps <bps>] --json

echoclaw jaine lp rebalance <tokenId> --range-pct <percent> --yes --json
```

LP behavior:
- `lp add` auto-sorts token pair by address
- `lp remove` executes atomic multicall: decreaseLiquidity -> collect -> optional burn
- `lp rebalance` is instruction-only (does not submit a single atomic rebalance tx)
- `--burn` is effective only with `--percent 100`
- `--slippage-bps` is validated in `lp remove`, but min amounts are currently set to `0` in tx params

## Agent-safe flows

### Flow A: discovery only (no signing)

```bash
echoclaw jaine tokens list --json
echoclaw jaine pools scan-core --json
echoclaw jaine pools for-token USDC --json
echoclaw jaine pools find w0G USDC --amount-in 1 --json
```

### Flow B: sell swap (dry-run -> execute)

```bash
echoclaw wallet ensure --json
echoclaw jaine pools scan-core --json
echoclaw jaine swap sell w0G USDC --amount-in 5 --dry-run --json
echoclaw jaine swap sell w0G USDC --amount-in 5 --yes --json
```

### Flow C: LP lifecycle

```bash
echoclaw wallet ensure --json
echoclaw jaine pools scan-core --json
echoclaw jaine lp add --token0 w0G --token1 USDC --fee 3000 --amount0 5 --amount1 100 --range-pct 10 --yes --json
echoclaw jaine lp list --json
echoclaw jaine lp collect <tokenId> --yes --json
echoclaw jaine lp remove <tokenId> --percent 100 --burn --yes --json
```

### Flow D: approval hygiene

```bash
echoclaw jaine allowance show USDC --json
echoclaw jaine allowance revoke USDC --spender router --yes --json
echoclaw jaine allowance revoke USDC --spender nft --yes --json
```

## JSON contracts (stable shapes)

Swap sell dry-run:

```json
{
  "success": true,
  "dryRun": true,
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "amountOut": "987654321000000000",
  "amountOutMinimum": "982716054000000000",
  "route": "w0G -> [0.3%] -> USDC",
  "hops": 1,
  "slippageBps": 50
}
```

Swap sell execute:

```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://chainscan.0g.ai/tx/0x...",
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "amountOutExpected": "987654321000000000",
  "amountOutMinimum": "982716054000000000",
  "route": "w0G -> [0.3%] -> USDC",
  "recipient": "0x..."
}
```

Pools scan-core:

```json
{
  "success": true,
  "source": "subgraph",
  "poolsFound": 42,
  "generatedAt": "2026-...",
  "pools": []
}
```

W0G wrap:

```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://chainscan.0g.ai/tx/0x...",
  "amount": "1000000000000000000",
  "formatted": "1"
}
```

Allowance show:

```json
{
  "success": true,
  "token": "0x...",
  "symbol": "USDC",
  "allowances": {
    "router": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "nft": "0"
  },
  "formatted": {
    "router": "unlimited",
    "nft": "0"
  }
}
```

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "NO_ROUTE_FOUND",
    "message": "Pool cache is empty",
    "hint": "Run: echoclaw jaine pools scan-core"
  }
}
```

## Error codes (jaine-relevant)

Primary:
- `POOL_NOT_FOUND`
- `NO_ROUTE_FOUND`
- `APPROVAL_FAILED`
- `SWAP_FAILED`
- `POSITION_NOT_FOUND`
- `LP_OPERATION_FAILED`
- `INVALID_FEE_TIER`
- `INVALID_SLIPPAGE`
- `TOKEN_NOT_FOUND`
- `INVALID_SPENDER`

Shared/common in command path:
- `WALLET_NOT_CONFIGURED`
- `KEYSTORE_PASSWORD_NOT_SET`
- `KEYSTORE_DECRYPT_FAILED`
- `CONFIRMATION_REQUIRED`
- `INVALID_ADDRESS`
- `INVALID_AMOUNT`
- `RPC_ERROR`

## Safety rules

1. Always refresh cache (`pools scan-core`) before route-dependent operations.
2. Always do swap `--dry-run` before execution.
3. Never run mutating commands without explicit `--yes`.
4. Prefer `--approve-exact` for untrusted tokens/sessions.
5. Revoke allowances after trading sessions.
6. Treat response with `"success": false` as authoritative and stop flow.

## Cross-references

- Wallet/setup/send: `references/wallet-transfers.md`
- Read-only market analytics: `references/jaine-subgraph.md` 
