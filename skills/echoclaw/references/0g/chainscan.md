# ChainScan Reference

This module is the authoritative guide for `echoclaw chainscan ...` commands.

Scope:
- explorer-style on-chain intelligence
- transaction and contract inspection
- calldata/method decode utilities
- holder/transfer/participant statistics

All commands here are read-only (no signing, no on-chain writes).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Read-only model](#read-only-model)
- [Address fallback model](#address-fallback-model)
- [Command Map](#command-map)
- [Input limits and validation](#input-limits-and-validation)
- [Agent-safe execution flows](#agent-safe-execution-flows)
- [JSON examples](#json-examples)
- [Reliability model](#reliability-model)
- [Error codes (chainscan scope)](#error-codes-chainscan-scope)
- [Cross-references](#cross-references)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Config initialized (`echoclaw config init --json`)

Optional environment:
- `CHAINSCAN_API_KEY` (passed as `apikey` query parameter when set)

Service endpoint source:
- `services.chainScanBaseUrl` in config
- default: `https://chainscan.0g.ai/open`

## Read-only model

`chainscan` is read-first:
- it fetches data from explorer/statistics APIs
- it does not sign transactions
- it does not mutate local wallet or chain state

Use this module for intelligence, verification, and diagnostics.

## Address fallback model

Some commands accept optional `[address]`:
- if provided, that address is used
- if omitted, CLI falls back to configured wallet address
- if neither exists, command fails with `WALLET_NOT_CONFIGURED`

Commands with optional address fallback:
- `balance [address]`
- `token-balance <contractAddress> [address]`
- `txs [address]`
- `transfers erc20 [address]`
- `transfers erc721 [address]`

## Command Map

### 1) Balances and account history

```bash
echoclaw chainscan balance [address] [--tag <tag>] --json
echoclaw chainscan balancemulti --addresses <addr1,addr2,...> [--tag <tag>] --json
echoclaw chainscan token-balance <contractAddress> [address] --json
echoclaw chainscan token-supply <contractAddress> --json
echoclaw chainscan txs [address] [--page <n>] [--offset <n>] [--sort <asc|desc>] [--startblock <n>] [--endblock <n>] --json
```

### 2) Token transfer history

```bash
echoclaw chainscan transfers erc20 [address] [--contract <addr>] [--page <n>] [--offset <n>] [--sort <asc|desc>] --json
echoclaw chainscan transfers erc721 [address] [--contract <addr>] [--page <n>] [--offset <n>] [--sort <asc|desc>] --json
```

### 3) Transaction and contract inspection

```bash
echoclaw chainscan tx status <txHash> --json
echoclaw chainscan tx receipt <txHash> --json
echoclaw chainscan contract abi <address> --json
echoclaw chainscan contract source <address> --json
echoclaw chainscan contract creation --addresses <addr1,addr2,...> --json
```

### 4) Decode utilities

```bash
echoclaw chainscan decode hashes --hashes <txHash1,txHash2,...> --json
echoclaw chainscan decode raw --contracts <addr1,addr2,...> --inputs <data1,data2,...> --json
```

### 5) Token statistics

```bash
echoclaw chainscan stats holders <contractAddress> [--limit <n>] [--skip <n>] [--sort <asc|desc>] [--min-timestamp <n>] [--max-timestamp <n>] --json
echoclaw chainscan stats transfers <contractAddress> [--limit <n>] [--skip <n>] [--sort <asc|desc>] [--min-timestamp <n>] [--max-timestamp <n>] --json
echoclaw chainscan stats participants <contractAddress> [--limit <n>] [--skip <n>] [--sort <asc|desc>] [--min-timestamp <n>] [--max-timestamp <n>] --json
echoclaw chainscan stats top-wallets [--type <senders|receivers|participants>] [--span <24h|3d|7d>] --json
```

## Input limits and validation

- `--tag` allowed values:
  - `latest_state`, `latest_mined`, `latest_finalized`, `latest_confirmed`, `latest_checkpoint`, `earliest`
- account-like pagination:
  - `page >= 1`
  - `offset` max `100`
  - default sort: `desc`
- stats pagination:
  - `skip` max `10000`
  - `limit` max `2000`
  - default sort: `desc`
- batch caps:
  - `balancemulti --addresses`: max `20`
  - `contract creation --addresses`: max `5`
  - `decode hashes`: max `10`
  - `decode raw`: max `10` and contracts/inputs lists must match in length
- invalid numeric inputs trigger `INVALID_AMOUNT`
- invalid addresses trigger `INVALID_ADDRESS`

## Agent-safe execution flows

### Flow A: wallet and token balance snapshot

```bash
echoclaw chainscan balance --json
echoclaw chainscan token-balance <tokenContract> --json
echoclaw chainscan token-supply <tokenContract> --json
```

### Flow B: verify a transaction lifecycle

```bash
echoclaw chainscan tx status <txHash> --json
echoclaw chainscan tx receipt <txHash> --json
```

### Flow C: contract due diligence

```bash
echoclaw chainscan contract source <contractAddress> --json
echoclaw chainscan contract abi <contractAddress> --json
echoclaw chainscan contract creation --addresses <contractAddress> --json
```

### Flow D: activity and participation intel

```bash
echoclaw chainscan stats holders <tokenContract> --limit 30 --json
echoclaw chainscan stats transfers <tokenContract> --limit 30 --json
echoclaw chainscan stats participants <tokenContract> --limit 30 --json
echoclaw chainscan stats top-wallets --type participants --span 24h --json
```

### Flow E: decode unknown calldata

```bash
echoclaw chainscan decode hashes --hashes <txHash1,txHash2> --json
echoclaw chainscan decode raw --contracts <contract1,contract2> --inputs <input1,input2> --json
```

## JSON examples

Balance:

```json
{
  "success": true,
  "address": "0x...",
  "balance": "1230000000000000000",
  "balanceFormatted": "1.23 0G"
}
```

Tx status:

```json
{
  "success": true,
  "txHash": "0x...",
  "isError": "0",
  "errDescription": ""
}
```

Contract source:

```json
{
  "success": true,
  "address": "0x...",
  "contracts": []
}
```

Stats participants:

```json
{
  "success": true,
  "contractAddress": "0x...",
  "count": 30,
  "participantStats": []
}
```

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "CHAINSCAN_API_ERROR",
    "message": "API request failed",
    "hint": "Retry later or verify endpoint/config"
  }
}
```

## Reliability model

Client-side safeguards:
- request timeout: `10000ms`
- token-bucket rate limit: `4 req/sec`
- max concurrency: `3`
- retry policy: up to `2` retries for rate-limit/server-side failures

Operational guidance:
- prefer incremental polling over wide fan-out batches
- keep page/offset conservative for automation loops
- if 429/timeouts occur, back off and retry

## Error codes (chainscan scope)

- `CHAINSCAN_API_ERROR`
- `CHAINSCAN_RATE_LIMITED`
- `CHAINSCAN_TIMEOUT`
- `CHAINSCAN_INVALID_RESPONSE`
- `CHAINSCAN_NO_RESULT`
- `INVALID_ADDRESS`
- `INVALID_AMOUNT`
- `WALLET_NOT_CONFIGURED`

## Cross-references

- Wallet and address setup: `references/wallet-transfers.md`
- Read-only DEX market intelligence: `references/jaine-subgraph.md`
- Slop app-level meme-coin discovery APIs: `references/slop-app.md`
