# Khalani Cross-Chain Reference

This module is the authoritative guide for `echoclaw khalani *` and the multi-chain wallet surface used by Khalani routes.

## Scope

- chain discovery
- token discovery and balances
- quote and bridge
- order tracking
- EVM + Solana wallet usage in Khalani flows

## Core commands

```bash
echoclaw khalani chains --json
echoclaw khalani tokens top [--chain-ids <id,id>] --json
echoclaw khalani tokens search <query> [--chain-ids <id,id>] --json
echoclaw khalani tokens autocomplete <keyword> [--chain-ids <id,id>] --json
echoclaw khalani tokens balances [address] [--chain-ids <id,id>] [--wallet eip155|solana] --json
echoclaw khalani quote --from-chain <chain> --from-token <token-address> --to-chain <chain> --to-token <token-address> --amount <smallest-units> [--trade-type EXACT_INPUT|EXACT_OUTPUT] [--recipient <addr>] [--refund-to <addr>] [--referrer <addr>] [--referrer-fee-bps <bps>] [--route <routeId>] [--stream] --json
echoclaw khalani bridge --from-chain <chain> --from-token <token-address> --to-chain <chain> --to-token <token-address> --amount <smallest-units> [--route-id <routeId>] [--deposit-method CONTRACT_CALL|PERMIT2|TRANSFER] [--dry-run] [--yes] --json
echoclaw khalani orders [address] [--wallet eip155|solana] [--limit <n>] [--cursor <n>] --json
echoclaw khalani order <orderId> --json
```

## Wallet family commands

```bash
echoclaw wallet create [--chain eip155|solana] [--force] --json
echoclaw wallet import [secret] [--chain eip155|solana] [--stdin] [--force] --json
echoclaw wallet address [--chain eip155|solana] --json
echoclaw wallet ensure --json
echoclaw wallet export-key [--chain eip155|solana] --to-file <path>
```

- `wallet.address` remains the legacy EVM source of truth.
- `wallet.solanaAddress` is stored separately.
- Solana uses a distinct `solana-keystore.json`, but the same `ECHO_KEYSTORE_PASSWORD`.
- `wallet ensure` stays read-only in headless mode unless wallet mutation has been explicitly unlocked.
- `wallet balances` now includes live native balances alongside Khalani token balances.

## Address and chain rules

- source and refund addresses must match the source chain family
- recipient must match the destination chain family
- referrer must always be a valid EVM address
- if address flags are omitted, EchoClaw falls back to the configured wallet for the matching family
- chain values can be numeric IDs or aliases like `eth`, `arb`, `base`, `op`, `sol`, `0g`
- token values must be chain-specific token addresses; use token search/autocomplete if you only know the symbol

## Execution model

- `quote` is read-only
- `quote --stream --json` emits NDJSON with `type: "route"` lines followed by a final `type: "complete"` summary
- `bridge --dry-run` builds the deposit plan without broadcast
- `bridge --yes` executes the selected deposit plan
- EVM `CONTRACT_CALL` routes translate Khalani `eip1193_request` payloads into local `viem` wallet sends
- Solana `CONTRACT_CALL` routes deserialize and sign `VersionedTransaction`, then broadcast through Solana RPC
- `TRANSFER` is supported for EVM routes

## Deferred / blocked in v1

- `PERMIT2` live execute is intentionally blocked
- reason: current Khalani docs do not provide a canonical execute payload/ABI that the CLI can trust without guessing
- safe surface in v1: quote, build, and `bridge --dry-run --deposit-method PERMIT2`

## Agent-safe flow

1. `echoclaw wallet ensure --json`
2. `echoclaw khalani chains --json`
3. `echoclaw khalani tokens search <query> --json`
4. `echoclaw khalani quote ... --json`
5. `echoclaw khalani bridge ... --dry-run --json`
6. `echoclaw khalani bridge ... --yes --json`
7. `echoclaw khalani orders --json`

## Success examples

Quote:

```json
{
  "success": true,
  "quoteId": "quote_123",
  "bestRouteIndex": 0,
  "bestRoute": {
    "routeId": "route_abc",
    "depositMethods": ["CONTRACT_CALL"]
  }
}
```

Bridge dry-run:

```json
{
  "success": true,
  "dryRun": true,
  "quoteId": "quote_123",
  "route": {
    "routeId": "route_abc"
  },
  "depositPlan": {
    "kind": "CONTRACT_CALL"
  }
}
```

Bridge execute:

```json
{
  "success": true,
  "orderId": "order_123",
  "txHash": "0xabc...",
  "quoteId": "quote_123",
  "routeId": "route_abc"
}
```

## Error codes

- `KHALANI_API_ERROR`
- `KHALANI_TIMEOUT`
- `KHALANI_RATE_LIMITED`
- `KHALANI_QUOTE_NOT_FOUND`
- `KHALANI_QUOTE_EXPIRED`
- `KHALANI_VALIDATION_ERROR`
- `KHALANI_CANNOT_FILL`
- `KHALANI_UNSUPPORTED_TOKEN`
- `KHALANI_UNSUPPORTED_CHAIN`
- `KHALANI_DEPOSIT_FAILED`
- `KHALANI_BROADCAST_FAILED`
- `KHALANI_PERMIT2_BLOCKED`
- `KHALANI_ORDER_NOT_FOUND`
- `KHALANI_SOLANA_SIGN_FAILED`
- `KHALANI_SOLANA_KEYSTORE_NOT_FOUND`
- `KHALANI_ADDRESS_MISMATCH`
