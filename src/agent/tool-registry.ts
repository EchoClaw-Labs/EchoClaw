/**
 * Tool registry — single source of truth for all agent tools.
 *
 * CLI tools use a single `args` string parameter — the model constructs
 * full CLI arguments from SKILL.md reference docs it reads every prompt.
 *
 * Internal tools use structured parameters — engine parses them directly.
 *
 * NAMING CONVENTION for CLI tools:
 *   `_` = space separator (executor replaces _ with space)
 *   `-` = hyphen in subcommand name (preserved by executor)
 *   Example: `jaine_pools_scan-core` → `echoclaw jaine pools scan-core`
 *   Example: `0g-compute_ledger_deposit` → `echoclaw 0g-compute ledger deposit`
 */

import type { JsonSchema } from "./types.js";

// ── Tool definition ─────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  kind: "internal" | "cli";
  mutating: boolean;
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

// ── Shared parameter schema for CLI tools ───────────────────────────

const CLI_PARAMS: JsonSchema = {
  type: "object",
  properties: {
    args: { type: "string", description: "Raw CLI arguments including all flags (--yes, --json, etc.)" },
  },
  required: ["args"],
};

// ── Internal tools (structured params, handled by engine) ───────────

const INTERNAL: ToolDef[] = [
  { name: "web_search", kind: "internal", mutating: false, description: "Search the web via Tavily",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "web_fetch", kind: "internal", mutating: false, description: "Fetch a URL as markdown",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "file_read", kind: "internal", mutating: false, description: "Load a knowledge/skill file into context",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "file_write", kind: "internal", mutating: false, description: "Create or update a knowledge file",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "file_list", kind: "internal", mutating: false, description: "List files in a knowledge directory",
    parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "file_delete", kind: "internal", mutating: false, description: "Delete a knowledge file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "memory_update", kind: "internal", mutating: false, description: "Append to persistent memory",
    parameters: { type: "object", properties: { append: { type: "string" } }, required: ["append"] } },
  { name: "trade_log", kind: "internal", mutating: false, description: "Log a trade entry",
    parameters: { type: "object", properties: { trade: { type: "string" } }, required: ["trade"] } },
  { name: "schedule_create", kind: "internal", mutating: false, description: "Create a recurring cron task",
    parameters: { type: "object", properties: {
      name: { type: "string" }, cron: { type: "string" },
      type: { type: "string", enum: ["cli_execute", "inference", "alert", "snapshot", "backup"] },
      description: { type: "string" }, payload: { type: "string" }, loopMode: { type: "string" },
    }, required: ["name", "cron", "type"] } },
  { name: "schedule_remove", kind: "internal", mutating: false, description: "Remove a scheduled task",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];

// ── CLI tools (raw args, spawned via executor) ──────────────────────
// NAMING: _ = space, - = hyphen preserved. See file header comment.

const cli = (name: string, description: string, mutating: boolean): ToolDef =>
  ({ name, description, kind: "cli", mutating, parameters: CLI_PARAMS });

const CLI: ToolDef[] = [
  // ── Wallet & config (references/wallet-transfers.md)
  cli("wallet_balance", "Check native 0G balance", false),
  cli("wallet_address", "Show wallet address", false),
  cli("wallet_balances", "Multi-chain token balances via Khalani", false),
  cli("wallet_create", "Create a new wallet", true),
  cli("wallet_import", "Import wallet from private key", true),
  cli("wallet_ensure", "Idempotent wallet readiness check", false),
  cli("wallet_backup", "Backup wallet", false),

  // ── 0G native transfers (2-step)
  cli("send_prepare", "Prepare 0G native transfer intent", false),
  cli("send_confirm", "Confirm and broadcast 0G transfer", true),

  // ── Solana transfers (2-step, references/wallet-transfers.md + solana-jupiter.md)
  cli("solana_send_prepare", "Prepare SOL transfer intent", false),
  cli("solana_send_confirm", "Confirm SOL transfer", true),
  cli("solana_send-token_prepare", "Prepare SPL token transfer intent", false),
  cli("solana_send-token_confirm", "Confirm SPL token transfer", true),

  // ── Solana DeFi — Jupiter (references/solana/solana-jupiter.md)
  cli("solana_swap_quote", "Quote a Jupiter swap", false),
  cli("solana_swap_execute", "Execute a Jupiter swap", true),
  cli("solana_browse", "Browse trending/top Solana tokens", false),
  cli("solana_price", "Get token prices", false),
  cli("solana_portfolio", "Solana portfolio holdings", false),
  cli("solana_holdings", "Solana token holdings", false),
  cli("solana_shield", "Token security check", false),

  // ── Solana staking
  cli("solana_stake_list", "List stake accounts", false),
  cli("solana_stake_delegate", "Delegate SOL to validator", true),
  cli("solana_stake_withdraw", "Withdraw staked SOL", true),
  cli("solana_stake_claim-mev", "Claim MEV rewards", true),

  // ── Solana DCA
  cli("solana_dca_create", "Create DCA order", true),
  cli("solana_dca_list", "List DCA orders", false),
  cli("solana_dca_cancel", "Cancel DCA order", true),

  // ── Solana limit orders
  cli("solana_limit_create", "Create limit order", true),
  cli("solana_limit_list", "List limit orders", false),
  cli("solana_limit_cancel", "Cancel limit order", true),

  // ── Solana lending
  cli("solana_lend_rates", "Lending rates", false),
  cli("solana_lend_positions", "Lending positions", false),
  cli("solana_lend_deposit", "Deposit to lending", true),
  cli("solana_lend_withdraw", "Withdraw from lending", true),

  // ── Solana prediction markets
  cli("solana_predict_list", "List prediction events", false),
  cli("solana_predict_search", "Search prediction events", false),
  cli("solana_predict_market", "Get market details", false),
  cli("solana_predict_buy", "Buy prediction position", true),
  cli("solana_predict_sell", "Sell prediction position", true),
  cli("solana_predict_claim", "Claim prediction winnings", true),
  cli("solana_predict_positions", "List open prediction positions", false),

  // ── Solana account management
  cli("solana_burn", "Burn SPL tokens", true),
  cli("solana_close-accounts", "Close empty token accounts", true),

  // ── Solana Studio
  cli("solana_studio_create", "Create token via Jupiter Studio", true),
  cli("solana_studio_fees", "Check Studio fees", false),
  cli("solana_studio_claim-fees", "Claim Studio fees", true),

  // ── Solana Send via Invite
  cli("solana_send-invite", "Send via invite code", true),
  cli("solana_invites", "List invites", false),
  cli("solana_clawback", "Clawback unclaimed invite", true),

  // ── Khalani cross-chain (references/khalani-cross-chain.md)
  cli("khalani_chains", "List supported chains", false),
  cli("khalani_tokens_top", "Top tokens", false),
  cli("khalani_tokens_search", "Search tokens", false),
  cli("khalani_tokens_balances", "Cross-chain token balances", false),
  cli("khalani_quote", "Bridge quote", false),
  cli("khalani_bridge", "Execute cross-chain bridge", true),
  cli("khalani_orders", "List bridge orders", false),
  cli("khalani_order", "Get bridge order details", false),

  // ── Jaine DEX (references/0g/jaine-dex.md)
  cli("jaine_tokens_list", "List token aliases", false),
  cli("jaine_tokens_add-alias", "Add token alias", false),
  cli("jaine_tokens_remove-alias", "Remove token alias", false),
  cli("jaine_pools_scan-core", "Refresh pool cache", false),
  cli("jaine_pools_for-token", "Pools for token", false),
  cli("jaine_pools_find", "Find pool route", false),
  cli("jaine_w0g_balance", "w0G balance", false),
  cli("jaine_w0g_wrap", "Wrap 0G to w0G", true),
  cli("jaine_w0g_unwrap", "Unwrap w0G to 0G", true),
  cli("jaine_allowance_show", "Check token allowance", false),
  cli("jaine_allowance_revoke", "Revoke token allowance", true),
  cli("jaine_swap_sell", "Sell swap on Jaine", true),
  cli("jaine_swap_buy", "Buy swap on Jaine", true),
  cli("jaine_lp_list", "List LP positions", false),
  cli("jaine_lp_show", "Show LP position details", false),
  cli("jaine_lp_add", "Add liquidity", true),
  cli("jaine_lp_increase", "Increase liquidity", true),
  cli("jaine_lp_collect", "Collect LP fees", true),
  cli("jaine_lp_remove", "Remove liquidity", true),
  cli("jaine_lp_rebalance", "Rebalance LP position", true),

  // ── Jaine Subgraph (references/0g/jaine-subgraph.md)
  cli("jaine_subgraph_meta", "Subgraph health and metadata", false),
  cli("jaine_subgraph_pools_top", "Top pools by TVL", false),
  cli("jaine_subgraph_pools_newest", "Newest pools", false),
  cli("jaine_subgraph_pools_for-token", "Pools for a specific token", false),
  cli("jaine_subgraph_pools_for-pair", "Pools for a token pair", false),
  cli("jaine_subgraph_pool_info", "Single pool info", false),
  cli("jaine_subgraph_pool_days", "Pool daily data", false),
  cli("jaine_subgraph_pool_hours", "Pool hourly data", false),
  cli("jaine_subgraph_swaps", "Recent swaps for a pool", false),
  cli("jaine_subgraph_lp_mints", "LP mint events", false),
  cli("jaine_subgraph_lp_burns", "LP burn events", false),
  cli("jaine_subgraph_lp_collects", "LP collect events", false),
  cli("jaine_subgraph_dex-stats", "DEX-wide statistics", false),
  cli("jaine_subgraph_token", "Token info from subgraph", false),
  cli("jaine_subgraph_top-tokens", "Top tokens by TVL or volume", false),

  // ── Slop bonding curve (references/0g/slop-bonding.md)
  cli("slop_token_create", "Create bonding curve token", true),
  cli("slop_token_info", "Token info", false),
  cli("slop_tokens_mine", "My created tokens", false),
  cli("slop_trade_buy", "Buy on bonding curve", true),
  cli("slop_trade_sell", "Sell on bonding curve", true),
  cli("slop_price", "Token price", false),
  cli("slop_curve", "Curve state", false),
  cli("slop_fees_stats", "Fee statistics", false),
  cli("slop_fees_claim-creator", "Claim creator fees", true),
  cli("slop_fees_lp_pending", "Pending LP fees", false),
  cli("slop_fees_lp_collect", "Collect LP fees", true),
  cli("slop_reward_pending", "Pending creator reward", false),
  cli("slop_reward_claim", "Claim creator reward", true),

  // ── 0G Compute (references/0g/0g-compute.md)
  cli("0g-compute_providers", "List compute providers", false),
  cli("0g-compute_ledger_status", "Ledger balance", false),
  cli("0g-compute_ledger_deposit", "Deposit to ledger", true),
  cli("0g-compute_ledger_fund", "Fund provider sub-account", true),
  cli("0g-compute_provider_ack", "Acknowledge provider", true),
  cli("0g-compute_api-key_create", "Create API key", true),
  cli("0g-compute_api-key_revoke", "Revoke API key", true),
  cli("0g-compute_api-key_revoke-all", "Revoke all API keys", true),

  // ── 0G Storage (references/0g/0g-storage.md)
  cli("0g-storage_file_upload", "Upload file to 0G storage", true),
  cli("0g-storage_file_download", "Download file from 0G storage", false),
  cli("0g-storage_file_info", "File info from storage nodes", false),
  cli("0g-storage_drive_put", "Put file in drive", true),
  cli("0g-storage_drive_get", "Download from drive", false),
  cli("0g-storage_drive_ls", "List drive directory", false),
  cli("0g-storage_drive_snapshot", "Snapshot drive to 0G", true),
  cli("0g-storage_note_put", "Store a note", true),
  cli("0g-storage_note_list", "List notes", false),
  cli("0g-storage_note_get", "Get a note", false),
  cli("0g-storage_backup_push", "Push backup to 0G", true),

  // ── EchoBook social (references/echobook.md)
  cli("echobook_auth_login", "Login to EchoBook", true),
  cli("echobook_posts_feed", "Browse post feed", false),
  cli("echobook_posts_create", "Create a post", true),
  cli("echobook_posts_search", "Search posts", false),
  cli("echobook_comments_create", "Comment on a post", true),
  cli("echobook_vote", "Vote on post or comment", true),
  cli("echobook_follow", "Follow/unfollow user", true),
  cli("echobook_repost", "Repost", true),
  cli("echobook_trade-proof_submit", "Submit trade proof", true),
  cli("echobook_trade-proof_get", "Get trade proof", false),
  cli("echobook_verify-owner_request", "Request ownership verification", true),

  // ── Slop app (references/0g/slop-app.md)
  cli("slop-app_image_generate", "Generate image", true),
  cli("slop-app_image_upload", "Upload image", true),
  cli("slop-app_chat_post", "Post to chat", true),
  cli("slop-app_chat_read", "Read chat messages", false),
  cli("slop-app_agents_trending", "Trending tokens", false),
  cli("slop-app_agents_newest", "Newest tokens", false),
  cli("slop-app_agents_search", "Search tokens", false),
  cli("slop-app_agents_query", "Structured token query", false),

  // ── MarketMaker (references/0g/marketmaker.md)
  cli("marketmaker_order_add", "Create market maker order", true),
  cli("marketmaker_order_list", "List orders", false),
  cli("marketmaker_order_show", "Show order details", false),
  cli("marketmaker_order_update", "Update order settings", true),
  cli("marketmaker_order_remove", "Remove order", true),
  cli("marketmaker_order_arm", "Arm order", true),
  cli("marketmaker_order_disarm", "Disarm order", true),
  cli("marketmaker_start", "Start market maker daemon", true),
  cli("marketmaker_stop", "Stop market maker daemon", true),
  cli("marketmaker_status", "Market maker status", false),
];

// ── Registry API ────────────────────────────────────────────────────

export const TOOLS: readonly ToolDef[] = [...INTERNAL, ...CLI];

const byName = new Map<string, ToolDef>(TOOLS.map(t => [t.name, t]));

export function getToolDef(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function isInternal(name: string): boolean {
  return byName.get(name)?.kind === "internal";
}

export function isMutating(name: string): boolean {
  return byName.get(name)?.mutating === true;
}

export function toOpenAITools(): OpenAITool[] {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
