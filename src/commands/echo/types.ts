import type { ProviderName, SkillInstallResult } from "../../providers/types.js";
import type { EchoSnapshot } from "./state.js";
import type { EchoWorkflowPayload } from "./protocol.js";

export type EchoTask = "connect" | "fund" | "bridge" | "explore" | "wallet" | "manage" | "advanced" | "exit";
export type EchoScope = "user" | "project";
export type ClaudeSettingsScope = "project-local" | "project-shared" | "user";

export interface LauncherItem {
  id: string;
  title: string;
  badge: string;
  description: string;
  command: string;
}

export interface FundView {
  walletBalanceOg: number;
  ledgerAvailableOg: number;
  ledgerReservedOg: number;
  ledgerTotalOg: number;
  provider: string | null;
  model: string | null;
  inputPricePerMTokens: string | null;
  outputPricePerMTokens: string | null;
  recommendedMinLockedOg: number | null;
  currentLockedOg: number | null;
  subAccountExists: boolean;
  acknowledged: boolean | null;
  monitorRunning: boolean;
  monitorTrackingProvider: boolean;
  requiresApiKeyRotation: boolean;
  selectionWarning: string | null;
  refreshedAt: string;
}

export interface ComputeIssue {
  nextAction: string;
  reasonCode: string;
  summary: string;
  hint?: string;
}

export interface ConnectApplyOptions {
  runtime: ProviderName;
  scope: EchoScope;
  force: boolean;
  allowWalletMutation: boolean;
  claudeScope: ClaudeSettingsScope;
  startProxy: boolean;
}

export interface ConnectApplyResult {
  payload: EchoWorkflowPayload;
  snapshot: EchoSnapshot;
  appliedActions: string[];
  warnings: string[];
  skill: SkillInstallResult;
  createdWalletAddress: string | null;
}

export interface FundApplyOptions {
  provider?: string;
  amount?: string;
  deposit?: string;
  tokenId?: string;
  fresh?: boolean;
  ack?: boolean;
  emitSecrets?: boolean;
  saveClaudeToken?: boolean;
  runtime?: string;
}
