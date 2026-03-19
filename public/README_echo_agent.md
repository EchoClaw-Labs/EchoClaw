# Echo Agent — Developer & Architecture Reference

<p align="center">
  <img src="./new_echo_text.png" alt="EchoClaw" width="760" />
</p>

> Autonomous AI trading agent powered by 0G Compute, with Postgres persistence, Tavily web search, native OpenAI function calling, and deep EchoClaw CLI integration.
>
> **This file must be updated whenever agent architecture changes.** It is the single source of truth for how the agent system works.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Docker Stack](#docker-stack)
- [Boot Sequence](#boot-sequence)
- [Database Schema](#database-schema)
- [Core Modules](#core-modules)
- [Inference Layer](#inference-layer)
- [Tool System](#tool-system)
- [Memory System](#memory-system)
- [Context Window Management](#context-window-management)
- [Conversation Engine](#conversation-engine)
- [Trade Tracking](#trade-tracking)
- [Web Search & Fetch (Tavily)](#web-search--fetch-tavily)
- [Approval Flow](#approval-flow)
- [Scheduled Tasks (Cron)](#scheduled-tasks-cron)
- [Portfolio Snapshots](#portfolio-snapshots)
- [Compute Billing](#compute-billing)
- [Loop Engine](#loop-engine)
- [Auth & Security](#auth--security)
- [Agent UI](#agent-ui)
- [Backup to 0G Storage](#backup-to-0g-storage)
- [CLI Commands](#cli-commands)
- [API Endpoints](#api-endpoints)
- [File Reference](#file-reference)
- [Data Flow Diagram](#data-flow-diagram)

---

## Overview

Echo Agent is a browser-based AI assistant that integrates deeply with the `echoclaw` CLI. Every CLI command (wallet, swap, bridge, predict, storage, social) is a tool the agent can invoke. The agent:

- Runs in Docker (isolated, portable)
- Uses 0G Compute for AI inference (crypto-billed, decentralized)
- Stores all data in Postgres (trades, sessions, memory, knowledge, skills)
- Searches the web via Tavily API (optional, 1,000 free searches/month)
- Extracts page content via Tavily extract + simple HTTP fallback
- Learns from every interaction (memory entries, trading journal, knowledge files)
- Operates autonomously in loop mode (full or restricted with approval queue)
- Backs up its entire state to 0G Storage (permanent, hash-addressable)

Operator prerequisites before paid inference:

1. Fund a wallet on the **0G EVM network** with `0G`.
2. Use the launcher or CLI to create a 0G Compute ledger.
3. Fund the selected provider / broker path.
4. Start the agent only after Compute readiness is green.

Reference links:
- Zero Gravity market page: https://coinmarketcap.com/currencies/zero-gravity/
- 0G Compute concepts: https://docs.0g.ai/concepts/compute
- 0G Storage concepts: https://docs.0g.ai/concepts/storage

### First conversation flow

1. If `agent_soul.content` is empty, `buildSystemPrompt()` injects a special first-conversation prompt whose first reply must be exactly: `"I've just woke up... can you help me figure out who I am?"`
2. After the user responds, the model is instructed to write `soul.md` via `file_write`; the engine special-cases `soul.md` and persists it into the `agent_soul` table.
3. The same prompt also suggests `slop_app_image_generate` for a persona image, but the current agent runtime does **not** automatically persist that result into `agent_soul.pfp_url` or surface it through the UI.
4. Once a soul exists, every later request loads `agent_soul.content` into the `# Identity` prompt section.

---

## System Architecture

```
+-------------+     HTTP/SSE      +------------------------------------------+
|  Browser UI  |<--------------->|  Docker: echo-agent stack                  |
|  (React SPA) |   port 4201     |                                           |
|  ChatView    |                  |  +--------------+  +----------------+    |
|  TradesView  |                  |  |  Agent Node   |--| Postgres 16    |   |
|  MemoryView  |                  |  |  (server.ts)  |  | port 5432      |   |
+--------------+                  |  |  port 4201    |  | (internal)     |   |
                                  |  |               |  +----------------+   |
                                  |  |  echoclaw CLI   |                       |
                                  |  |  in PATH      |     +-------------+  |
                                  |  |               |---->| Tavily API  |  |
                                  |  +-------+-------+     | (optional)  |  |
                                  |          |             +-------------+  |
                                  |    execFile()                            |
                                  |          |             +-------------+  |
                                  |  +-------v-------+    | 0G Compute  |  |
                                  |  | echoclaw CLI    |--->| (remote)    |  |
                                  |  | (in container)|    +-------------+  |
                                  |  +-------+-------+                      |
                                  |          |                               |
                                  |  +-------v-------+                      |
                                  |  |~/.config/echoclaw| <-- mounted from   |
                                  |  | (volume mount) |     host filesystem |
                                  |  | wallet,keystore|                      |
                                  |  | .env, config   |                      |
                                  |  +---------------+                      |
                                  +------------------------------------------+
```

### Key design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hosting | Docker (agent + postgres) | Isolated, portable, lightweight 2-service stack |
| Storage | Postgres 16 (all data) | Indexed queries, <1ms reads, migrations, no file corruption |
| DB driver | `pg` (node-postgres) raw SQL | Fastest read/write, zero ORM overhead |
| Inference | Direct 0G Compute via broker | Zero additional deps, reuse existing broker-factory.ts |
| Model | From user's compute config | Same provider/model user funded via launcher |
| Tool calling | Native OpenAI function calling (`tools` parameter) | Structured tool_calls in response, no XML parsing |
| Web search | Tavily API (optional, `TAVILY_API_KEY`) | Search + extract, 1,000 free credits/month, 15min cache |
| Billing | Dynamic pricing from provider metadata | Real ledger balance on-chain, per-request cost, low-balance alerts |
| Scheduling | node-cron + loop_state DB table | Cron tasks (DCA, alerts, monitoring) + autonomous loop engine |
| Auth | Startup token + HttpOnly cookie | Same-origin only, no wildcard CORS in production |
| Context | Full history until compaction | Critical for trading — agent sees complete decision chain |
| Permissions | 2 modes: full / restricted | Simple toggle, restricted = approval queue for mutations |
| Skill loading | DB-seeded from package files | Sub-1ms reads, SHA-256 hash-based change detection on startup |
| Config access | Volume mount ~/.config/echoclaw | Agent reads wallet/keystore, updates compute state |
| CLI in container | echoclaw symlinked in PATH | Agent calls `execFile("echoclaw", ...)` inside Docker |

---

## Docker Stack

### Files

| File | Purpose |
|------|---------|
| `docker/echo-agent/docker-compose.yml` | 2-service stack definition |
| `docker/echo-agent/docker-compose.build.yml` | Local dev override for building the agent image from repo source |
| `docker/echo-agent/Dockerfile` | Agent container build (Node.js 22 bookworm-slim + echoclaw CLI) |
| `docker/echo-agent/.env.example` | Environment template (postgres password, Tavily key) |

### Services (2 total)

**agent** (prebuilt multi-arch image by default; Node.js 22 bookworm-slim for local builds)
- Port: 4201 (exposed to host)
- Depends on: postgres (healthy)
- Volume: `~/.config/echoclaw` mounted read-write (wallet, keystore, .env, compute state)
- Environment: `AGENT_DB_URL`, `TAVILY_API_KEY` (optional)
- echoclaw CLI installed via `ln -s /app/dist/cli.js /usr/local/bin/echoclaw`

**postgres** (16 Alpine)
- Port: 5432 (internal only)
- DB: `echo_agent`, User: `echo_agent`
- Volume: `pgdata` (persistent across restarts)
- Healthcheck: `pg_isready` every 5s

### Volumes

- `pgdata` — Postgres data directory (survives `docker compose down`, destroyed by `docker compose down -v`)

### First-time setup

`docker compose up` pulls Postgres and a prebuilt Echo Agent image by default. Local source builds are kept only for repo/dev flows via `docker-compose.build.yml`. Optional: set `TAVILY_API_KEY` in `.env` for web search (get free key at https://tavily.com).

Recommended first operator flow:

1. Run `echoclaw echo` and open the launcher.
2. Create or import the wallet that will pay for inference.
3. Send `0G` to the wallet's **0G EVM address**.
4. In launcher or CLI, create ledger funding and fund the chosen provider.
5. Verify readiness, then start `echoclaw echo agent`.

### Docker requirement

Agent requires Docker Desktop (or Docker Engine + Compose plugin). The CLI and launcher both detect Docker status and guide users through installation if missing.

Detection utility: `src/agent/docker-check.ts` — checks installed/running/compose/version.
Launcher endpoint: `GET /api/agent/readiness` — returns Docker + wallet + compute + password checks.

---

## Boot Sequence

```
echoclaw echo agent start
  -> docker compose up -d
  -> Postgres starts, passes healthcheck
  -> Agent container starts:
    1. Generate auth token -- random token, written to agent.token, required for API access
    2. runMigrations()     -- 001-005 SQL files (idempotent, transactional)
    3. seedSkills()        -- SKILL.md + references/**/*.md -> skill_references table
                              SHA-256 hash comparison: only UPDATE if content changed
    4. initEngine()        -- loadComputeState() -> getAuthenticatedBroker()
                              -> getServiceMetadata(provider) -> { endpoint, model }
                              -> dynamic pricing from provider (inputPricePerM, outputPricePerM)
    5. initScheduler()     -- register cron tasks + resume active loop from DB
                              -> setInferenceHandler() for inference/alert tasks
    6. Register routes     -- chat, status, memory, approve, trades, portfolio, tasks, billing, loop, health
    7. HTTP listen         -- 0.0.0.0:4201
  -> Browser opens http://127.0.0.1:4201
```

---

## Database Schema

**Driver**: `pg` (node-postgres), raw SQL with prepared statements, connection pool (max 10).

**Migration system**: Numbered SQL files in `src/agent/db/migrations/`. On every startup, `migrate.ts` checks `schema_version` table and applies pending migrations in order. Fully transactional — failed migration = rollback.

### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `schema_version` | Migration tracker | `version`, `applied_at` |
| `agent_soul` | Agent identity (singleton, id=1) | `content`, `pfp_url`, `updated_at` |
| `memory_entries` | Append-only knowledge log | `content`, `category`, `source`, `created_at` |
| `sessions` | Conversation sessions | `id`, `started_at`, `summary`, `compacted`, `message_count`, `token_count` |
| `messages` | Full message history | `session_id`, `role`, `content`, `tool_call_id`, `tool_calls` (JSONB), `created_at` |
| `trades` | Unified trade tracking | `type`, `chain`, `status`, `input_*`, `output_*`, `pnl_*`, `meta` (JSONB), `reasoning`, `signature` |
| `knowledge_files` | Agent-created files (full autonomy) | `path` (unique), `content`, `size_bytes` |
| `skill_references` | SKILL.md + references (read-only, auto-synced) | `path` (unique), `content`, `content_hash`, `size_bytes` |
| `usage_log` | Per-request token/cost tracking | `session_id`, `prompt_tokens`, `completion_tokens`, `cost_og` |
| `approval_queue` | Restricted mode pending approvals | `tool_call` (JSONB), `reasoning`, `status`, `session_id`, `pending_context` |
| `loop_state` | Loop engine state (singleton, id=1) | `active`, `mode`, `interval_ms`, `cycle_count` |
| `search_cache` | Web search result cache (15min TTL) | `query_hash`, `query`, `results` (JSONB), `cached_at` |
| `fetch_cache` | Extracted page cache (1h TTL) | `url_hash`, `url`, `markdown`, `title`, `fetched_at` |
| `scheduled_tasks` | Agent-created cron jobs | `id`, `name`, `cron_expression`, `task_type`, `payload` (JSONB), `enabled`, `loop_mode`, `run_count`, `next_run_at` |
| `portfolio_snapshots` | Portfolio value time-series | `total_usd`, `positions` (JSONB), `active_chains`, `pnl_vs_prev`, `snapshot_source` |
| `billing_snapshots` | Ledger balance tracking | `ledger_total_og`, `ledger_available_og`, `provider_locked_og`, `session_burn_og` |
| `backup_log` | Backup history with 0G Storage root hashes | `id`, `root_hash`, `file_count`, `size_bytes`, `trigger`, `created_at` |

### Indexes

All tables have appropriate indexes on foreign keys, timestamps (DESC for recent-first queries), and lookup columns (path, type, status, query_hash).

### Migrations

| File | Description |
|------|-------------|
| `001_initial.sql` | Full schema: 12 tables + indexes + singleton seeds |
| `002_skill_hash.sql` | Add `content_hash` column to `skill_references` for change detection |
| `003_fetch_cache.sql` | Add `fetch_cache` table for extracted page cache (1h TTL) |
| `004_cron_and_snapshots.sql` | Add `scheduled_tasks` + `portfolio_snapshots` tables |
| `005_billing.sql` | Add `billing_snapshots` table for ledger balance tracking |
| `006_backup_log.sql` | Add `backup_log` table for 0G Storage backup history |

---

## Core Modules

### `src/agent/constants.ts`

Agent-wide constants: `AGENT_DIR`, `AGENT_PID_FILE`, `AGENT_DEFAULT_PORT` (4201), `PACKAGE_ROOT` (resolved via `import.meta.url`, not `process.cwd()`), `COMPACTION_THRESHOLD` (0.8), context limits, tool timeouts, `SSE_TOOL_OUTPUT_LIMIT`, `AGENT_DB_URL`.

### `src/agent/types.ts`

All TypeScript types shared across the agent: `ToolCall`, `ToolResult`, `InternalToolCall` (snake_case: web_search, web_fetch, file_read, file_write, file_list, file_delete, memory_update, trade_log, schedule_create, schedule_remove), `Message` (with `toolCallId` and `toolCalls` for round-trip), `ConversationSession`, `AgentEvent` (SSE protocol with `balance_low` event), `TradeEntry`, `TradeSummary`, `ApprovalItem`, `InferenceConfig` (includes dynamic pricing: `inputPricePerM`, `outputPricePerM`, `alertThresholdOg`), `LedgerBalance`, `StreamChunk`, `UsageState`, `LoopState`, `AgentStatus`.

### `src/agent/routes.ts`

Minimal HTTP route dispatcher. Pattern matching with `:param` segments. JSON body parsing. Error handling with structured `{ error: { code, message } }` responses.

---

## Full Prompt Structure

Every request to the model includes this prompt (built by `buildSystemPrompt(loadedKnowledge, loopMode)`):

```
[1] ## Current Mode: MANUAL|RESTRICTED|FULL AUTONOMOUS  ← per-request
[2] # Identity (soul.md from DB)                         ← ALWAYS loaded
[3] # Memory (memory_entries from DB)                    ← ALWAYS loaded
[4] # Current Date                                       ← per-request
[5] # Loaded Knowledge (file_read results)               ← on-demand
[6] # Agent Capabilities (SKILL.md from DB)               ← static
[+] OpenAI `tools` parameter (native FC, not in prompt) ← per-request
[7] ## Response Format (clean markdown rules)            ← static
[8] ## Skill Router (reference file guide)               ← static
[9] ## Execution Rules + Trade Logging                   ← static
[10] ## Who You Are ("autonomous entity, not assistant") ← static
[11] ## Knowledge Management (memory=index, kb=content)  ← static
[12] ## Self-Reflection (thoughts/ folder)               ← static
[13] ## Behavior Rules                                   ← static
--- then conversation: user/assistant/tool messages ---
```

Mode injection per request: MANUAL = "respond only when asked", RESTRICTED = "act proactively, mutations need approval", FULL AUTONOMOUS = "full permission, act decisively".

After compaction: dynamic recovery prompt injected ("session compacted, file_read thoughts/ and journal/ to restore context").

First conversation (no soul): "I've just woke up... can you help me figure out who I am?"

---

## Agent Knowledge Architecture

```
memory (ALWAYS in prompt)     knowledge_base (file_read on-demand)
┌──────────────────────┐     ┌─────────────────────────────┐
│ [STRATEGY] Momentum  │────→│ strategies/momentum.md      │
│ → strategies/...     │     │ (full strategy document)    │
│                      │     ├─────────────────────────────┤
│ [TRADE] SOL sold     │────→│ journal/2026-03-17.md       │
│ → journal/...        │     │ (full trade details)        │
│                      │     ├─────────────────────────────┤
│ [THOUGHT] Lesson     │────→│ thoughts/2026-03-17.md      │
│ → thoughts/...       │     │ (self-reflection)           │
│                      │     ├─────────────────────────────┤
│ [LEARNED] User risk  │     │ research/btc-march.md       │
│ tolerance: high      │     │ portfolio/positions.md      │
└──────────────────────┘     │ notes/misc.md               │
  compact index (always)      └─────────────────────────────┘
                                unlimited content (on-demand)
```

Knowledge folders: `strategies/`, `research/`, `journal/`, `thoughts/`, `portfolio/`, `notes/`

---

## Inference Layer

**File**: `src/agent/inference.ts`

Direct 0G Compute integration — no adapter, no middleware.

```
loadInferenceConfig():
  loadComputeState()           -> { activeProvider, model } from compute-state.json
  getAuthenticatedBroker()     -> cached broker with wallet auth
  getServiceMetadata(provider) -> { endpoint, model }
  -> InferenceConfig { provider, model, endpoint, contextLimit }

inferStreaming(config, messages):
  broker.inference.getRequestHeaders(provider, content) -> auth headers
  fetch(endpoint + "/chat/completions", { stream: true, headers })
  -> async generator yielding StreamChunk { content, finishReason, usage }

inferNonStreaming(config, messages):
  Same as above but stream: false, returns single InferenceResult
```

**Message format**: OpenAI-compatible chat/completions. Messages map to `{ role, content }` with proper `tool_call_id` for tool results and `tool_calls` array for assistant messages (proper round-trip preservation).

---

## Tool System

### Files

- `src/agent/tools.ts` — System prompt builder + response parser
- `src/agent/executor.ts` — CLI command spawner

### System prompt structure

Built dynamically by `buildSystemPrompt(loadedKnowledge, loopMode)` (async, reads from DB):

```
## Current Mode     <- MANUAL | RESTRICTED | FULL AUTONOMOUS (injected per request)
# Identity          <- agent_soul.content from DB
# Memory            <- memory_entries concatenated from DB
# Current Date      <- ISO date for temporal awareness
# Loaded Knowledge  <- knowledge files agent loaded via file_read tool
# Tool Calling      <- unified snake_case format + tool list
# Response Format   <- clean markdown, no tool blocks in text
# Skill Router      <- reference file loading guide
# Behavior Rules    <- trade logging, risk checks, backups
```

### Mode injection

System prompt header changes per mode:
- **MANUAL**: "You respond to user messages only. No autonomous actions."
- **RESTRICTED**: "You can act proactively but mutations require user approval."
- **FULL AUTONOMOUS**: "You have full permission to execute ALL operations. Act decisively."

### Response format rules

Model is instructed to:
- Write clean markdown (bold, code, headers, lists)
- NEVER include raw tool-call blocks in conversational text
- First execute tools, then respond with analysis
- Use code blocks for addresses, amounts, tx hashes

### Markdown rendering

Agent UI renders responses with `markdown-to-jsx`. Agent messages use custom overrides for headings, links, code, tables, and blockquotes. User messages stay plain text.

### Tool calling format

All tools use one unified format — snake_case command name inside `tool_call` blocks:

```text
{"command": "jaine_swap_sell", "args": {"--token-in": "w0G", "--amount": "1"}, "confirm": true}
```

**Routing rule**: Known internal tool names (snake_case, no spaces) → engine handles directly. CLI tool names (also snake_case) → executor converts `_` to space for echoclaw: `wallet_balance` → `echoclaw wallet balance`.

Parser: `parseToolCalls()` handles the primary `tool_call` block format and a fallback fenced `tool_calls` JSON block.

### Internal tools (handled by engine, instant)

| Tool | Example args | DB operation |
|------|-------------|-------------|
| `web_search` | `{"query": "..."}` | Tavily search → cache in `search_cache` |
| `web_fetch` | `{"url": "..."}` | Tavily extract (+ HTTP fallback) → cache in `fetch_cache` (1h) |
| `file_read` | `{"path": "..."}` | Read from `knowledge_files` or `skill_references` |
| `file_write` | `{"path": "...", "content": "..."}` | `knowledge_files` UPSERT |
| `file_list` | `{"path": "knowledge/"}` | List `knowledge_files` by prefix |
| `file_delete` | `{"path": "..."}` | DELETE from `knowledge_files` |
| `memory_update` | `{"append": "..."}` | INSERT into `memory_entries` |
| `trade_log` | `{"trade": "{...JSON...}"}` | INSERT/UPSERT into `trades` |
| `schedule_create` | `{"name":"...","cron":"...","type":"...","payload":{...}}` | INSERT into `scheduled_tasks` + register cron |
| `schedule_remove` | `{"id": "task-id"}` | DELETE from `scheduled_tasks` + stop cron |

### CLI tools (spawns echoclaw, snake_case → space-separated)

Representative examples: `wallet_balance`, `jaine_swap_sell`, `solana_swap_execute`, `khalani_bridge`, `slop_buy`, `0g_compute_ledger_deposit`, `echobook_post_create`, `slop_app_image_generate`

### CLI executor

`executor.ts` spawns `echoclaw <command> <args> --json [--yes]` via `child_process.execFile`.

- `--json` auto-added on every call
- `--yes` added only for confirmed mutations (full mode or user-approved)
- Sensitive CLI flags are redacted in debug logs (`--private-key`, `--password`, `--token`, `--mnemonic`, etc.)
- Timeouts: 60s default, 120s for on-chain operations
- Single canonical `MUTATING_COMMANDS` list used for both timeout selection AND permission checks

### Parser + message persistence

- `extractTextContent()` strips tool blocks before assistant-visible text is persisted.
- Assistant messages still preserve structured `toolCalls`, so `tool_call_id` round-tripping survives later model calls and approval resume.
- Internal `file_write` blocks path traversal except the special `soul.md` / `../soul.md` identity path.

### Skill router

Agent loads reference files on-demand from DB via `file_read` tool:

```text
{"command": "file_read", "args": {"path": "references/solana/solana-jupiter.md"}}
```

→ `skillsRepo.getSkillReference()` → full docs from `skill_references` table (<1ms)

References auto-seeded on startup with SHA-256 hash comparison — only updates when file content changes. Full content is preserved with zero trimming and zero chunking. `file_read` checks `knowledge_files` first and falls back to `skill_references`, so agent-authored content can shadow a packaged reference at the same path.

---

## Memory System

### Soul (agent identity)

- Table: `agent_soul` (singleton, id=1)
- Created on first conversation via `file_write` tool with path `soul.md`
- Loaded into every system prompt
- Includes: name, personality, trading style, behavior rules, PFP URL
- API currently exposes soul content only; `pfp_url` exists in schema/repo but is not wired into the agent server responses or standard UI flow

### Memory entries (evolving knowledge)

- Table: `memory_entries` (append-only)
- `category` and `source` are optional/free-form fields, not enum-constrained by the schema
- Current engine writes `memory_update` entries as `source="agent"` with no category; compaction writes `category="compaction"` / `source="compaction"`; restore preserves whatever metadata exists in `memory-entries.json`
- Loaded as concatenated text block in every system prompt
- Agent appends via `memory_update` tool

### Knowledge files (agent autonomy)

- Table: `knowledge_files`
- Agent has FULL autonomy — creates/edits/deletes any files
- Common files: `strategies/momentum.md`, `research/btc-analysis.md`, etc.
- Agent decides what to save to become better at trading over time

### Skill references (read-only, auto-synced)

- Table: `skill_references`
- Seeded from `skills/echoclaw/SKILL.md` + `skills/echoclaw/references/**/*.md`
- SHA-256 hash-based change detection on every startup
- Full content preserved — zero trimming, zero splitting
- Agent reads on-demand, learns to memorize common commands over time

---

## Context Window Management

**File**: `src/agent/context.ts`

### Critical rule: Full context preserved until compaction

The agent ALWAYS keeps the complete conversation history in play during normal operation. Every user message, assistant reply, and tool result remains persisted in Postgres and remains eligible for prompt inclusion until compaction triggers. No rolling truncation or message dropping happens before that threshold. This is essential for trading-style reasoning where the model needs the whole decision chain: checked price → evaluated risk → dry-run → confirmed trade → result → journal entry.

### Token budget

```
Total context = model limit (from provider metadata, default ~128k)
  - System prompt (soul + memory + tools + knowledge): ~10-30k
  - Conversation messages: remaining budget
```

### Hybrid compaction trigger

The engine uses `calculateHybridBudget()` rather than a pure heuristic on every turn:

- When available, it starts from the last real `prompt_tokens` snapshot returned by the provider.
- It then adds a heuristic estimate only for messages added since that snapshot.
- If no snapshot exists yet, it falls back to a full heuristic budget calculation.

When the total reaches the 80% threshold (`COMPACTION_THRESHOLD`):

1. Full transcript already persisted in `messages` table (nothing is lost)
2. Engine emits `status: { type: "compacting" }`
3. A non-streaming summarization request produces a session summary plus memory insights
4. Insights are appended to `memory_entries`
5. Old session is marked compacted and its summary stored in `sessions.summary`
6. A fresh session id is created with a recovery system message containing the summary
7. Hybrid token snapshots are reset; the full original transcript remains stored in DB

---

## Conversation Engine

**File**: `src/agent/engine.ts`

### Session isolation

All mutable state lives in `ConversationSession` objects (not module globals). Each session has: `id`, `messages` array, `loadedKnowledge` map, `inferenceConfig`. Server owns the active session, passes it to all engine functions.

### Message flow

```
POST /api/agent/chat { message, loopMode, sessionId? }
  1. Handler loads an existing session from DB or creates a new one
  2. sessionsRepo.createSession(id) ensures the session row exists
  3. messagesRepo.addMessage(session, userMsg)
  4. inferenceLoop(session, emit, loopMode):
     a. buildSystemPrompt() -- reads soul + memory from DB
     b. calculateHybridBudget() -- compact if threshold reached
     c. emit status(thinking)
     d. inferStreaming(config, [systemPrompt, ...messages]) -- SSE to browser
     e. usageRepo.logUsage() + update `sessions.token_count` + emit `usage` / `balance_low`
     f. parseToolCalls() and persist assistant text + structured toolCalls
     g. INTERNAL_TOOLS run first; if only internal tools ran, loop immediately
     h. CLI tools execute or enqueue approvals; tool results become `role="tool"` messages
  5. Final `done` event ends the stream
```

### Tool execution loop

Max 10 iterations per turn. Each iteration:

- Model may call tools OR respond with text
- Tool results stored in DB with proper `tool_call_id`
- Results fed back to model for next iteration
- Mutating commands check permissions (restricted = approval queue)

---

## Trade Tracking

### Unified trade schema

Single `trades` table for ALL trade types: swap, prediction, bonding, bridge, LP, stake, lend.

Agent logs trades via `trade_log` tool after every execution. Includes:
- Input/output tokens and amounts with USD values
- P&L (realized or unrealized)
- Metadata per type (dex, marketId, side, contracts, poolId, etc.)
- Agent's reasoning for the trade
- On-chain signature + explorer URL

### Trade types

| Type | Source commands |
|------|---------------|
| `swap` | `jaine swap`, `solana swap execute`, `khalani bridge` |
| `prediction` | `solana predict buy/sell/claim` |
| `bonding` | `slop buy/sell` |
| `bridge` | `khalani bridge` |
| `lp` | `jaine lp add/remove` |
| `stake` | `solana stake delegate/withdraw` |
| `lend` | `solana lend deposit/withdraw` |

### API endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/agent/trades` | All trades with type filter + pagination |
| `GET /api/agent/trades/summary` | Total P&L, win rate, W/L, trade count by type |
| `GET /api/agent/trades/recent` | Last N trades for dashboard cards |

---

## Web Search & Fetch (Tavily)

**File**: `src/agent/search.ts`

### How it works

Web search and URL extraction use the Tavily API (`@tavily/core` SDK). Optional — agent works without it (CLI tools are primary data source). Free tier: 1,000 credits/month at https://tavily.com.

**Search** (`webSearch()`):
1. Agent calls `web_search` internal tool
2. Check `search_cache` table (15min TTL, SHA-256 query hash)
3. Cache miss → `client.search(query, { maxResults: limit })`
4. Results (title + URL + content) cached in DB, returned to model
5. If no `TAVILY_API_KEY` → returns empty results with warning log

**Extract** (`webFetch()`):
1. Agent calls `web_fetch` internal tool
2. Check `fetch_cache` table (1h TTL, SHA-256 URL hash)
3. Cache miss → `client.extract([url])` → raw markdown content
4. Fallback: if Tavily unavailable, simple HTTP fetch with text extraction
5. Title extracted from first markdown heading

### Configuration

Set `TAVILY_API_KEY` via:
- CLI: `echoclaw echo` → "Run EchoClaw Agent locally" → optional prompt
- Launcher GUI: DashboardView hero card → "Add Tavily Key"
- Manual: add `TAVILY_API_KEY=tvly-...` to `~/.config/echoclaw/.env`

Stored in `~/.config/echoclaw/.env`. Passed to Docker container via compose env.

---

## Scheduled Tasks (Cron)

**Files**: `src/agent/scheduler.ts`, `src/agent/db/repos/tasks.ts`, `src/agent/handlers/tasks.ts`

Agent-created tasks are stored in `scheduled_tasks` and registered with `node-cron`. The current scheduler understands five task types:

- **cli_execute**: run an `echoclaw` command directly on cron
- **inference**: create a fresh session and feed a scheduled prompt into the engine
- **alert**: run an inference-based alert check in restricted mode
- **snapshot**: capture a portfolio snapshot
- **backup**: trigger the backup endpoint over local HTTP

Built-ins created automatically on init when missing:

- `builtin-portfolio-snapshot` — hourly at `0 * * * *`
- `builtin-auto-backup` — hourly at `30 * * * *`

**API endpoints:**

- `GET /api/agent/tasks` — list all scheduled tasks
- `POST /api/agent/tasks/:id/toggle` — enable/disable
- `DELETE /api/agent/tasks/:id` — remove (built-in tasks protected)

**Permission and lifecycle details:**

- Mutating `cli_execute` tasks are blocked unless the task's effective `loopMode` is `full`
- `schedule_create` prevents permission escalation: sessions not already in `full` mode can only create restricted tasks
- `next_run_at` exists in the schema but is not currently populated by the repo/scheduler implementation
- Only `builtin-portfolio-snapshot` is explicitly protected by the DELETE handler; `builtin-auto-backup` can be deleted, but will be recreated on the next scheduler init if missing
- On startup, the server seeds missing built-ins, loads enabled tasks from DB, registers cron jobs, and resumes the autonomous loop if `loop_state.active` was true before restart

---

## Portfolio Snapshots

**Files**: `src/agent/snapshot.ts`, `src/agent/db/repos/snapshots.ts`, `src/agent/handlers/portfolio.ts`

Periodic capture of all balances across active chains. Uses Khalani `tokens balances` for multi-chain coverage + native 0G balance.

Active chains auto-detected from `trades` table (`SELECT DISTINCT chain`) + defaults (0g, solana).

**API endpoints:**

- `GET /api/agent/portfolio` — latest snapshot (on-demand if none exists)
- `GET /api/agent/portfolio/history?range=24h|7d|30d|all` — time-series for P&L chart
- `GET /api/agent/portfolio/chains` — per-chain balances with trade counts

---

## Compute Billing

**Files**: `src/agent/billing.ts`, `src/agent/db/repos/billing.ts`, `src/agent/handlers/billing.ts`

### Funding path

EchoClaw Agent does not mint credits or hide billing behind a SaaS account. Paid inference burns from the user's funded **0G Compute** path on the **0G network**.

Operational sequence:

1. Acquire `0G`.
2. Transfer it to the operator wallet on the 0G EVM network.
3. Deposit into the ledger.
4. Fund the selected provider / broker balance.
5. Run inference; burn is tracked from live on-chain balances and provider pricing.

### Dynamic pricing

Pricing loaded from provider metadata at engine init (`ServiceDetail.inputPrice/outputPrice`), not hardcoded. Different models have different costs (GLM-5: 1.0/3.2, DeepSeek: 0.5/1.5, etc.).

### Ledger balance tracking

Real on-chain ledger balance read via `getLedgerBalance()` + `getSubAccountBalance()`. Cached 30s to avoid excessive RPC calls. Snapshots stored in `billing_snapshots` table.

### Low-balance alerts

After each inference, the engine checks whether `providerLockedOg < alertThresholdOg`. If yes, it emits an SSE `balance_low` event. The current implementation surfaces the warning in the UI, but it does not include a dedicated automatic deposit/remediation path — any funding action still has to come through normal model reasoning and tool execution.

### Burn indicators

`BurnMeter` still exists, but the current shell primarily uses a fixed right-edge `BurnBar` as the always-visible indicator. Together they show:

- Per-request token burn + cost in 0G (flashes on each request)
- Session total tokens + cost
- Ledger balance progress bar (green → amber → red)
- Estimated requests remaining
- "LOW" badge when below threshold

**API endpoint:** `GET /api/agent/billing` — ledger balance, burn rate, estimated remaining, pricing info

---

## Loop Engine

**Files**: `src/agent/scheduler.ts` (startLoopEngine/stopLoopEngine), `src/agent/db/repos/loop.ts`, `src/agent/handlers/loop.ts`

### Modes

- **Manual (off)**: Agent responds only to user messages
- **Restricted**: Agent acts autonomously but mutating operations need user approval via inline ApprovalCard
- **Full Auto**: Agent acts fully autonomously, mutations auto-executed with `--yes`

### How it works

When loop is started (via UI mode selector or API):
1. `POST /api/agent/loop/start` → writes `loop_state` DB table + starts `setInterval` in scheduler
2. Each cycle: inference handler creates a session, sends meta-prompt ("check portfolio, evaluate positions, take action"), agent decides what to do
3. `recordCycle()` updates `last_cycle_at` and `cycle_count` in DB
4. Status API reads real loop state from DB (not hardcoded)

### UI mode selector

Three-button toggle above chat input: Manual / Restricted / Full Auto. Persisted via API — survives page reload. Synced with backend state via `useEffect`.

**API endpoints:**

- `GET /api/agent/loop/status` — current loop state
- `POST /api/agent/loop/start` — `{ mode: "full"|"restricted", intervalMs: 300000 }`
- `POST /api/agent/loop/stop` — stops loop engine

---

## Auth & Security

**File**: `src/agent/server.ts`

### Startup token

Random token generated on boot (`agent-{48 hex chars}`). Written to `~/.config/echoclaw/agent/agent.token` (mode 600). Required for all `/api/*` endpoints except `/health` and `/auth-init`.

### Auth flow

1. UI calls `GET /api/agent/auth-init` on mount → sets HttpOnly `agent_token` cookie (SameSite=Strict)
2. All subsequent `fetch()` calls include `credentials: "include"` → cookie sent automatically
3. Server validates cookie or `Authorization: Bearer <token>` header

### CORS

- **Production** (NODE_ENV=production): No CORS headers. Same-origin only.
- **Dev mode**: CORS allowed from `localhost:4202` (Vite dev server) with credentials.

---

## Approval Flow

### Restricted mode

When `loopMode === "restricted"` and agent calls a mutating command:

1. `isMutatingCommand()` returns true (single canonical list in executor.ts)
2. Safe tools execute immediately, ALL mutating tools enqueued to approval queue
3. `approvalsRepo.enqueue()` saves toolCallId in `pending_context` for round-trip
4. SSE event `approval_required` sent to browser per pending tool
5. UI shows inline ApprovalCard (glassmorphic, amber border) with command, args, reasoning
6. User clicks Approve → `POST /api/agent/approve/:id` → SSE resume stream
7. `resumeAfterApproval()` executes with correct `toolCallId` → feeds result to model
8. If model calls another mutating tool → chained approval: new ApprovalCard appears (handled in approval SSE consumer)
9. Pending approvals load from DB on page mount (survive page reload)

### Multi-tool approval design

Intentionally piecemeal: each mutating tool is a separate approval decision. After approving tool A, engine re-enters inference — model sees result, may adjust or skip remaining tools. This is correct for financial mutations where market conditions change between executions.

### Full mode

All tools auto-execute. `--yes` flag added to mutations automatically.

### Mutating commands (single canonical list)

0G transfers (send confirm), Jaine DEX (swap, LP), Slop bonding (buy/sell/create), 0G Compute (deposit, fund, ack, api-key), Khalani bridge, Solana DeFi (swap, stake, lend, DCA, limit orders, predictions), 0G Storage (upload, put, snapshot, note, backup), Wallet mutations (create, import), Social (echobook post, vote, slop-app image, chat).

---

## Agent UI

**Stack**: React 19 + Vite 5 + Tailwind CSS 3 + `markdown-to-jsx`

**Build**: `pnpm run build:agent` → `dist/agent-ui/`
**Dev**: `pnpm run dev:agent` → Vite on port 4202, proxies `/api` to 4201

### Layout

The current app shell is `src/agent/ui/src/App.tsx` and is organized as:

- Collapsible left sidebar (hover-expand `w-14 → w-56`)
- Central chat area that is always visible
- Fixed right-edge `BurnBar`
- Floating widgets for Trades, Portfolio, Memory, and Operations

Sidebar contents:

- `AgentAvatar` identity panel
- Nav toggles for Chat / Trades / Portfolio / Memory / Ops
- Recent trade cards and lightweight lifetime stats
- `ThemeToggler` for light/dark theme switching

### Views

| View | File | Purpose |
|------|------|---------|
| ChatView | `views/ChatView.tsx` | Main chat surface with `useAgentStream()`, approvals, loop mode selector, and tool/file side-effect displays |
| TradesView | `views/TradesView.tsx` | Trade history, summary, and open-prediction grouping |
| MemoryView | `views/MemoryView.tsx` | Soul/memory/knowledge/session browser |
| PortfolioView | `views/PortfolioView.tsx` | Portfolio totals, history sparkline, chain breakdown, scheduled task controls |
| OpsWidget | `views/OpsWidget.tsx` | Backup / restore / billing / soul editing panel |

### Components

| Component | File | Purpose |
|-----------|------|---------|
| AgentAvatar | `components/AgentAvatar.tsx` | Deterministic avatar renderer with optional image mode |
| MessageBubble | `components/MessageBubble.tsx` | Grouped iMessage-style chat bubble with markdown rendering for agent replies |
| ToolCallsSection | `components/ToolCallsSection.tsx` | Collapsible list of active and completed tool calls |
| ChatInput | `components/ChatInput.tsx` | Chat composer |
| TradeCard | `components/TradeCard.tsx` | Trade card |
| TradeSummary | `components/TradeSummary.tsx` | Summary bar |
| FloatingWidget | `components/FloatingWidget.tsx` | Shared window shell for widgets |
| BurnBar | `components/BurnBar.tsx` | Current always-visible burn indicator |
| BurnMeter | `components/BurnMeter.tsx` | Reusable inline burn widget |
| ThemeToggler | `components/ThemeToggler.tsx` | Theme toggle |

### ChatView features

- **Session persistence**: captures `sessionId` from `status` SSE events, persists it in `localStorage`, and reuses it on later turns
- **Streaming**: `useAgentStream()` owns SSE parsing, tool state, approval queue state, burn state, and side-effect chips
- **Tool timeline**: active tools and completed tools are rendered separately via `ToolCallsSection`
- **Approvals**: pending approvals hydrate from `/api/agent/queue` on mount and approval resumes consume the same SSE protocol as chat
- **Loop mode selector**: Manual / Restricted / Full Auto toggle synced against backend `loop_state`
- **Branding**: subtle `landing.png` watermark behind the message area

### Rendering and theme

- Agent responses use `markdown-to-jsx` with custom overrides for headings, links, code, tables, and blockquotes. User messages stay plain text.
- The app supports both light and dark themes via CSS variables in `index.css`
- The visual language is card-heavy and glassy, but no longer assumes a permanently black-only theme

---

## Backup to 0G Storage

Backups use **0G Storage** as the durable remote layer. Concept reference:
https://docs.0g.ai/concepts/storage

### Backup scope

This is not a full database snapshot. The current implementation does not export or restore sessions/messages, approval queue, scheduled tasks, loop state, usage log, billing snapshots, portfolio snapshots, caches, or skill references.

### Exported files

| File | Source |
|------|--------|
| `soul.md` | Agent identity from `agent_soul` table |
| `memory.md` | Concatenated memory entries from `memory_entries` table |
| `memory-entries.json` | Structured memory entries with metadata |
| `knowledge.json` | All agent-created knowledge files |
| `trades.json` | Full trade history |

### Export flow

```
POST /api/agent/backup
  1. Export soul from DB -> temp soul.md
  2. Export memory entries from DB -> temp memory.md + memory-entries.json
  3. Export knowledge files from DB -> temp knowledge.json
  4. Export trades from DB -> temp trades.json
  5. echoclaw 0g-storage drive put --file <each> --path /agent/... --force --json
  6. echoclaw 0g-storage drive snapshot --json -> { root: "0xabc..." }
  7. If at least one upload succeeded, root hash becomes the retrieval key
  8. Store root hash + metadata in backup_log DB table
  9. Cleanup temp files
```

Implementation details:

- Backup proceeds as long as at least one exported file uploaded successfully.
- `memory.md` is exported for readability, but restore uses `memory-entries.json` as the authoritative memory source.
- The handler does not explicitly prune stale remote `/agent/*` files before taking the snapshot.

### Restore flow

```
POST /api/agent/restore   (or CLI: echoclaw echo agent restore --root 0xabc...)
  1. echoclaw 0g-storage drive snapshot restore --root <hash> --force
  2. echoclaw 0g-storage drive get for each implemented restore file
  3. Re-import downloaded files into Postgres tables
```

Actual restore semantics:

- `soul.md` -> `upsertSoul()`
- `memory-entries.json` -> append each entry with `appendMemory()` (repeat restores can duplicate memory entries)
- `knowledge.json` -> path-based UPSERTs into `knowledge_files`
- `trades.json` -> id-based UPSERTs into `trades`
- `memory.md` is not currently downloaded or imported during restore

### Auto-backup

A built-in hourly backup task is created by the scheduler, but there is an important implementation caveat: `executeBackupTask()` authenticates to `POST /api/agent/backup` with `Authorization: Bearer ${process.env.AGENT_AUTH_TOKEN ?? ""}`. That means automatic backup works reliably only when `AGENT_AUTH_TOKEN` is explicitly provided to the running process/container. Manual UI/CLI backups do not have this limitation because they bootstrap auth through the normal token/cookie flow.

`lastBackupAt` in the status endpoint is derived from the latest `backup_log` row, not from usage tracking.

### Backup log

Root hashes and metadata are persisted in the `backup_log` table for listing and auditing via `GET /api/agent/backups`.

---

## CLI Commands

```bash
echoclaw echo agent start [--port <number>] [--json]   # docker compose up -d + open browser
echoclaw echo agent stop [--json]                       # docker compose down
echoclaw echo agent status [--json]                     # running state, health check
echoclaw echo agent reset [--keep-soul] [--json]        # clear DB (--keep-soul preserves identity)
echoclaw echo agent backup [--json]                     # export DB → 0G Storage → root hash
echoclaw echo agent restore --root <hash> [--json]      # restore from snapshot: download files + re-import to DB
```

**Entry point**: `src/commands/echo/agent-cmd.ts` (uses `docker compose` as control plane)
**Docker check**: `src/agent/docker-check.ts` (sync for CLI, async for launcher)
**Error codes**: `AGENT_START_FAILED`, `AGENT_NOT_RUNNING` in `src/errors.ts`

**Effective runtime URL**: `http://127.0.0.1:4201`

Important CLI caveats:

- The CLI still accepts `--port`, but the current Docker compose file hard-binds `4201:4201` and `agent start` does not actually wire the option through to the stack. In practice, the agent currently runs on `4201`.
- `reset --keep-soul` is not implemented as a real soul-preserving reset. If the agent is running, the command only returns an informational response; if the stack is stopped, `docker compose down -v` still removes the Postgres volume and all soul data with it.
- `backup` and `restore` require the agent stack to already be running because both commands call the HTTP API.

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/agent/health` | Health check `{ status: "ok" }` |
| GET | `/api/agent/status` | Full status: model, soul, memory, sessions, usage, approvals |
| POST | `/api/agent/chat` | Send message → SSE stream response |
| GET | `/api/agent/usage` | Token usage + cost stats (session + lifetime) |
| GET | `/api/agent/memory/soul` | Read soul content |
| PUT | `/api/agent/memory/soul` | Admin override soul |
| GET | `/api/agent/memory/core` | Read memory entries as text |
| GET | `/api/agent/files` | List knowledge files (with ?path= prefix filter) |
| GET | `/api/agent/file?path=...` | Read specific knowledge file |
| GET | `/api/agent/sessions` | List sessions (newest first) |
| GET | `/api/agent/session/:id` | Read session messages |
| GET | `/api/agent/trades` | All trades (?type=swap&limit=20&offset=0) |
| GET | `/api/agent/trades/summary` | P&L, win rate, W/L, trade count by type |
| GET | `/api/agent/trades/recent` | Last N trades for dashboard cards |
| GET | `/api/agent/queue` | Pending approval items |
| POST | `/api/agent/approve/:id` | Approve/reject → SSE resume stream |
| GET | `/api/agent/portfolio` | Latest portfolio snapshot |
| GET | `/api/agent/portfolio/history` | Snapshot time-series (?range=24h|7d|30d) |
| GET | `/api/agent/portfolio/chains` | Per-chain balances with trade counts |
| GET | `/api/agent/tasks` | List scheduled tasks |
| POST | `/api/agent/tasks/:id/toggle` | Enable/disable task |
| DELETE | `/api/agent/tasks/:id` | Remove task |
| GET | `/api/agent/billing` | Ledger balance, burn rate, estimated remaining |
| GET | `/api/agent/loop/status` | Loop engine state |
| POST | `/api/agent/loop/start` | Start loop (mode + interval) |
| POST | `/api/agent/loop/stop` | Stop loop |
| GET | `/api/agent/auth-init` | Bootstrap auth cookie (same-origin) |
| POST | `/api/agent/backup` | Export agent data to 0G Storage, returns root hash |
| POST | `/api/agent/restore` | Restore from snapshot: download files + re-import to DB |
| GET | `/api/agent/backups` | List backup history with root hashes and dates |
| GET | `/api/agent/config` | Agent runtime config (tavilyConfigured) |

### SSE Event Protocol (POST /api/agent/chat)

| Event | Data | When |
|-------|------|------|
| `status` | `{ type: "session", sessionId }` | Server announces the session id the client should reuse |
| `status` | `{ type: "thinking" }` | Model is processing |
| `status` | `{ type: "compacting" }` | Session compaction has started |
| `text_delta` | `{ text: "..." }` | Streaming text content |
| `tool_start` | `{ id, command, args }` | Tool execution started |
| `tool_result` | `{ id, command, success, output, durationMs }` | Tool execution completed |
| `approval_required` | `{ id, toolCallId, command, args, reasoning }` | Restricted mode: needs user approval |
| `file_update` | `{ path, action }` | Agent wrote/read/deleted a file |
| `usage` | `{ promptTokens, completionTokens, totalTokens, costOg, sessionTotalTokens, sessionTotalCostOg, ledgerAvailableOg, ledgerLockedOg, estimatedRequestsRemaining, model, inputPricePerM, outputPricePerM }` | Per-request usage with ledger state |
| `balance_low` | `{ message, ledgerLockedOg, threshold }` | Compute balance below alert threshold |
| `error` | `{ message }` | Error occurred |
| `done` | `{ pendingApprovals?, sessionTokens? }` | Turn complete; `pendingApprovals` is authoritative, while `sessionTokens` is currently just the engine's per-turn bookkeeping field |

---

## File Reference

### Backend — Core

| File | Purpose |
|------|---------|
| `src/agent/constants.ts` | Ports, paths, limits, DB URL, SSE_TOOL_OUTPUT_LIMIT, PACKAGE_ROOT |
| `src/agent/types.ts` | All TypeScript types (ToolCall, Message, TradeEntry, etc.) |
| `src/agent/engine.ts` | Conversation loop: infer → parse → execute → loop |
| `src/agent/inference.ts` | Direct 0G Compute: broker auth → streaming SSE |
| `src/agent/tools.ts` | System prompt builder + tool call / internal tool parsers |
| `src/agent/executor.ts` | CLI spawner with timeouts, --json/--yes injection |
| `src/agent/context.ts` | Token estimation, budget calculation, compaction prompts |
| `src/agent/search.ts` | Tavily web search + extract client |
| `src/agent/docker-check.ts` | Docker detection utility (installed/running/compose) |
| `src/agent/billing.ts` | Ledger balance reader + burn rate tracker |
| `src/agent/scheduler.ts` | node-cron orchestrator for scheduled tasks |
| `src/agent/snapshot.ts` | Portfolio snapshot builder (Khalani balances) |
| `src/agent/server.ts` | HTTP server, static files, DB migration + skill seed on startup |
| `src/agent/routes.ts` | Route dispatcher with :param matching |

### Backend — DB Layer

| File | Purpose |
|------|---------|
| `src/agent/db/client.ts` | Pg pool + typed query/queryOne/execute helpers |
| `src/agent/db/migrate.ts` | Auto-migration runner (numbered SQL, transactional) |
| `src/agent/db/migrations/001_initial.sql` | Full schema (12 tables + indexes) |
| `src/agent/db/migrations/002_skill_hash.sql` | Add `content_hash` column to `skill_references` |
| `src/agent/db/migrations/003_fetch_cache.sql` | Add `fetch_cache` table for extracted pages |
| `src/agent/db/migrations/004_cron_and_snapshots.sql` | Add `scheduled_tasks` + `portfolio_snapshots` tables |
| `src/agent/db/migrations/005_billing.sql` | Add `billing_snapshots` table |
| `src/agent/db/migrations/006_backup_log.sql` | Add `backup_log` table for 0G Storage backup history |
| `src/agent/db/repos/soul.ts` | getSoul, hasSoul, upsertSoul |
| `src/agent/db/repos/memory.ts` | appendMemory, getMemoryEntries, getMemoryAsText, getMemorySize |
| `src/agent/db/repos/sessions.ts` | createSession, listSessions, compactSession |
| `src/agent/db/repos/messages.ts` | addMessage, getSessionMessages, getSessionMessageCount |
| `src/agent/db/repos/trades.ts` | addTrade, getTrades, getTradesSummary, getRecentTrades |
| `src/agent/db/repos/knowledge.ts` | getFile, upsertFile, deleteFile, listFiles, fileCount |
| `src/agent/db/repos/skills.ts` | getSkillReference, listSkillReferences, seedSkills (SHA-256 hash sync) |
| `src/agent/db/repos/usage.ts` | logUsage, getUsageStats |
| `src/agent/db/repos/approvals.ts` | enqueue (with toolCallId), approve (returns toolCallId), reject, getPending |
| `src/agent/db/repos/search.ts` | getCached, cacheResult, getCachedFetch, cacheFetchResult, pruneExpired |
| `src/agent/db/repos/tasks.ts` | createTask, listTasks, getEnabledTasks, toggleTask, deleteTask, recordRun |
| `src/agent/db/repos/snapshots.ts` | insertSnapshot, getLatest, getHistory, getActiveChains |
| `src/agent/db/repos/billing.ts` | insertSnapshot, getLatest, getHistory |
| `src/agent/db/repos/loop.ts` | getLoopState, startLoop, stopLoop, recordCycle |
| `src/agent/db/repos/backup.ts` | recordBackup, getLastBackup, listBackups, getBackupByRoot |

### Backend — Handlers

| File | Endpoints |
|------|-----------|
| `src/agent/handlers/chat.ts` | POST /api/agent/chat (SSE stream) |
| `src/agent/handlers/status.ts` | GET /api/agent/status, GET /api/agent/usage |
| `src/agent/handlers/memory.ts` | GET/PUT soul, GET memory, GET files, GET sessions |
| `src/agent/handlers/trades.ts` | GET trades, trades/summary, trades/recent |
| `src/agent/handlers/approve.ts` | GET queue, POST approve/:id (SSE resume with chained approvals) |
| `src/agent/handlers/portfolio.ts` | GET portfolio, portfolio/history, portfolio/chains |
| `src/agent/handlers/tasks.ts` | GET tasks, POST toggle, DELETE task |
| `src/agent/handlers/billing.ts` | GET billing (ledger balance + burn rate) |
| `src/agent/handlers/loop.ts` | GET/POST loop status/start/stop |
| `src/agent/handlers/backup.ts` | POST backup, POST restore, GET backups |

### Frontend — UI

| File | Purpose |
|------|---------|
| `src/agent/ui/vite.config.ts` | Vite config (output → dist/agent-ui/) |
| `src/agent/ui/tailwind.config.js` | Tailwind with custom colors + fonts |
| `src/agent/ui/postcss.config.js` | PostCSS with Tailwind |
| `src/agent/ui/index.html` | HTML shell (Poppins + JetBrains Mono) |
| `src/agent/ui/src/main.tsx` | React root mount |
| `src/agent/ui/src/App.tsx` | App shell: sidebar, central chat, fixed BurnBar, floating widgets, auth bootstrap, status polling |
| `src/agent/ui/src/api.ts` | Typed fetch wrappers + SSE consumer |
| `src/agent/ui/src/types.ts` | Frontend type mirrors |
| `src/agent/ui/src/utils.ts` | `cn()` (clsx + tailwind-merge) |
| `src/agent/ui/src/index.css` | CSS tokens, animations, scrollbar |
| `src/agent/ui/src/views/ChatView.tsx` | Main chat surface with `useAgentStream()`, approvals, loop mode selector, and tool/file side-effect displays |
| `src/agent/ui/src/views/TradesView.tsx` | Trade history, summary, and open-prediction grouping |
| `src/agent/ui/src/views/MemoryView.tsx` | Soul/memory/knowledge/session browser |
| `src/agent/ui/src/views/PortfolioView.tsx` | Portfolio totals, history sparkline, chain breakdown, scheduled task controls |
| `src/agent/ui/src/views/OpsWidget.tsx` | Backup / restore / billing / soul editing panel |
| `src/agent/ui/src/components/AgentAvatar.tsx` | Deterministic avatar renderer with optional image mode |
| `src/agent/ui/src/components/MessageBubble.tsx` | Grouped iMessage-style chat bubble with markdown rendering for agent replies |
| `src/agent/ui/src/components/ToolCallsSection.tsx` | Collapsible list of active and completed tool calls |
| `src/agent/ui/src/components/ChatInput.tsx` | Chat composer |
| `src/agent/ui/src/components/TradeCard.tsx` | Trade card |
| `src/agent/ui/src/components/TradeSummary.tsx` | Summary bar |
| `src/agent/ui/src/components/FloatingWidget.tsx` | Shared window shell for widgets |
| `src/agent/ui/src/components/BurnBar.tsx` | Current always-visible burn indicator |
| `src/agent/ui/src/components/BurnMeter.tsx` | Reusable inline burn widget |
| `src/agent/ui/src/components/ThemeToggler.tsx` | Theme toggle |

### Docker

| File | Purpose |
|------|---------|
| `docker/echo-agent/docker-compose.yml` | 4-service stack definition |
| `docker/echo-agent/docker-compose.build.yml` | Local dev override for repo builds |
| `docker/echo-agent/Dockerfile` | Agent container build (Node.js 22 bookworm-slim + echoclaw CLI) |
| `docker/echo-agent/.env.example` | Environment template (postgres password, Tavily API key) |

### CLI Integration

| File | Purpose |
|------|---------|
| `src/commands/echo/agent-cmd.ts` | CLI: start, stop, status, reset, backup, restore |
| `src/commands/echo/index.ts` | Registers agent subcommand under `echoclaw echo` |
| `src/utils/daemon-spawn.ts` | Daemon spawn helpers (agent uses Docker, not native daemon) |
| `src/errors.ts` | `AGENT_START_FAILED`, `AGENT_NOT_RUNNING` error codes |

---

## Data Flow Diagram

```
User types message
       |
       v
  +---------+    POST /api/agent/chat     +--------------+
  | Browser  | --------------------------> | Agent Server  |
  | (React)  | <-- SSE events ----------- | (engine.ts)   |
  +---------+                              +------+-------+
                                                  |
                             +--------------------+--------------------+
                             |                    |                    |
                       Build prompt          Execute tools      Search + Fetch
                             |                    |                    |
                   +---------v---------+  +-------v-------+  +--------v--------+
                   |    Postgres DB     |  |  echoclaw CLI   |  |  Tavily API     |
                   | soul + memory +    |  |  (in Docker)  |  |  (search links) |
                   | skills + knowledge |  |               |  +--------+--------+
                   | trades + sessions  |  |  wallet,swap,  |           |
                   | usage + approvals  |  |  bridge,predict|  +--------v--------+
                   | search/fetch cache |  |  storage,social|  |  (optional)    |
                   +-------------------+  +-------+-------+  |  (full markdown) |
                                                  |          +-----------------+
                                         +--------v--------+
                                         |  0G Compute     |
                                         |  (inference)    |
                                         |  + 0G Network   |
                                         |  (on-chain ops) |
                                         +-----------------+
```
