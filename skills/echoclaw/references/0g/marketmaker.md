# MarketMaker Reference

This module is the authoritative guide for `echoclaw marketmaker ...` (alias: `echoclaw mm`).

Scope:
- order lifecycle (create, list, inspect, update, cancel, arm, disarm)
- daemon operations (start, stop, status)
- trigger execution model
- runtime safety (slippage guardrails, cooldown, nonce queue)
- observability and notification behavior

## Table of Contents

- [Prerequisites](#prerequisites)
- [Read-only vs mutating commands](#read-only-vs-mutating-commands)
- [Command Map](#command-map)
- [Trigger and size model](#trigger-and-size-model)
- [Order states and lifecycle](#order-states-and-lifecycle)
- [Daemon runtime model](#daemon-runtime-model)
- [Agent-safe execution flows](#agent-safe-execution-flows)
- [JSON examples](#json-examples)
- [Safety rules](#safety-rules)
- [Error codes (marketmaker scope)](#error-codes-marketmaker-scope)
- [Cross-references](#cross-references)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- Config initialized (`echoclaw config init --json`)
- Wallet + keystore configured
- `ECHO_KEYSTORE_PASSWORD` available for signing operations

Config dependencies used by MarketMaker:
- `services.slopWsUrl` (token stream source)
- `chain.rpcUrl`
- `chain.explorerUrl`
- `wallet.address`

Optional notification dependencies:
- `services.backendApiUrl` + `services.chatWsUrl` (chat notifications)
- `OPENCLAW_HOOKS_*` (OpenClaw webhook notifications, optional)

## Read-only vs mutating commands

Read-only:
- `order list`
- `order show`
- `status`

Mutating:
- `order add`
- `order update`
- `order remove`
- `order arm`
- `order disarm`
- `start` / `stop` (daemon process state)

## Command Map

Root:

```bash
echoclaw marketmaker --help
echoclaw mm --help
```

### 1) Orders

```bash
echoclaw marketmaker order add --token <addr> --side <buy|sell> --trigger <type> [--threshold <number>] [--amount-og <amount>] [--amount-tokens <amount|all>] [--percent <number>] [--slippage-bps <bps>] [--cooldown-ms <ms>] [--ignore-wallet <addr>] [--min-buy-og <amount>] --json
echoclaw marketmaker order list [--token <addr>] [--state <armed|filled|failed|cancelled|disarmed|all>] --json
echoclaw marketmaker order show <id> --json
echoclaw marketmaker order update <id> [--slippage-bps <bps>] [--cooldown-ms <ms>] --json
echoclaw marketmaker order remove <id> [--yes] --json
echoclaw marketmaker order arm <id> --json
echoclaw marketmaker order disarm <id> --json
```

Notes:
- `order add` requires one size mode: `--amount-og` or `--amount-tokens` (or `all`) or `--percent`.
- buy orders cannot use token-size modes (`--amount-tokens` / `all`).
- sell orders cannot use `--amount-og`.
- default slippage: `100` bps.
- max slippage guardrail: `500` bps.
- default cooldown: `5000` ms.
- `order remove` requires `--yes` in TTY mode; headless mode bypasses that check.

### 2) Daemon lifecycle

```bash
echoclaw marketmaker start [--daemon] --json
echoclaw marketmaker stop --json
echoclaw marketmaker status --json
```

Notes:
- `start` (foreground) keeps process alive until signal/shutdown.
- `start --daemon` spawns detached background process and writes to bot log.
- `stop` sequence: SIGTERM -> shutdown-file fallback -> SIGKILL fallback.

## Trigger and size model

Supported triggers:
- `onNewBuy`
- `onNewSell`
- `priceAbove`
- `priceBelow`
- `bondingProgressAbove`

Trigger-specific fields:
- `priceAbove` / `priceBelow`: require `--threshold > 0`
- `bondingProgressAbove`: requires `--threshold` in `0..100`
- `onNewBuy` / `onNewSell`:
  - optional `--ignore-wallet` (defaults to configured wallet when omitted)
  - optional `--min-buy-og` filter

Size modes:
- `--amount-og <amount>`: absolute 0G size (buy path)
- `--amount-tokens <amount>`: absolute token size (sell path)
- `--amount-tokens all`: sell full token balance
- `--percent <n>`: percentage mode (1..100)

Percent-mode runtime behavior:
- buy: computed from 0G wallet balance, with gas reserve subtraction (`0.01 0G`)
- sell: computed from current token balance

## Order states and lifecycle

Primary states:
- `armed`
- `executing`
- `filled`
- `failed`
- `cancelled`
- `disarmed`

Lifecycle rules:
- new order starts as `armed`
- `remove` does soft-cancel (`cancelled`), not hard delete
- `arm` is allowed only from `cancelled` or `disarmed`
- `disarm` sets state to `disarmed`
- duplicate trigger defense uses `lastProcessedTxHash`

Persistent files:
- `~/.config/echoclaw/bot/orders.json`
- `~/.config/echoclaw/bot/state.json`
- `~/.config/echoclaw/bot/bot.pid`
- `~/.config/echoclaw/bot/bot.log`
- `~/.config/echoclaw/bot/bot.shutdown`
- `~/.config/echoclaw/bot/bot.stopped`

## Daemon runtime model

Execution pipeline:
1. stream `token_update` received
2. trigger evaluation
3. cooldown + guardrail checks
4. enqueue in nonce queue (serialized tx execution)
5. execute buy/sell
6. mark order state (`filled` / `failed`)
7. append execution log + emit notifications

Runtime characteristics:
- stream reconnect enabled with backoff and auto re-subscribe
- per-order cooldown enforced (`cooldownMs`)
- nonce queue avoids nonce races
- notifications:
  - always JSON to stdout
  - optional chat notification
  - optional OpenClaw webhook notification

Resurrection behavior:
- CLI startup can auto-resurrect MarketMaker if:
  - no `bot.stopped` marker
  - orders file exists
  - at least one order is `armed`
- spawned child daemons run with `ECHO_NO_RESURRECT=1` to prevent recursion

## Agent-safe execution flows

### Flow A: create order and verify

```bash
echoclaw marketmaker order add --token 0xToken --side buy --trigger priceBelow --threshold 0.0009 --amount-og 0.2 --slippage-bps 100 --cooldown-ms 10000 --json
echoclaw marketmaker order list --state all --json
echoclaw marketmaker order show <orderId> --json
```

### Flow B: start daemon in background and inspect status

```bash
echoclaw marketmaker start --daemon --json
echoclaw marketmaker status --json
```

### Flow C: adjust or pause order safely

```bash
echoclaw marketmaker order update <orderId> --slippage-bps 120 --cooldown-ms 15000 --json
echoclaw marketmaker order disarm <orderId> --json
echoclaw marketmaker order arm <orderId> --json
```

### Flow D: stop daemon

```bash
echoclaw marketmaker stop --json
```

## JSON examples

Order add (success):

```json
{
  "success": true,
  "order": {
    "id": "6f1b4b0a-...",
    "token": "0x...",
    "side": "buy",
    "trigger": { "type": "priceBelow", "threshold": 0.0009 },
    "size": { "mode": "absolute", "amountOg": "0.2" },
    "slippageBps": 100,
    "cooldownMs": 10000,
    "state": "armed",
    "createdAt": 1760000000000
  }
}
```

Status (success):

```json
{
  "success": true,
  "daemon": { "running": true, "pid": 12345 },
  "orders": { "total": 4, "armed": 2, "filled": 1, "failed": 1 },
  "recentExecutions": []
}
```

Start daemon (success):

```json
{
  "success": true,
  "daemon": true,
  "pid": 12345,
  "logFile": "/home/user/.config/echoclaw/bot/bot.log"
}
```

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "BOT_GUARDRAIL_EXCEEDED",
    "message": "Slippage 600bps exceeds max 500bps",
    "hint": "Lower --slippage-bps"
  }
}
```

## Safety rules

1. Keep slippage `<= 500` bps (hard guardrail).
2. Use conservative cooldowns to avoid repeated trigger churn.
3. Validate trigger thresholds and size mode before arming live orders.
4. Remember `order add` is non-idempotent (new UUID each time).
5. Treat every executed trade as non-idempotent (re-run can send new tx).
6. Use `status --json` as your operational health check.

## Error codes (marketmaker scope)

- `BOT_ALREADY_RUNNING`
- `BOT_NOT_RUNNING`
- `BOT_ORDER_NOT_FOUND`
- `BOT_INVALID_TRIGGER`
- `BOT_INVALID_ORDER`
- `BOT_GUARDRAIL_EXCEEDED`
- `CONFIRMATION_REQUIRED`
- `INVALID_AMOUNT`
- `INVALID_ADDRESS`

## Cross-references

- Wallet/password/signing baseline: `references/wallet-transfers.md`
- Token lifecycle and bonding-curve trade context: `references/slop-bonding.md`
- App-layer chat/JWT context: `references/slop-app.md`
