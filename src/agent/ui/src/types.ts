/** Agent UI types — mirrors backend types.ts */

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

export interface UsageState {
  sessionTokens: number;
  sessionCost: number;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
  lastBackupAt: string | null;
}

export interface LoopState {
  active: boolean;
  mode: "full" | "restricted";
  intervalMs: number;
  startedAt: string | null;
  lastCycleAt: string | null;
  cycleCount: number;
}

export interface ApprovalItem {
  id: string;
  toolCall: { command: string; args: Record<string, unknown>; confirm: boolean };
  reasoning: string;
  estimatedCost: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
}

export interface SessionListEntry {
  id: string;
  startedAt: string;
  sizeBytes: number;
}

export interface FileTreeEntry {
  name: string;
  type: "file" | "dir";
  path: string;
  sizeBytes?: number;
}

// ── Trade tracking ───────────────────────────────────────────────────

export type TradeType = "swap" | "prediction" | "bonding" | "bridge" | "lp" | "stake" | "lend";

export interface TradeEntry {
  id: string;
  timestamp: string;
  type: TradeType;
  chain: string;
  status: string;
  input: { token: string; amount: string; valueUsd?: number };
  output: { token: string; amount: string; valueUsd?: number };
  pnl?: { amountUsd: number; percentChange: number; realized: boolean };
  meta: Record<string, unknown>;
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

// ── Scheduled tasks ──────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  taskType: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  loopMode: string;
  lastRunAt: string | null;
  runCount: number;
  lastResult: Record<string, unknown> | null;
  createdAt: string;
}

// ── Portfolio ────────────────────────────────────────────────────────

export interface PortfolioSnapshot {
  id: number;
  timestamp: string;
  totalUsd: number;
  positions: Array<{ chain: string; token: string; symbol: string; amount: string; usdValue: number }>;
  activeChains: string[];
  pnlVsPrev: number | null;
  pnlPctVsPrev: number | null;
}

export interface ChainBalance {
  chain: string;
  tradeCount: number;
  totalUsd: number;
  tokens: Array<{ token: string; symbol: string; amount: string; usdValue: number }>;
}

// ── Billing ──────────────────────────────────────────────────────────

export interface BillingState {
  ledgerTotalOg: number;
  ledgerAvailableOg: number;
  providerLockedOg: number;
  sessionBurnOg: number;
  lifetimeBurnOg: number;
  avgCostPerRequest: number;
  estimatedRequestsRemaining: number;
  lowBalanceThreshold: number;
  isLowBalance: boolean;
  model: string;
  pricing: { inputPerM: string; outputPerM: string };
  fetchedAt: string;
}

// ── Tool calls (shared by hooks + components) ──────────────────────

export interface ToolCallState {
  id: string;
  command: string;
  args: Record<string, unknown>;
  status: "running" | "success" | "error";
  output?: string;
  durationMs?: number;
}

export interface FileUpdateState {
  id: string;
  path: string;
  action: string;
  timestamp: string;
}

export type AssistantActivityItem =
  | {
    id: string;
    kind: "tool";
    order: number;
    timestamp: string;
    tool: ToolCallState;
  }
  | {
    id: string;
    kind: "file";
    order: number;
    timestamp: string;
    file: FileUpdateState;
  };

export interface AssistantTurn {
  id: string;
  content: string;
  timestamp: string;
  activities: AssistantActivityItem[];
}

export type ChatFeedItem =
  | {
    id: string;
    kind: "message";
    message: ChatMessage;
  }
  | {
    id: string;
    kind: "assistant_turn";
    turn: AssistantTurn;
  };

// ── Telegram ────────────────────────────────────────────────────────

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  botUsername: string | null;
  authorizedChatIds: number[];
  loopMode: string;
  decryptionFailed?: boolean;
}

/** SSE event from agent chat endpoint */
export type AgentEventType =
  | "status" | "text_delta" | "tool_start" | "tool_result"
  | "approval_required" | "file_update" | "usage" | "balance_low" | "error" | "done";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  toolCommand?: string;
  toolSuccess?: boolean;
}
