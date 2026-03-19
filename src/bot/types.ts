/**
 * Bot types for real-time trading daemon.
 * TokenUpdate shape matches slop-backend ranking/types.ts (canonical).
 */

import type { Address, Hex } from "viem";

// ── Token WS payloads ──────────────────────────────────────────────

export interface LastTrade {
  tx_hash: string;
  tx_type: "buy" | "sell";
  wallet_address: string;
  amount_og: number;
  amount_token: number;
  price_per_token: number;
  timestamp_ms: number;
  trader_username?: string;
  trader_avatar?: string;
}

export interface HolderUpdate {
  wallet_address: string;
  token_amount: number;
  og_invested: number;
  avg_buy_price: number;
  total_buys: number;
  total_sells: number;
  is_active: boolean;
  holder_username?: string;
  holder_avatar?: string;
  action: "added" | "updated" | "removed";
}

export interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * TokenUpdate from WS `token_update` event.
 * Matches slop-backend TokenUpdate interface.
 */
export interface TokenUpdatePayload {
  address: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creatorAddress: string;
  creatorName?: string;
  creatorAvatar?: string;
  createdAt: number;
  price: number;
  marketCap: number;
  priceChange24h: number;
  volume24h: number;
  holders: number;
  bondingProgress: number;
  status: "active" | "graduated" | "rugged";
  liquidity: number;
  trades24h: number;
  totalSupply: number;
  change5m?: number;
  change1h?: number;
  change6h?: number;
  change24h?: number;
  txns24h?: number;
  buys24h?: number;
  sells24h?: number;
  ranks: Record<string, number | null>;
  dexPoolAddress?: string;
  lastTrade?: LastTrade;
  holderUpdate?: HolderUpdate;
  ohlcUpdate?: Record<string, OHLCCandle>;
}

/**
 * token_snapshot payload — wraps TokenUpdatePayload-like DB row data.
 * Backend sends { type: "token_snapshot", data: {...}, timestamp }
 */
export interface TokenSnapshotPayload {
  type: "token_snapshot";
  data: Record<string, unknown> & {
    address: string;
    actual_price?: number;
    market_cap?: number;
    bonding_progress?: number;
    status?: string;
    holders_count?: number;
    volume_24h?: number;
    trades_24h?: number;
    last_trade?: LastTrade;
  };
  timestamp: number;
}

// ── Trigger types ──────────────────────────────────────────────────

export type TriggerType =
  | "onNewBuy"
  | "onNewSell"
  | "priceAbove"
  | "priceBelow"
  | "bondingProgressAbove";

export interface TriggerOnNewBuy {
  type: "onNewBuy";
  ignoreWallet?: Address;
  minAmountOg?: number;
}

export interface TriggerOnNewSell {
  type: "onNewSell";
  ignoreWallet?: Address;
  minAmountOg?: number;
}

export interface TriggerPriceAbove {
  type: "priceAbove";
  threshold: number;
}

export interface TriggerPriceBelow {
  type: "priceBelow";
  threshold: number;
}

export interface TriggerBondingProgressAbove {
  type: "bondingProgressAbove";
  threshold: number;
}

export type Trigger =
  | TriggerOnNewBuy
  | TriggerOnNewSell
  | TriggerPriceAbove
  | TriggerPriceBelow
  | TriggerBondingProgressAbove;

// ── Order types ────────────────────────────────────────────────────

export type OrderState = "armed" | "executing" | "filled" | "failed" | "cancelled" | "disarmed";

export type SizeSpec =
  | { mode: "absolute"; amountOg: string }
  | { mode: "percent"; percent: number }
  | { mode: "absoluteTokens"; amountTokens: string }
  | { mode: "all" };

export interface BotOrder {
  id: string;
  token: Address;
  side: "buy" | "sell";
  trigger: Trigger;
  size: SizeSpec;
  slippageBps: number;
  cooldownMs: number;
  state: OrderState;
  createdAt: number;
  filledAt?: number;
  filledTxHash?: string;
  failReason?: string;
  lastProcessedTxHash?: string;
}

// ── Orders file ────────────────────────────────────────────────────

export interface BotOrdersFile {
  version: 1;
  orders: BotOrder[];
}

// ── Guardrails ─────────────────────────────────────────────────────

export interface BotGuardrails {
  maxSlippageBps: number;
}

export const DEFAULT_GUARDRAILS: BotGuardrails = {
  maxSlippageBps: 500,
};

// ── State ──────────────────────────────────────────────────────────

export interface ExecutionEvent {
  orderId: string;
  token: Address;
  side: "buy" | "sell";
  triggerType: TriggerType;
  txHash?: Hex;
  explorerUrl?: string;
  amountOg?: string;
  amountTokens?: string;
  status: "filled" | "failed";
  failReason?: string;
  timestamp: number;
}

export interface BotStateFile {
  version: 1;
  executionLog: ExecutionEvent[];
  dailySpend: {
    date: string;
    ogSpent: number;
  };
  hourlyTxCount: {
    hour: number;
    count: number;
  };
}

// ── Notification ───────────────────────────────────────────────────

export interface BotNotification {
  type: "BUY_FILLED" | "SELL_FILLED" | "TRADE_FAILED" | "GUARDRAIL_EXCEEDED" | "BOT_STARTED" | "BOT_STOPPED";
  orderId?: string;
  token?: string;
  tokenSymbol?: string;
  side?: "buy" | "sell";
  amountTokens?: string;
  amountOg?: string;
  txHash?: string;
  explorerUrl?: string;
  trigger?: Record<string, unknown>;
  failReason?: string;
  timestamp: number;
}
