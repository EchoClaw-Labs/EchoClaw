# Wallet & Transfers Reference

This module is the authoritative guide for `wallet`, `send`, and wallet-adjacent `config` commands.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup Commands (password + provider linking)](#setup-commands-password--provider-linking)
- [Wallet Commands](#wallet-commands)
- [Solana Wallet Specifics](#solana-wallet-specifics)
- [Config Commands](#config-commands)
- [Native Transfer Commands — 0G (2-step)](#native-transfer-commands-0g-2-step)
- [Solana Transfer Commands (single-step)](#solana-transfer-commands-single-step)
- [Headless Guardrail](#headless-guardrail)
- [Agent-safe execution flow](#agent-safe-execution-flow)
- [JSON examples](#json-examples)
- [Error codes (wallet/transfers scope)](#error-codes-wallettransfers-scope)
- [Cross-references](#cross-references)

## Prerequisites

- `echoclaw` installed (`npm i -g @echoclaw/echo`)
- Node.js >= 22
- `ECHO_KEYSTORE_PASSWORD` set for signing/decryption operations

Recommended password setup:

```bash
export ECHO_KEYSTORE_PASSWORD="your-secure-password"
echoclaw setup password --from-env --json
```

## Setup Commands (password + provider linking)

```bash
echoclaw setup password --from-env [--force] [--auto-update] --json
echoclaw setup password --password <password> [--force] [--auto-update] --json
```

- Default storage target: `~/.config/echoclaw/.env`
- No provider-specific mirror is written for generic app secrets

Provider linking:

```bash
echoclaw skill install --provider openclaw|claude|codex|other --scope user|project --json
echoclaw setup provider --provider openclaw|claude|codex|other --scope user|project --json
```

## Wallet Commands

### Core wallet lifecycle

```bash
echoclaw wallet create [--chain eip155|solana] [--force] --json
echoclaw wallet import [privateKey] [--chain eip155|solana] [--stdin] [--force] --json
echoclaw import [privateKey] [--chain eip155|solana] [--stdin] [--force] --json  # alias for wallet import
echoclaw wallet ensure --json
echoclaw wallet address [--chain eip155|solana] --json
echoclaw wallet balance --json
echoclaw wallet balances [--wallet eip155|solana|all] --json
```

- `wallet ensure` is an idempotent readiness check. In headless mode it stays non-mutating unless `ECHO_ALLOW_WALLET_MUTATION=1` is set.
- `wallet balance` is the fast native 0G balance snapshot.
- `wallet balances` is the Khalani-backed multi-chain balance surface and includes live native balances for the relevant EVM/Solana chains.

### Backup / restore

```bash
echoclaw wallet backup --json
echoclaw wallet backup list --json
echoclaw wallet restore <backupDir> --force --json
```

- `restore` requires `--force`.
- restore performs an auto-backup of current state before applying backup files.

### Export key (manual-only)

```bash
echoclaw wallet export-key [--chain eip155|solana] --to-file <path>
echoclaw wallet export-key [--chain eip155|solana] --stdout --i-understand
```

- This command is blocked in headless mode and should not be used by automation agents.

## Solana Wallet Specifics

Solana wallet uses a separate keystore file and address field:

- **Keystore**: `~/.config/echoclaw/solana-keystore.json` (AES-256-GCM encrypted, same password as EVM keystore)
- **Config field**: `wallet.solanaAddress` (base58-encoded public key)
- **Import accepts**: base58 secret key OR 64-byte JSON array (Solana CLI format `~/.config/solana/id.json`)

```bash
# Create new Solana wallet
echoclaw wallet create --chain solana --json

# Import from base58 private key
echoclaw wallet import <base58-secret-key> --chain solana --json

# Import from Solana CLI keypair file (pipe)
cat ~/.config/solana/id.json | echoclaw wallet import --chain solana --stdin --json

# Check Solana address
echoclaw wallet address --chain solana --json

# Verify both EVM + Solana wallets exist
echoclaw wallet ensure --json
```

Balance commands:
- `wallet balance` — **0G native only** (fast, single RPC call)
- `wallet balances --wallet solana` — Khalani-backed Solana token balances with USD prices
- `wallet balances --wallet all` — cross-chain (EVM + Solana) via Khalani

`wallet ensure` in headless mode will auto-create a missing Solana wallet **only** when `ECHO_ALLOW_WALLET_MUTATION=1` is set.

## Config Commands

```bash
echoclaw config init --json
echoclaw config set-rpc <url> --json
echoclaw config set-solana-rpc <url> --json
echoclaw config set-solana-cluster <mainnet-beta|devnet|testnet> --json
echoclaw config set-jupiter-key <key> --json
echoclaw config show --json
```

- `config set-solana-rpc` changes Solana RPC endpoint and auto-detects cluster from URL.
- `config set-solana-cluster` sets cluster and auto-fills RPC URL + explorer URL for known clusters.
- `config set-jupiter-key` sets Jupiter API key for higher rate limits and Studio access.
- `config show` now includes a Solana section (cluster, RPC, explorer, commitment, Jupiter key status).

Interactive-only command:

```bash
echoclaw config set-key
```

- `config set-key` requires TTY and is not agent-safe.

## Native Transfer Commands — 0G (2-step)

```bash
echoclaw send prepare --to <address> --amount <0G> [--note <text>] --json
echoclaw send confirm <intentId> --yes --json
```

Rules:
- Always execute `prepare` first.
- `confirm` requires `--yes`.
- Prepared intents expire after 10 minutes.

## Solana Transfer Commands (2-step, same as 0G)

Solana transfers use the same prepare → confirm intent flow as 0G:

```bash
# SOL: prepare (read-only, no key access)
echoclaw solana send prepare --to <solana-address> --amount <SOL> [--note <text>] --json

# SOL: confirm (requires --yes + password)
echoclaw solana send confirm <intentId> --yes --json

# SPL token: prepare
echoclaw solana send-token prepare --to <solana-address> --token USDC --amount 50 --json

# SPL token: confirm
echoclaw solana send-token confirm <intentId> --yes --json
```

Security model (identical to 0G):
- `prepare` is read-only — validates inputs, checks balance, creates intent file. No keystore decryption.
- `confirm` requires `--yes` + `ECHO_KEYSTORE_PASSWORD` — decrypts keystore, verifies signer, re-checks balance, signs and broadcasts.
- Intents expire after **10 minutes**. Single-use (deleted after confirm).
- Signer verification: `wallet.solanaAddress` must match `intent.from`.
- Cluster verification: `config.solana.cluster` must match `intent.cluster`.

Additional rules:
- Token resolution: symbols (`USDC`, `BONK`) are resolved via well-known list → cache → Jupiter Token API.
- Cluster warning: a warning appears on confirm if `config.solana.cluster` is not `mainnet-beta`.
- Recipient ATA: for SPL tokens, a recipient token account is auto-created if needed (costs ~0.002 SOL rent).

For the full Solana DeFi surface (swap, stake, lend, DCA, etc.) see `references/solana/solana-jupiter.md`.

## Headless Guardrail

In headless mode, these commands are blocked by default:
- `wallet create`
- `wallet import`
- `wallet restore`

Override only when explicitly intended:

```bash
ECHO_ALLOW_WALLET_MUTATION=1 echoclaw wallet create --json
```

That same unlock is required if you intentionally want `wallet ensure --json` to create a missing Solana wallet in headless mode.

## Agent-safe execution flow

### 0G transfer flow (2-step)

1. `echoclaw setup password --from-env --json`
2. `echoclaw wallet ensure --json`
3. `echoclaw wallet balance --json`
4. `echoclaw send prepare --to 0x... --amount 1.5 --json`
5. `echoclaw send confirm <intentId> --yes --json`
6. (Optional) `echoclaw wallet backup --json`

### Solana transfer flow (2-step)

1. `echoclaw setup password --from-env --json`
2. `echoclaw wallet ensure --json` — ensures both EVM + Solana wallets
3. `echoclaw wallet balances --wallet solana --json` — check Solana balances
4. `echoclaw solana send prepare --to <addr> --amount 1 --json` — creates intent, returns `intentId`
5. (Agent/user reviews the intent details)
6. `echoclaw solana send confirm <intentId> --yes --json` — signs and broadcasts
7. Parse `signature` and `explorerUrl` from JSON response

### Solana wallet setup flow

1. `echoclaw wallet create --chain solana --json`
2. `echoclaw config set-solana-rpc https://your-rpc.com --json` (optional)
3. `echoclaw config set-jupiter-key YOUR_KEY --json` (optional)
4. `echoclaw wallet ensure --json` — verify readiness

## JSON examples

Wallet ensure (ready):

```json
{
  "success": true,
  "status": "ready",
  "address": "0x...",
  "hasKeystore": true,
  "passwordSet": true
}
```

Send prepare:

```json
{
  "success": true,
  "intentId": "intent_...",
  "from": "0x...",
  "to": "0x...",
  "value": "1.5",
  "valueWei": "1500000000000000000",
  "expiresAt": "2026-..."
}
```

Send confirm:

```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://chainscan.0g.ai/tx/0x...",
  "status": "pending",
  "intentId": "intent_...",
  "chainId": 16661,
  "to": "0x...",
  "valueWei": "1500000000000000000",
  "value0G": "1.5"
}
```

Error format:

```json
{
  "success": false,
  "error": {
    "code": "KEYSTORE_PASSWORD_NOT_SET",
    "message": "ECHO_KEYSTORE_PASSWORD environment variable is required.",
    "hint": "Run: echoclaw setup password --from-env"
  }
}
```

## Error codes (wallet/transfers scope)

- `KEYSTORE_PASSWORD_NOT_SET`
- `WALLET_NOT_CONFIGURED`
- `KEYSTORE_NOT_FOUND`
- `KEYSTORE_ALREADY_EXISTS`
- `KEYSTORE_DECRYPT_FAILED`
- `WALLET_MUTATION_BLOCKED_HEADLESS`
- `INSUFFICIENT_BALANCE`
- `INTENT_NOT_FOUND`
- `INTENT_EXPIRED`
- `CONFIRMATION_REQUIRED`
- `INVALID_ADDRESS`
- `INVALID_AMOUNT`
- `CHAIN_MISMATCH`
- `RPC_ERROR`
- `SIGNER_MISMATCH`
- `INVALID_PRIVATE_KEY`
- `BACKUP_NOT_FOUND`
- `AUTO_BACKUP_FAILED`
- `INTERACTIVE_COMMAND_NOT_SUPPORTED`
- `PASSWORD_MISMATCH`

### Solana-specific error codes

- `SOLANA_INVALID_ADDRESS`
- `SOLANA_INSUFFICIENT_BALANCE`
- `SOLANA_TRANSFER_FAILED`
- `SOLANA_TX_FAILED`
- `SOLANA_TX_TIMEOUT`
- `SOLANA_TOKEN_NOT_FOUND`
- `SOLANA_RPC_ERROR`
- `KHALANI_SOLANA_KEYSTORE_NOT_FOUND`
- `KHALANI_ADDRESS_MISMATCH`

## Cross-references

- Trading and LP execution on 0G: `references/0g/jaine-dex.md`
- Read-only 0G market analytics: `references/0g/jaine-subgraph.md`
- Cross-chain bridging and token balances: `references/khalani-cross-chain.md`
- Full Solana DeFi (swap, stake, lend, predict, DCA, etc.): `references/solana/solana-jupiter.md`
