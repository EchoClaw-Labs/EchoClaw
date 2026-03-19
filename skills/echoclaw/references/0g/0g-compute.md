# 0G Compute Reference

This module is the authoritative guide for `echoclaw 0g-compute ...` commands.

For humans, the recommended entrypoint is still:

```bash
echoclaw echo
```

Then choose `Fund my AI in 0G`.

Treat `0g-compute` as the low-level execution surface for agents, scripts, and advanced operators.

Scope:
- provider discovery and inspection
- ledger status/deposit/fund operations
- provider ACK and API key lifecycle
- balance monitor daemon
- readiness check boundaries

## Table of Contents

- [Critical scope guardrail](#critical-scope-guardrail)
- [Prerequisites](#prerequisites)
- [Read-only vs mutating commands](#read-only-vs-mutating-commands)
- [Command Map](#command-map)
- [OpenClaw-only vs portable operations](#openclaw-only-vs-portable-operations)
- [Monitor lifecycle](#monitor-lifecycle)
- [Agent-safe execution flows](#agent-safe-execution-flows)
- [JSON examples](#json-examples)
- [Safety rules](#safety-rules)
- [Error codes (0g-compute scope)](#error-codes-0g-compute-scope)
- [Cross-references](#cross-references)

## Critical scope guardrail

At the current stage:
- the guided human flow lives under `echoclaw echo`
- `0g-compute` is the portable primitive layer
- monitor notifications are only fully useful when OpenClaw hook routing exists

Portable paths:
- `providers`, `provider`, `ledger`, `api-key`, `monitor`, `setup`

OpenClaw-only boundary:
- notifications from the monitor depend on `OPENCLAW_HOOKS_*` routing and an OpenClaw-compatible gateway

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- Config initialized (`echoclaw config init --json`)
- Wallet + keystore configured
- `ECHO_KEYSTORE_PASSWORD` resolvable

Key config dependencies:
- `chain.rpcUrl`
- `services.echoApiUrl` (for wider platform calls)
- OpenClaw config (`openclaw.json`) for OpenClaw-coupled flows

## Read-only vs mutating commands

Read-only:
- `0g-compute setup` (readiness check only)
- `0g-compute providers`
- `0g-compute provider <address> info`
- `0g-compute provider <address> verify`
- `0g-compute ledger status`
- `0g-compute monitor status`

Mutating (requires `--yes` where applicable):
- `0g-compute provider <address> ack --yes`
- `0g-compute ledger deposit <amount> --yes`
- `0g-compute ledger fund --provider <addr> --amount <amount> --yes`
- `0g-compute api-key create|revoke|revoke-all ... --yes`
- `0g-compute monitor start|stop`

## Command Map

Root:

```bash
echoclaw 0g-compute --help
echoclaw 0g --help
```

### 1) Readiness / setup boundary

```bash
echoclaw echo fund --json
echoclaw 0g-compute setup --json
```

### 2) Providers

```bash
echoclaw 0g-compute providers [--detailed] [--with-balances] [--fresh] --json
echoclaw 0g-compute provider <address> info [--fresh] --json
echoclaw 0g-compute provider <address> ack --yes --json
echoclaw 0g-compute provider <address> verify --json
```

### 3) Ledger

```bash
echoclaw 0g-compute ledger status --json
echoclaw 0g-compute ledger deposit <amount> --yes --json
echoclaw 0g-compute ledger fund --provider <address> --amount <amount> --yes --json
```

### 4) API keys

```bash
echoclaw 0g-compute api-key create --provider <address> --token-id <0..254> [--expires <unixSec>] --yes --json
echoclaw 0g-compute api-key revoke --provider <address> --token-id <0..254> --yes --json
echoclaw 0g-compute api-key revoke-all --provider <address> --yes --json
```

### 5) Monitor

```bash
echoclaw 0g-compute monitor start --providers <addr1,addr2,...> [--mode <fixed|recommended>] [--threshold <og>] [--buffer <og>] [--ratio <n>] [--interval <sec>] [--daemon] --json
echoclaw 0g-compute monitor start --from-state [--daemon] --json
echoclaw 0g-compute monitor status --json
echoclaw 0g-compute monitor stop --json
```

## OpenClaw-only vs portable operations

Portable compute operations:
- provider discovery and metadata (`providers`, `provider ...`)
- ledger operations (`ledger status/deposit/fund`)
- API key lifecycle (`api-key ...`)
- monitor daemon (`monitor ...`) with optional webhook env

OpenClaw-only operational boundary:
- if you want notification delivery from the monitor, you still need OpenClaw-compatible hook routing
- Claude Code, Codex, and other runtimes can fund providers and create API keys without that hook layer

## Monitor lifecycle

Start behavior:
- foreground mode blocks process
- `--daemon` mode detaches process and writes monitor log
- `--from-state` restores last saved provider/mode/threshold settings

Runtime behavior:
- recommended mode uses pricing-derived thresholds + configurable buffer
- fixed mode uses explicit threshold
- anti-spam alert behavior suppresses repeated alerts unless a significant drop occurs

Stop behavior:
- staged shutdown (SIGTERM -> shutdown marker -> SIGKILL fallback)
- writes stopped marker to prevent automatic resurrection

Resurrection behavior:
- CLI preAction can resurrect monitor when state exists and stopped marker is absent

## Agent-safe execution flows

### Flow A: portable provider + funding path

```bash
echoclaw 0g-compute providers --detailed --json
echoclaw 0g-compute ledger status --json
echoclaw 0g-compute ledger deposit 10 --yes --json
echoclaw 0g-compute provider 0xProvider ack --yes --json
echoclaw 0g-compute ledger fund --provider 0xProvider --amount 2.5 --yes --json
```

### Flow B: API key lifecycle

```bash
echoclaw 0g-compute api-key create --provider 0xProvider --token-id 7 --expires 0 --yes --json
echoclaw 0g-compute api-key revoke --provider 0xProvider --token-id 7 --yes --json
```

### Flow C: monitor daemon

```bash
echoclaw 0g-compute monitor start --providers 0xProvider --mode recommended --buffer 0.5 --interval 300 --daemon --json
echoclaw 0g-compute monitor status --json
echoclaw 0g-compute monitor stop --json
```

## JSON examples

Providers list:

```json
{
  "success": true,
  "providers": [],
  "count": 0
}
```

Ledger status:

```json
{
  "success": true,
  "ledger": {
    "exists": true,
    "availableOg": "12.5",
    "lockedOg": "2.0"
  }
}
```

> [!INFO] If you want the human flow for this entire section, use `echoclaw echo` and let the launcher route you into compute funding and status screens.

Error shape:

```json
{
  "success": false,
  "error": {
    "code": "ZG_READINESS_CHECK_FAILED",
    "message": "OpenClaw provider config is missing or invalid",
    "hint": "Use OpenClaw flow or run portable commands manually"
  }
}
```

## Safety rules

1. For all mutating compute commands, require explicit `--yes`.
2. If provider context is unclear, ask user before any OpenClaw-guided path.
3. Use `--json` for agent execution to keep stdout machine-readable.
4. Validate provider address and token-id before API key or funding operations.
5. Use `monitor status --json` as health check before assuming daemon is running.
6. Treat all ledger/api-key/ack operations as non-idempotent.

## Error codes (0g-compute scope)

- `ZG_BROKER_INIT_FAILED`
- `ZG_PROVIDER_NOT_FOUND`
- `ZG_LEDGER_NOT_FOUND`
- `ZG_INSUFFICIENT_BALANCE`
- `ZG_ACKNOWLEDGE_FAILED`
- `ZG_ACK_TIMEOUT`
- `ZG_API_KEY_FAILED`
- `ZG_TRANSFER_FAILED`
- `ZG_MONITOR_ALREADY_RUNNING`
- `ZG_MONITOR_NOT_RUNNING`
- `ZG_READINESS_CHECK_FAILED`
- `ZG_INSUFFICIENT_WALLET_BALANCE`
- `CONFIRMATION_REQUIRED`
- `CHAIN_MISMATCH`

## Cross-references

- OpenClaw provider and setup boundaries: `references/setup-system.md`
- Wallet/password baseline: `references/wallet-transfers.md`
- daemon-style operational mindset: `references/marketmaker.md`
