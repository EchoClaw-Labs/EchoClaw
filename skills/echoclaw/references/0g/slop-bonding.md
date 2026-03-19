# Slop Bonding Reference

This module is the authoritative guide for `echoclaw slop ...` commands.

Scope:
- on-chain bonding-curve token lifecycle
- token creation and discovery
- buy/sell trading on bonding curve
- graduation progress and curve state
- creator fees, LP fees, and graduation reward

## Table of Contents

- [Prerequisites](#prerequisites)
- [Read-only vs mutating commands](#read-only-vs-mutating-commands)
- [Command Map](#command-map)
- [Trading model and graduation](#trading-model-and-graduation)
- [Agent-safe execution flows](#agent-safe-execution-flows)
- [JSON examples](#json-examples)
- [Safety rules](#safety-rules)
- [Error codes (slop-bonding scope)](#error-codes-slop-bonding-scope)
- [Cross-references](#cross-references)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- Config initialized (`echoclaw config init --json`)
- Wallet + keystore configured
- `ECHO_KEYSTORE_PASSWORD` available for signing operations

Critical config dependencies:
- `chain.rpcUrl`
- `chain.explorerUrl`
- `slop.factory`
- `slop.tokenRegistry`
- `slop.feeCollector`

## Read-only vs mutating commands

Read-only:
- `token info`
- `tokens mine`
- `price`
- `curve`
- `fees stats`
- `fees lp pending`
- `reward pending`

Mutating (requires signing):
- `token create --yes`
- `trade buy ... --yes` (unless `--dry-run`)
- `trade sell ... --yes` (unless `--dry-run`)
- `fees claim-creator --yes`
- `fees lp collect --yes`
- `reward claim --yes`

## Command Map

### 1) Token lifecycle

```bash
echoclaw slop token create --name <name> --symbol <symbol> [--description <text>] [--image-url <url>] [--twitter <handle>] [--telegram <handle>] [--website <url>] [--user-salt <hex>] --yes --json
echoclaw slop token info <token> --json
echoclaw slop tokens mine [--creator <address>] --json
```

Notes:
- `token create` requires `--yes`.
- `--user-salt` is optional; if omitted, CLI generates random 32-byte salt.
- `tokens mine` defaults to configured wallet if `--creator` is not provided.

### 2) Bonding-curve trading

```bash
echoclaw slop trade buy <token> --amount-og <amount> [--slippage-bps <bps>] [--dry-run] [--yes] --json
echoclaw slop trade sell <token> --amount-tokens <amount> [--slippage-bps <bps>] [--dry-run] [--yes] --json
```

Notes:
- `--dry-run` gives quote only (no transaction).
- execution requires `--yes`.
- slippage defaults to `50` bps.
- token must pass official-token check and trading-state checks.

### 3) Price and curve state

```bash
echoclaw slop price <token> --json
echoclaw slop curve <token> --json
```

These commands provide:
- current price + source (`bonding` or `pool`)
- reserves, tokens sold, graduation progress, and graduation threshold context

### 4) Fees

```bash
echoclaw slop fees stats <token> --json
echoclaw slop fees claim-creator <token> --yes --json
echoclaw slop fees lp pending <token> --json
echoclaw slop fees lp collect <token> [--recipient <address>] --yes --json
```

Notes:
- `fees lp pending` returns zero-like state before graduation.
- `fees lp collect` is creator-oriented and requires `--yes`.

### 5) Creator reward

```bash
echoclaw slop reward pending <token> --json
echoclaw slop reward claim <token> --yes --json
```

## Trading model and graduation

Core mechanics:
- Slop trading operates on bonding curve before graduation.
- CLI enforces pre-trade checks:
  - token is official (registry validation)
  - token not graduated
  - trading enabled

Implications:
- if token is graduated, bonding-curve trade commands fail and execution should move to DEX routes.
- `buy` includes partial-fill logic near cap and may report refund in quote/output.
- use `curve` and `token info` to inspect progress before execution.

## Agent-safe execution flows

### Flow A: create and inspect token

```bash
echoclaw slop token create --name "Echo Cat" --symbol ECAT --description "demo token" --yes --json
echoclaw slop token info <tokenAddress> --json
echoclaw slop curve <tokenAddress> --json
```

### Flow B: buy flow (quote -> execute)

```bash
echoclaw slop trade buy <tokenAddress> --amount-og 0.25 --slippage-bps 50 --dry-run --json
echoclaw slop trade buy <tokenAddress> --amount-og 0.25 --slippage-bps 50 --yes --json
```

### Flow C: sell flow (quote -> execute)

```bash
echoclaw slop trade sell <tokenAddress> --amount-tokens 1000 --slippage-bps 100 --dry-run --json
echoclaw slop trade sell <tokenAddress> --amount-tokens 1000 --slippage-bps 100 --yes --json
```

### Flow D: creator fees and reward

```bash
echoclaw slop fees stats <tokenAddress> --json
echoclaw slop fees claim-creator <tokenAddress> --yes --json
echoclaw slop reward pending <tokenAddress> --json
echoclaw slop reward claim <tokenAddress> --yes --json
```

### Flow E: post-graduation LP fees

```bash
echoclaw slop fees lp pending <tokenAddress> --json
echoclaw slop fees lp collect <tokenAddress> --yes --json
```

## JSON examples

Trade buy dry-run:

```json
{
  "success": true,
  "dryRun": true,
  "token": "0x...",
  "symbol": "ECAT",
  "amountOgWei": "250000000000000000",
  "tokensOut": "123456789000000000000",
  "minTokensOut": "122839505055000000000",
  "slippageBps": 50
}
```

Trade sell execute:

```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://chainscan.0g.ai/tx/0x...",
  "token": "0x...",
  "symbol": "ECAT",
  "quote": {
    "tokensSold": "1000000000000000000000",
    "ogOutNet": "123000000000000000",
    "minOgOut": "121770000000000000",
    "fee": "1000000000000000"
  }
}
```

Curve state:

```json
{
  "success": true,
  "token": "0x...",
  "symbol": "ECAT",
  "isGraduated": false,
  "graduationProgressPct": "42.35",
  "graduationThresholdBps": "8000"
}
```

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "SLOP_TOKEN_GRADUATED",
    "message": "Token already graduated",
    "hint": "Use DEX flow instead of bonding-curve trade"
  }
}
```

## Safety rules

1. Always run `--dry-run` before live `trade buy/sell`.
2. All mutating operations require `--yes`.
3. Treat official-token check failures as hard stop; do not bypass.
4. Check graduation status before trading (`token info` or `curve`).
5. Keep slippage conservative (`0..5000` bps validation).
6. Assume every executed command with tx hash is non-idempotent.

## Error codes (slop-bonding scope)

- `SLOP_TOKEN_NOT_OFFICIAL`
- `SLOP_TOKEN_GRADUATED`
- `SLOP_TRADE_DISABLED`
- `SLOP_QUOTE_FAILED`
- `SLOP_TX_FAILED`
- `SLOP_INSUFFICIENT_BALANCE`
- `SLOP_CREATE_FAILED`
- `INVALID_SLIPPAGE`
- `INVALID_AMOUNT`
- `INVALID_ADDRESS`
- `CONFIRMATION_REQUIRED`

## Cross-references

- Wallet and signing setup: `references/wallet-transfers.md`
- DEX execution after graduation: `references/jaine-dex.md`
- App-layer meme-coin discovery and query DSL: `references/slop-app.md`
