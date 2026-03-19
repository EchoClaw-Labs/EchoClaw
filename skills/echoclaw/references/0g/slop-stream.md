# Slop Stream Reference

This module is the authoritative guide for `echoclaw slop-stream ...`.

Scope:
- real-time token stream (snapshot + updates)
- JSONL output for automation
- foreground lifecycle and graceful shutdown
- reconnect and re-subscribe behavior

## Table of Contents

- [Prerequisites](#prerequisites)
- [Read-only nature](#read-only-nature)
- [Command Map](#command-map)
- [Runtime and event model](#runtime-and-event-model)
- [Output contract](#output-contract)
- [Agent-safe execution flows](#agent-safe-execution-flows)
- [JSON examples](#json-examples)
- [Safety rules](#safety-rules)
- [Error patterns](#error-patterns)
- [Cross-references](#cross-references)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- Valid token contract address

Config dependency:
- `services.slopWsUrl` (default: `https://be.slop.money`)

## Read-only nature

`slop-stream` is read-only:
- no wallet signing
- no on-chain mutation
- no order execution

Use it for data ingestion and monitoring, not for trades.

## Command Map

```bash
echoclaw slop-stream <token> [--json]
echoclaw --json slop-stream <token>
```

Validation:
- `<token>` must be a valid EVM address
- invalid input fails fast with `INVALID_ADDRESS`

## Runtime and event model

Startup sequence:
1. validate token address
2. load `services.slopWsUrl`
3. create `TokenStream`
4. connect + subscribe to token room
5. stay alive until SIGINT/SIGTERM

Event model:
- `snapshot` event: initial state after subscription
- `update` event: incremental updates

Connection behavior:
- auto-reconnect enabled
- reconnect delay/backoff handled by Socket.IO options
- automatic re-subscription after reconnect

Lifecycle:
- command is intentionally long-running
- stop via `Ctrl+C` (SIGINT) or SIGTERM

## Output contract

### JSON/headless mode (`--json` or non-TTY)

- emits JSON lines to `stdout`
- each line has `event` plus payload
- diagnostics/errors go to `stderr`

### TTY mode

- human-readable stream lines to `stderr`
- includes connect/disconnect notices and formatted update lines

## Agent-safe execution flows

### Flow A: stream to parser pipeline

```bash
echoclaw --json slop-stream 0xTokenAddress | jq -c '.event'
```

### Flow B: archive JSONL stream

```bash
echoclaw --json slop-stream 0xTokenAddress | tee token-stream.jsonl
```

### Flow C: split data and diagnostics channels

```bash
echoclaw --json slop-stream 0xTokenAddress 2> slop-stream.err.log | tee token-stream.jsonl
```

## JSON examples

Snapshot line:

```json
{
  "event": "snapshot",
  "type": "token_snapshot",
  "data": {
    "address": "0x...",
    "actual_price": 0.00123,
    "market_cap": 12345,
    "bonding_progress": 42.5,
    "status": "active"
  },
  "timestamp": 1710000000123
}
```

Update line:

```json
{
  "event": "update",
  "address": "0x...",
  "symbol": "TKN",
  "price": 0.0015,
  "marketCap": 15000,
  "bondingProgress": 45.1,
  "status": "active"
}
```

## Safety rules

1. Prefer `--json` in automation.
2. Parse only `stdout` for machine data; treat `stderr` as diagnostics.
3. Add external supervision/watchdog because command is infinite by design.
4. Expect reconnects and transient disconnect logs.
5. Stop with signals, not by waiting for natural exit.

## Error patterns

- `INVALID_ADDRESS`: malformed token argument
- stream/server errors: logged to `stderr`
- repeated disconnect/reconnect loops: usually network/backend instability
- token not found (server-side): requested token may be absent in backend dataset

## Cross-references

- Automated execution on stream signals: `references/marketmaker.md`
- Meme-coin discovery/query layer: `references/slop-app.md`
- On-chain token lifecycle/trading: `references/slop-bonding.md`
