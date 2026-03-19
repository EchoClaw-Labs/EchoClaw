/**
 * Core types for the Echo Agent.
 * Shared between server, engine, handlers, and UI API layer.
 */

// ── Tool calling ─────────────────────────────────────────────────────

export interface ToolCall {
  /** CLI command (e.g. "wallet balance", "jaine swap sell"). */
  command: string;
  /** CLI arguments as key-value pairs (e.g. {"--amount": "1.0"}). */
  args: Record<string, string | boolean | number>;
  /** Whether this mutation requires user approval in restricted mode. */
  confirm: boolean;
}

export interface ToolResult {
  id: string;
  command: string;
  success: boolean;
  output: string;
  durationMs: number;
}

// ── Internal tools (file ops, memory updates) ────────────────────────

export type InternalToolType =
  | "web_search" | "web_fetch"
  | "file_read" | "file_write" | "file_list" | "file_delete"
  | "memory_update" | "trade_log"
  | "schedule_create" | "schedule_remove";

export interface InternalToolCall {
  type: InternalToolType;
  params: Record<string, string>;
}

// ── Messages ─────────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  /** For tool results: links back to the tool call. */
  toolCallId?: string;
  /** For assistant messages: tool calls made in this message (for round-trip). */
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  /** Timestamp of when message was created. */
  timestamp: string;
}

// ── Conversation session (isolated per request chain) ────────────────

export interface ConversationSession {
  id: string;
  messages: Message[];
  loadedKnowledge: Map<string, string>;
  inferenceConfig: InferenceConfig;
  /** Real prompt_tokens from last inference (used for hybrid compaction budget). */
  lastPromptTokens?: number;
  /** messages.length at the time lastPromptTokens was recorded. */
  messageCountAtSnapshot?: number;
}

// ── Session ──────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  startedAt: string;
  messageCount: number;
  tokenCount: number;
  compacted: boolean;
}

// ── SSE events ───────────────────────────────────────────────────────

export type AgentEventType =
  | "status"
  | "text_delta"
  | "tool_start"
  | "tool_result"
  | "approval_required"
  | "file_update"
  | "usage"
  | "balance_low"
  | "error"
  | "done";

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
}

// ── Usage tracking ───────────────────────────────────────────────────

export interface RequestUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costOg: number;
}

export interface UsageState {
  sessionTokens: number;
  sessionCost: number;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
  lastBackupAt: string | null;
}

// ── Loop ─────────────────────────────────────────────────────────────

export type LoopMode = "full" | "restricted";

export interface LoopState {
  active: boolean;
  mode: LoopMode;
  intervalMs: number;
  startedAt: string | null;
  lastCycleAt: string | null;
  cycleCount: number;
}

// ── Approval queue ───────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalItem {
  id: string;
  toolCall: ToolCall;
  reasoning: string;
  estimatedCost: string | null;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

// ── Agent status ─────────────────────────────────────────────────────

export interface AgentStatus {
  running: boolean;
  model: string | null;
  provider: string | null;
  hasSoul: boolean;
  memorySize: number;
  knowledgeFileCount: number;
  sessionId: string | null;
  sessionMessageCount: number;
  usage: UsageState;
  loop: LoopState;
  pendingApprovals: number;
}

// ── Trade tracking ───────────────────────────────────────────────────

export type TradeType = "swap" | "prediction" | "bonding" | "bridge" | "lp" | "stake" | "lend";
export type TradeStatus = "executed" | "pending" | "failed" | "open" | "closed" | "claimed";

export interface TradeEntry {
  id: string;
  timestamp: string;
  type: TradeType;
  chain: string;
  status: TradeStatus;
  input: { token: string; amount: string; valueUsd?: number };
  output: { token: string; amount: string; valueUsd?: number };
  pnl?: { amountUsd: number; percentChange: number; realized: boolean };
  meta: {
    dex?: string;
    slippageBps?: number;
    priceImpact?: string;
    marketId?: string;
    marketTitle?: string;
    side?: "yes" | "no";
    contracts?: number;
    positionPubkey?: string;
    buyPrice?: number;
    currentPrice?: number;
    bondingToken?: string;
    bondingProgress?: string;
    sourceChain?: string;
    destChain?: string;
    routeId?: string;
    poolId?: string;
    tickRange?: string;
  };
  reasoning?: string;
  signature?: string;
  explorerUrl?: string;
}

export interface TradeSummary {
  totalPnlUsd: number;
  winCount: number;
  lossCount: number;
  totalTrades: number;
  winRate: number;
  byType: Record<string, number>;
}

// ── OpenAI function calling ──────────────────────────────────────────

/** JSON Schema subset for tool parameter definitions. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
  }>;
  required?: string[];
}

/** Parsed tool call from model output (OpenAI-compatible). */
export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Structured inference response — content XOR toolCalls. */
export interface InferenceResponse {
  content: string | null;
  toolCalls: ParsedToolCall[] | null;
  usage: { promptTokens: number; completionTokens: number };
}

// ── Inference ────────────────────────────────────────────────────────

export interface InferenceConfig {
  provider: string;
  model: string;
  endpoint: string;
  contextLimit: number;
  /** Price per 1M input tokens in 0G (from provider metadata). */
  inputPricePerM: number;
  /** Price per 1M output tokens in 0G (from provider metadata). */
  outputPricePerM: number;
  /** Recommended minimum locked balance in 0G. */
  recommendedMinLockedOg: number;
  /** Alert threshold (recommendedMin * 1.2). */
  alertThresholdOg: number;
}

export interface LedgerBalance {
  ledgerTotalOg: number;
  ledgerAvailableOg: number;
  providerLockedOg: number;
  providerPendingRefundOg: number;
  fetchedAt: string;
}

export interface StreamChunk {
  content: string | null;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}
