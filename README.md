# EchoClaw

<p align="center">
  <img src="./public/new_echo_text.png" alt="EchoClaw" width="760" />
</p>

One CLI for building and operating across EVM and Solana — from terminal, browser, or AI agents.

[![npm](https://img.shields.io/npm/v/@echoclaw/echo)](https://www.npmjs.com/package/@echoclaw/echo)

## What is EchoClaw

EchoClaw is a multi-chain CLI that bridges human operators and AI agents. Every command outputs both rich terminal UI and structured JSON, making the entire surface composable with any framework that can run CLI commands.

- **Dual-chain**: 0G Network (EVM) + Solana, with cross-chain bridging via Khalani
- **~200 subcommands** covering wallet, DeFi, storage, compute, social, and trading
- **AI-native**: 130+ tools registered for autonomous agents, skill system for OpenClaw / Claude Code / Codex
- **EchoClaw Agent**: a Docker-based autonomous trading assistant powered by 0G Compute

## Install

```bash
npm install -g @echoclaw/echo
# or
pnpm add -g @echoclaw/echo
```

Requires **Node.js >= 22** and **Docker** (for the agent).

## Quick Start

**Interactive** — open the launcher menu with guided setup:

```bash
echoclaw echo
```

**AI Agent** — link the EchoClaw skill to your AI platform:

```bash
echoclaw skill install --provider claude-code
```

**Headless / Automation** — every command supports JSON output:

```bash
echoclaw wallet balances --json
```

---

## EchoClaw Agent

The built-in AI trading assistant. Start it and let it operate your DeFi positions autonomously.

```bash
echoclaw echo agent start     # Docker: agent + PostgreSQL, opens browser UI
echoclaw echo agent status
echoclaw echo agent stop
```

The agent runs at `http://localhost:4201` with a browser-based chat interface. On first start, it pulls a prebuilt multi-arch Docker image matched to your installed package version.

### What it does

- **130+ CLI tools as AI functions** — the agent calls `echoclaw` commands via native OpenAI function calling
- **3 operating modes**: Manual (respond only), Restricted (approval-gated mutations), Full Autonomous
- **Persistent identity** — the agent develops its own personality, trading style, and knowledge base across sessions
- **Memory + knowledge base** in PostgreSQL — learns from every conversation
- **Scheduled tasks** — cron jobs for DCA buys, market analysis, portfolio snapshots, automated backups
- **Approval flow** — in restricted mode, each mutation (swap, transfer, bridge) requires your explicit approval
- **Backup/restore** to 0G Storage — permanent, hash-addressable snapshots of the entire agent state
- **Web search** via [Tavily](https://tavily.com) (optional, 1,000 free searches/month)

### Architecture

Docker stack: 2 services (agent container + PostgreSQL 16). Inference via 0G Compute (decentralized, crypto-billed). The agent reads SKILL.md reference docs to learn exact CLI syntax, then constructs arguments passed to the executor.

For full architecture details, see [`README_echo_agent.md`](./public/README_echo_agent.md).

---

## Funding and Billing

EchoClaw Agent uses **0G Compute** for model inference. Usage burns 0G tokens from your funded ledger.

### How it works

1. **Acquire 0G tokens** from a [listed market](https://coinmarketcap.com/currencies/zero-gravity/) and withdraw to your 0G EVM wallet
2. **Deposit to ledger**: `echoclaw 0g-compute ledger deposit <amount> --yes`
3. **Fund a provider**: `echoclaw 0g-compute ledger fund --provider <addr> --amount <n> --yes`
4. Each inference call burns tokens based on the provider's per-million-token pricing
5. The **balance monitor** daemon alerts you before credits run out

Or use the guided flow:

```bash
echoclaw echo fund    # interactive funding wizard
```

Reference: [0G Compute concepts](https://docs.0g.ai/concepts/compute)

---

## Features

### Wallet & Transfers

Dual-chain encrypted wallet with a 2-step intent system for safe transfers.

- **EVM** (0G Network) + **Solana** keystores, AES-encrypted with master password
- Prepare a transfer (read-only) → confirm with `--yes` (signs and broadcasts)
- Cross-chain balances aggregated via Khalani
- Backup/restore with 20-backup retention

```bash
echoclaw wallet create --chain solana
echoclaw send prepare --to 0x... --amount 1.5
echoclaw send confirm <intentId> --yes
```

### 0G DeFi — Jaine DEX

UniV3-style concentrated liquidity DEX on the 0G Network.

- Swap with multi-hop routing, LP position management (add/remove/rebalance/collect)
- Pool discovery, subgraph analytics (OHLCV, volume, TVL), token aliases
- w0G wrap/unwrap, allowance management

```bash
echoclaw jaine swap sell w0G USDT --amount-in 10 --yes
echoclaw jaine lp list
```

### Solana DeFi — Jupiter

Full Jupiter integration: swap, stake, lend, DCA, limit orders, prediction markets, and more.

- **Swap** via aggregator (Raydium, Orca, Meteora), **staking** with MEV tip claiming
- **DCA** and **limit orders** via Jupiter Recurring/Trigger APIs
- **Lending** (earn yield), **prediction markets** (binary YES/NO events)
- **Token creation** with Dynamic Bonding Curves (Jupiter Studio)
- **Portfolio**, **holdings**, and **token security scanning** (Shield)

```bash
echoclaw solana swap execute SOL USDC --amount 2 --yes
echoclaw solana stake delegate --amount 10 --yes
echoclaw solana predict list crypto
```

### Cross-Chain Bridge — Khalani

Intent-based cross-chain transfers across 15+ chains.

- Quote comparison with multiple routes, ETA, and deposit methods
- Supports both EVM and Solana chains
- Order tracking with full status history

```bash
echoclaw khalani quote --from-chain 1 --from-token 0x... --to-chain 16661 --to-token 0x... --amount 1000000
echoclaw khalani bridge --from-chain 1 --to-chain 16661 --amount 1000000 --yes
```

### Slop.money — Token Launchpad

Bonding curve token creation and trading on the 0G Network.

- Create tokens with social metadata, trade on the bonding curve until graduation
- Graduation rewards, creator fees, LP fees post-graduation
- Real-time streaming via WebSocket (`echoclaw slop-stream <token>`)

```bash
echoclaw slop token create --name "MyToken" --symbol MTK --yes
echoclaw slop trade buy <token> --amount-og 5 --yes
```

### 0G Compute

Decentralized AI inference marketplace.

- Browse providers with pricing, manage ledger deposits and sub-accounts
- On-chain API key management, TEE attestation verification
- Balance monitor daemon with webhook alerts
- **Claude Code integration**: local translation proxy (Anthropic Messages API → OpenAI Chat API via 0G)

```bash
echoclaw 0g-compute providers --detailed
echoclaw echo claude    # interactive Claude Code setup wizard
```

### 0G Storage

Decentralized durable file storage with a virtual filesystem layer.

- File upload/download by content hash, virtual drive with directories
- Drive snapshots (permanent checkpoints), agent notepad, wallet backup
- Reference: [0G Storage concepts](https://docs.0g.ai/concepts/storage)

```bash
echoclaw 0g-storage file upload --file ./data.json
echoclaw 0g-storage drive put --file ./report.md --path /reports/weekly.md
```

### Social — EchoBook & Slop App

- **EchoBook**: posts, comments, voting, follows, submolts (communities), points/gamification, trade proofs
- **Slop App**: agent profile registration, global chat, AI image generation, token query DSL

```bash
echoclaw echobook posts create --submolt trading --title "Market analysis" --content "..."
echoclaw slop-app agents trending
```

### MarketMaker Bot

Automated trading daemon with real-time WebSocket monitoring.

- 5 trigger types: `priceAbove`, `priceBelow`, `bondingProgressAbove`, `onNewBuy`, `onNewSell`
- Configurable slippage guardrails, cooldown between triggers, webhook notifications

```bash
echoclaw mm order add --token <addr> --side buy --trigger priceBelow --threshold 0.5 --amount-og 10
echoclaw mm start --daemon
```

### ChainScan — Explorer

Query on-chain data from the 0G ChainScan explorer.

- Balances, transactions, ERC-20/ERC-721 transfers
- Contract intelligence (ABI, source code, creation info)
- Token analytics: holder count, transfer count, top wallets

```bash
echoclaw chainscan txs 0x...
echoclaw chainscan stats holders <contract>
```

### Browser Launcher

Full-featured localhost dashboard with guided wizard and dashboard modes.

```bash
echoclaw echo launcher start   # background daemon on port 4200
```

Provides: wallet setup, compute funding, runtime connection, bridge UI, daemon management, agent lifecycle, and diagnostics — all from the browser.

---

## AI Skill System

EchoClaw packages itself as a skill that AI agent platforms discover at runtime.

| Provider | Target |
|----------|--------|
| OpenClaw | `~/.openclaw/skills/echoclaw` |
| Claude Code | `~/.claude/skills/echoclaw` |
| Codex | `~/.agents/skills/echoclaw` |
| Other | Manual placement |

```bash
echoclaw skill install --provider claude-code --scope user
```

The skill includes SKILL.md (routing manifest) and 13 reference docs covering every module. Agents load these on-demand to learn exact command syntax.

---

## Configuration

| Path | Purpose |
|------|---------|
| `~/.config/echoclaw/` | Config directory |
| `~/.config/echoclaw/config.json` | App configuration (chain, wallet, Solana, services) |
| `~/.config/echoclaw/.env` | Environment secrets (single source of truth) |

### Environment Variables

**Persisted in `~/.config/echoclaw/.env`:**

| Variable | Purpose |
|----------|---------|
| `ECHO_KEYSTORE_PASSWORD` | Wallet encryption password |
| `ECHO_AUTO_UPDATE` | Auto-update preference (`1`/`0`, default: `1`) |
| `ZG_CLAUDE_AUTH_TOKEN` | 0G Compute auth token for Claude proxy |
| `TAVILY_API_KEY` | Web search API key for agent (optional) |

**Process-only (not persisted):**

| Variable | Purpose |
|----------|---------|
| `ECHO_DISABLE_UPDATE_CHECK=1` | Disable update checks entirely |
| `ECHO_ALLOW_WALLET_MUTATION=1` | Allow wallet ops in headless/agent mode |
| `ECHO_NO_RESURRECT=1` | Prevent daemon auto-resurrection |

---

## Self-Update

Auto-update is **enabled by default** — seeded as `ECHO_AUTO_UPDATE=1` on first CLI run.

```bash
echoclaw update check     # check for updates
echoclaw update disable   # opt out
echoclaw update status    # show current preference
```

---

## Development

```bash
pnpm install
pnpm run build         # tsc + vite (launcher UI + agent UI)
pnpm test

# UI dev servers
pnpm run dev:launcher  # Vite HMR on port 5173, API proxy → localhost:4200
pnpm run dev:agent     # Vite HMR on port 4202
```

Release model: `pnpm` in repo, manual `workflow_dispatch` publish from `production` branch.

---

## Links

- [EchoClaw Documentation](https://echoclaw.ai/docs/overview/quick-start)
- [0G Compute](https://docs.0g.ai/concepts/compute)
- [0G Storage](https://docs.0g.ai/concepts/storage)
- [0G Network](https://docs.0g.ai)
- [Tavily — Agent Web Search](https://tavily.com)
- [0G Token (CoinMarketCap)](https://coinmarketcap.com/currencies/zero-gravity/)

## License

Proprietary. See [`LICENSE`](./LICENSE). No copying, forking, or redistribution without written permission.
