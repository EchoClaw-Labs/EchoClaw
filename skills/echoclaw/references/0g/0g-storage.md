# 0G Storage Reference

This module is the authoritative guide for `echoclaw 0g-storage ...` commands.

Scope:
- raw file upload/download/info on 0G Storage mainnet
- virtual drive filesystem (local JSON index + 0G Storage backing)
- persistent agent notes
- wallet backup push
- drive snapshots (upload/restore index to 0G)
- readiness check and interactive wizard

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture overview](#architecture-overview)
- [Command Map](#command-map)
  - [Setup & Wizard](#setup--wizard)
  - [File (raw storage)](#file-raw-storage)
  - [Drive (virtual filesystem)](#drive-virtual-filesystem)
  - [Note (agent notepad)](#note-agent-notepad)
  - [Backup](#backup)
- [Use-case patterns](#use-case-patterns)
- [JSON examples](#json-examples)
- [Safety rules](#safety-rules)
- [Error codes](#error-codes)
- [Cross-references](#cross-references)

## Prerequisites

- Wallet configured: `echoclaw wallet create --json` or `echoclaw wallet import --json`
- 0G balance for gas + storage fees (typical upload: ~0.001 0G)
- Network connectivity to 0G mainnet RPC and indexer

Default endpoints (auto-configured):
- EVM RPC: `https://evmrpc.0g.ai` (chain ID: 16661)
- Storage Indexer: `https://indexer-storage-turbo.0g.ai`
- Flow Contract: `0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526` (forward-looking config for KV/batcher flows; current file upload/download resolves the contract dynamically from the SDK)

## Architecture overview

### Framework-agnostic core

0G Storage works identically for OpenClaw, Claude Code, Codex, and any runtime that can execute `echoclaw`. No framework-specific dependencies in the core module.

### Layers

1. **File layer** — raw 0G Storage operations (upload/download/info). Direct SDK interaction.
2. **Drive layer** — virtual filesystem backed by a local JSON index (`~/.config/echoclaw/storage-drive.json`). Files stored on 0G, paths managed locally.
3. **Note layer** — persistent notepad stored as markdown files in drive under `/notes/`.
4. **Backup layer** — push local files or wallet backups to 0G with drive index tracking.

### Cost tracking

Every upload returns cost info computed via balance diff (pre/post upload):
```json
{ "totalWei": "1240242735815333", "total0G": "0.001240" }
```
TTY display: `Cost: 0.001240 0G`

To convert 0G cost to USD, use Jaine DEX: `echoclaw jaine pools find w0G USDC --amount-in 1 --json`. The `amountOut` is the current price of 1 w0G in USDC. Multiply `total0G` by this value. See `references/jaine-dex.md`.

## Command Map

### Setup & Wizard

| Command | Type | Description |
|---------|------|-------------|
| `0g-storage setup [--indexer <url>] [--rpc <url>] --json` | read-only | Readiness check: wallet, RPC, indexer connectivity |
| `0g-storage wizard [--test-upload] [--indexer <url>] [--rpc <url>]` | interactive | Guided setup with optional upload/download round-trip |

### File (raw storage)

| Command | Type | Description |
|---------|------|-------------|
| `0g-storage file upload --file <path> [--tags <hex>] --json` | mutating | Upload a file to 0G Storage |
| `0g-storage file download --root <0x...> --out <path> [--proof] --json` | read-only | Download a file by root hash |
| `0g-storage file info --root <0x...> [--txseq <n>] --json` | read-only | Query file info from storage nodes |

**file info strategy**: `--root` or `--txseq` (at least one required). `--txseq` is more reliable; `--root` may fail on some nodes.

### Drive (virtual filesystem)

All drive commands operate on a local JSON index. Only `put`, `get`, and `snapshot` interact with 0G Storage network.

| Command | Type | Description |
|---------|------|-------------|
| `drive put --file <path> --path <vpath> [--force] --json` | mutating | Upload file + register in drive index |
| `drive get --path <vpath> --out <path> --json` | read-only | Download file by virtual path |
| `drive ls [--path <dir>] [--recursive] --json` | local | List directory contents |
| `drive mkdir --path <dir> --json` | local | Create a directory |
| `drive tree [--path <dir>] --json` | local | Show directory tree |
| `drive rm --path <vpath> --json` | local | Remove entry from index (data on 0G remains) |
| `drive mv --from <path> --to <path> --json` | local | Move/rename in index |
| `drive find --pattern <glob> --json` | local | Search files by glob pattern |
| `drive du [--path <dir>] --json` | local | Show disk usage per directory |
| `drive info --path <vpath> --json` | local | Show detailed file info |
| `drive share --path <vpath> --json` | local | Get root hash for sharing |
| `drive import --root <hash> --path <vpath> --json` | local | Import external file by root hash |
| `drive export --json` | local | Export entire drive index |
| `drive snapshot --json` | mutating | Upload drive index to 0G as snapshot |
| `drive snapshot list --json` | local | List all snapshots |
| `drive snapshot restore --root <hash> --force --json` | mutating | Restore index from snapshot |

**Virtual path rules**:
- Always starts with `/` (auto-prepended if missing)
- No `..` or `.` segments
- Trailing `/` = directory
- Allowed chars: `a-z A-Z 0-9 - _ . /`
- Max path: 512 chars, max segment: 255 chars
- Implicit mkdir: `drive put --path /a/b/c.txt` auto-creates `/a/` and `/a/b/`

**Snapshot restore guardrail**: `--force` is required. Without it, the command errors. Before overwriting, the current index is automatically backed up as a snapshot.

### Note (agent notepad)

Notes are stored as markdown files in the drive under `/notes/{noteId}.md`.

| Command | Type | Description |
|---------|------|-------------|
| `note put --title <t> --body <text> --json` | mutating | Create a note (uploads to 0G) |
| `note get --id <id> --json` | read-only | Retrieve a note by ID |
| `note list [--limit <n>] --json` | local | List all notes |

### Backup

| Command | Type | Description |
|---------|------|-------------|
| `backup push --source <path> --json` | mutating | Upload a file as backup |
| `backup push --source wallet-latest --json` | mutating | Upload latest wallet backup to 0G |

`wallet-latest` reuses existing `echoclaw wallet backup` output. Run `echoclaw wallet backup` first.

## Use-case patterns

These are not separate commands — they are patterns built on drive/note.

### Artifact store
```bash
echoclaw 0g-storage drive put --file ./report.json --path /artifacts/daily-report.json --json
echoclaw 0g-storage drive put --file ./output.csv --path /artifacts/analysis-output.csv --json
echoclaw 0g-storage drive ls --path /artifacts --json
```

### Checkpoint store
```bash
# Save checkpoint
echoclaw 0g-storage drive put --file ./state.json --path /checkpoints/step-3.json --json
echoclaw 0g-storage drive snapshot --json

# Restore to previous state
echoclaw 0g-storage drive snapshot restore --root <hash> --force --json
```

### Handoff between sessions/agents
```bash
# Agent A: share artifact
echoclaw 0g-storage drive share --path /artifacts/result.json --json
# Output: { "root": "0xabc..." }

# Agent B: import shared artifact
echoclaw 0g-storage drive import --root 0xabc... --path /imports/result.json --json
echoclaw 0g-storage drive get --path /imports/result.json --out ./result.json --json
```

### Research journal
```bash
echoclaw 0g-storage note put --title "API findings" --body "The rate limit is 100/min..." --json
echoclaw 0g-storage note list --json
echoclaw 0g-storage note get --id <noteId> --json
```

## JSON examples

### file upload
```json
{
  "success": true,
  "root": "0xcba308...",
  "txHash": "0x93fb05...",
  "sizeBytes": 1234,
  "checksum": "sha256:a1b2c3d4...",
  "uploadedAt": "2026-03-05T16:15:00.000Z",
  "cost": { "totalWei": "1240242735815333", "total0G": "0.001240" }
}
```

### drive put
```json
{
  "success": true,
  "path": "/docs/readme.md",
  "root": "0xcba308...",
  "txHash": "0x93fb05...",
  "sizeBytes": 1234,
  "cost": { "totalWei": "1240242735815333", "total0G": "0.001240" }
}
```

### drive ls
```json
{
  "success": true,
  "path": "/docs",
  "entries": [
    { "name": "readme.md", "type": "file", "size": 1234, "root": "0xcba308..." },
    { "name": "images/", "type": "dir" }
  ]
}
```

### drive snapshot
```json
{
  "success": true,
  "root": "0xdef456...",
  "entryCount": 42,
  "cost": { "totalWei": "800000000000000", "total0G": "0.000800" }
}
```

### note put
```json
{
  "success": true,
  "noteId": "1709654100000-a1b2c3d4",
  "title": "API findings",
  "createdAt": "2026-03-05T16:15:00.000Z",
  "cost": { "totalWei": "1240242735815333", "total0G": "0.001240" }
}
```

### note list
```json
{
  "success": true,
  "notes": [
    { "noteId": "1709654100000-a1b2c3d4", "name": "1709654100000-a1b2c3d4.md", "size": 256, "uploadedAt": "2026-03-05T16:15:00.000Z" }
  ],
  "count": 1
}
```

Note: `title` is not included in list output (would require downloading each note). Use `note get --id <id>` to retrieve title and body.

### setup
```json
{
  "success": true,
  "ready": true,
  "checks": {
    "wallet": { "ok": true, "detail": "0x1234..." },
    "rpc": { "ok": true, "detail": "https://evmrpc.0g.ai" },
    "indexer": { "ok": true, "detail": "https://indexer-storage-turbo.0g.ai" }
  },
  "endpoints": {
    "evmRpcUrl": "https://evmrpc.0g.ai",
    "indexerRpcUrl": "https://indexer-storage-turbo.0g.ai",
    "flowContract": "0x62d4144db0f0a6fbbaeb6296c785c71b3d57c526"
  }
}
```

## Safety rules

- **Uploads cost gas + storage fees**: always check wallet balance before bulk uploads.
- **Data on 0G is immutable**: `drive rm` removes the local index entry only; the file remains on the network.
- **Snapshot restore overwrites index**: requires `--force`; auto-backs up current index first.
- **No encryption in MVP**: files are uploaded in plaintext. Do not upload secrets or private keys.
- **`wallet-latest` backup**: uploads keystore.json (already encrypted via scrypt+AES-256-GCM) but manifest and config are plaintext.
- **Prefer `--json`** for machine-readable output in automation.

## Error codes

| Code | Meaning |
|------|---------|
| `ZG_STORAGE_SETUP_FAILED` | RPC or indexer unreachable |
| `ZG_STORAGE_UPLOAD_FAILED` | Upload SDK error (check balance/network) |
| `ZG_STORAGE_DOWNLOAD_FAILED` | Download failed (check root hash) |
| `ZG_STORAGE_FILE_NOT_FOUND` | Root/txSeq not found on storage nodes |
| `ZG_STORAGE_INDEX_NOT_FOUND` | Virtual path not in drive index |
| `ZG_STORAGE_INDEX_CONFLICT` | Path already exists (use `--force`) |
| `ZG_STORAGE_INVALID_PATH` | Invalid virtual path format |
| `ZG_STORAGE_PERMISSION_DENIED` | No wallet configured |

## Cross-references

- **Wallet setup**: `references/wallet-transfers.md` — wallet create/import, backup/restore
- **0G Compute**: `references/0g-compute.md` — compute ledger, provider discovery (uses same 0G network)
- **EchoBook**: `references/echobook.md` — social layer (can store EchoBook artifacts via drive)
