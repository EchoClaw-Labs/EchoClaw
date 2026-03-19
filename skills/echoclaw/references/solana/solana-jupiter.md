# Solana / Jupiter Reference

This module is the authoritative guide for `echoclaw solana *`. All Solana operations use Jupiter as the backend — swaps, token discovery, pricing, lending, predictions, DCA, limit orders, token creation, and portfolio.

## Scope

- token swap (Ultra API — aggregates Raydium, Orca, Meteora, all Solana DEXes)
- token browse (trending, top-traded, recent)
- price lookup
- SOL and SPL token transfers
- SOL staking (delegate, withdraw, claim MEV)
- DCA (dollar-cost averaging via Jupiter Recurring API)
- limit orders (Jupiter Trigger V1 API)
- lending (Jupiter Lend Earn — deposit, withdraw, rates)
- prediction markets (Jupiter Prediction — buy/sell YES/NO contracts)
- portfolio / holdings (Ultra holdings API)
- token security (Ultra Shield API)
- token creation (Jupiter Studio — requires API key)
- send via invite code (Jupiter Send)
- SPL token burn and empty account closure

## Prerequisites

- Solana wallet configured: `echoclaw wallet create --chain solana` or `echoclaw wallet import --chain solana`
- `ECHO_KEYSTORE_PASSWORD` env var set
- Optional: `echoclaw config set-jupiter-key <key>` for higher rate limits and Studio access
- Optional: `echoclaw config set-solana-rpc <url>` for private RPC (default: public mainnet)

## Core commands

### Swap

```bash
echoclaw solana swap quote <from> <to> --amount <n> [--slippage-bps <bps>] --json
echoclaw solana swap execute <from> <to> --amount <n> [--slippage-bps <bps>] --yes --json
```

Tokens can be symbols (`SOL`, `USDC`, `BONK`) or mint addresses. Jupiter Ultra routes through all Solana DEXes automatically.

### Browse & Price

```bash
echoclaw solana browse [category] [--interval 1h|6h|24h] [--limit <n>] --json
echoclaw solana price <token...> --json
```

Categories: `trending`, `top-traded`, `top-organic`, `recent`, `lst`, `verified`.

### Transfer (2-step: prepare → confirm)

```bash
# SOL: prepare intent (read-only, no key access)
echoclaw solana send prepare --to <address> --amount <SOL> [--note <text>] --json
# SOL: confirm and broadcast (requires --yes + password)
echoclaw solana send confirm <intentId> --yes --json

# SPL token: prepare intent
echoclaw solana send-token prepare --to <address> --token <symbol_or_mint> --amount <n> --json
# SPL token: confirm and broadcast
echoclaw solana send-token confirm <intentId> --yes --json
```

Prepare creates a time-limited intent (10min TTL). Confirm requires `--yes` + decrypts keystore. Same security model as 0G transfers.

### Staking

```bash
echoclaw solana stake list --json
echoclaw solana stake delegate --amount <SOL> [--validator <vote-address>] --yes --json
echoclaw solana stake withdraw <stake-account> [--amount <SOL>] --yes --json
echoclaw solana stake claim-mev [stake-account] --yes --json
```

Default validator: Solana Compass. MEV claim withdraws only excess tips, not principal.

### DCA (Dollar-Cost Averaging)

```bash
echoclaw solana dca create <amount-per-cycle> <from> <to> --every <interval> --count <n> --yes --json
echoclaw solana dca list --json
echoclaw solana dca cancel <orderKey> --yes --json
```

Intervals: `minute`, `hour`, `day`, `week`, `month`. Uses Jupiter Recurring API.

### Limit Orders

```bash
echoclaw solana limit create <amount> <from> <to> --at <target-price-usd> --yes --json
echoclaw solana limit list --json
echoclaw solana limit cancel <orderKey> --yes --json
```

`--at` is the target USD price for the output token. Uses Jupiter Trigger V1 API.

### Lending

```bash
echoclaw solana lend rates [token] --json
echoclaw solana lend positions --json
echoclaw solana lend deposit <token> --amount <n> --yes --json
echoclaw solana lend withdraw <token> --amount <n> --yes --json
```

Jupiter Lend Earn. Rates include `supplyRate` and `totalRate` (supply + rewards).

### Portfolio & Holdings

```bash
echoclaw solana portfolio --json
echoclaw solana holdings --json
```

`portfolio` uses Ultra holdings API (token balances with account details). For cross-chain portfolio use `echoclaw wallet balances --wallet solana` (Khalani).

### Prediction Markets

```bash
echoclaw solana predict list [category] [--filter trending|live|new] --json
echoclaw solana predict search <query> --json
echoclaw solana predict market <marketId> --json
echoclaw solana predict buy <marketId> --side yes|no --amount <USDC> --yes --json
echoclaw solana predict sell <positionPubkey> --yes --json
echoclaw solana predict claim <positionPubkey> --yes --json
echoclaw solana predict positions --json
```

Categories: `crypto`, `sports`, `politics`, `culture`, `economics`, `tech` etc.

### Token Security

```bash
echoclaw solana shield <mint...> --json
```

Returns security warnings per token: `NOT_VERIFIED`, `LOW_LIQUIDITY`, `HAS_MINT_AUTHORITY`, `HAS_FREEZE_AUTHORITY`, etc. Severity: `info`, `warning`, `critical`.

### Token Creation (Studio)

```bash
echoclaw solana studio create --name <n> --symbol <s> --image <path> --initial-mcap <usd> --migration-mcap <usd> [--fee-bps <n>] [--lock-lp] --yes --json
echoclaw solana studio fees <mint> --json
echoclaw solana studio claim-fees <pool> --yes --json
```

Requires Jupiter API key. Creates tokens with Dynamic Bonding Curves on Jupiter.

### Send via Invite

```bash
echoclaw solana send-invite --amount <n> [--token <mint>] --yes --json
echoclaw solana invites --json
echoclaw solana clawback <invite-code> --yes --json
```

Recipients claim via Jupiter Mobile. Unclaimed invites can be clawed back.

### Account Management

```bash
echoclaw solana burn <token> [amount] [--all] --yes --json
echoclaw solana close-accounts --yes --json
```

`close-accounts` closes all empty SPL token accounts and reclaims rent (~0.002 SOL each).

## Execution model

- all read commands (`browse`, `price`, `list`, `rates`, `positions`, `portfolio`, `holdings`, `shield`, `invites`) are safe and idempotent
- all write commands (`execute`, `send`, `deposit`, `withdraw`, `create`, `cancel`, `buy`, `sell`, `claim`, `burn`, `close-accounts`, `delegate`, `clawback`) require `--yes`
- without `--yes`, write commands show a preview and exit with `CONFIRMATION_REQUIRED`
- `--json` routes all UI to stderr, structured output to stdout
- cluster warning appears on write commands when not on `mainnet-beta`

## Agent-safe flow

1. `echoclaw wallet ensure --json` — verify Solana wallet exists
2. `echoclaw config show --json` — check Solana cluster and Jupiter key
3. Read command (browse, price, rates, etc.) — gather information
4. Write command with `--yes --json` — execute action
5. Parse JSON response for `signature` and `explorerUrl`

## Success examples

Swap quote:

```json
{
  "ok": true,
  "data": {
    "inputToken": "SOL",
    "outputToken": "USDC",
    "inputAmount": "1",
    "outputAmount": "150.25",
    "priceImpactPct": "0.01",
    "route": ["Raydium"],
    "provider": "jupiter-ultra (iris)"
  }
}
```

Swap execute:

```json
{
  "ok": true,
  "data": {
    "signature": "4xK9...abc",
    "explorerUrl": "https://explorer.solana.com/tx/4xK9...abc",
    "inputAmount": "1",
    "outputAmount": "150.25"
  }
}
```

Transfer:

```json
{
  "ok": true,
  "data": {
    "signature": "5aB...xyz",
    "explorerUrl": "https://explorer.solana.com/tx/5aB...xyz",
    "from": "7nY...abc",
    "to": "GkX...def",
    "amount": 2,
    "token": "SOL"
  }
}
```

## Khalani overlap — what NOT to duplicate

These are already handled by Khalani and should not be reimplemented via Jupiter:

- **SOL balance**: `echoclaw wallet balances --wallet solana`
- **SPL token balances with USD**: `echoclaw wallet balances --wallet solana`
- **Token search/info**: `echoclaw khalani tokens search <query>`
- **Cross-chain bridge**: `echoclaw khalani bridge ...`

Use Solana commands for Solana-native operations (swap, stake, lend, predict). Use Khalani for cross-chain operations and balance aggregation.

## Error codes

- `SOLANA_INVALID_ADDRESS`
- `SOLANA_INSUFFICIENT_BALANCE`
- `SOLANA_TRANSFER_FAILED`
- `SOLANA_TX_FAILED`
- `SOLANA_TX_TIMEOUT`
- `SOLANA_TOKEN_NOT_FOUND`
- `SOLANA_RPC_ERROR`
- `SOLANA_QUOTE_FAILED`
- `SOLANA_SWAP_FAILED`
- `SOLANA_STAKE_FAILED`
- `SOLANA_ORDER_FAILED`
- `SOLANA_PORTFOLIO_FAILED`
- `SOLANA_LEND_DEPOSIT_FAILED`
- `SOLANA_LEND_WITHDRAW_FAILED`
- `SOLANA_LEND_RATES_FAILED`
- `SOLANA_SEND_INVITE_FAILED`
- `SOLANA_SEND_CLAWBACK_FAILED`
- `SOLANA_PREDICT_ORDER_FAILED`
- `SOLANA_PREDICT_CLAIM_FAILED`
- `SOLANA_STUDIO_CREATE_FAILED` (requires Jupiter API key)
- `SOLANA_STUDIO_CLAIM_FAILED` (requires Jupiter API key)
- `SOLANA_LP_POOL_NOT_FOUND`
- `SOLANA_LP_DEPOSIT_FAILED`
- `SOLANA_LP_WITHDRAW_FAILED`
- `SOLANA_LP_CLAIM_FAILED`
- `CONFIRMATION_REQUIRED` (add `--yes` to execute)
