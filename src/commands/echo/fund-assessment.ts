import { autoDetectProvider } from "../../providers/registry.js";
import type { ProviderName } from "../../providers/types.js";
import { ErrorCodes } from "../../errors.js";
import type { FundView } from "./types.js";
import type { EchoWorkflowPayload } from "./protocol.js";

export function buildFundPayload(view: FundView, runtimeHint?: ProviderName): EchoWorkflowPayload {
  const runtime = runtimeHint ?? autoDetectProvider().name;
  const warnings: string[] = [];
  if (view.recommendedMinLockedOg != null && view.currentLockedOg != null && view.currentLockedOg < view.recommendedMinLockedOg) {
    warnings.push(
      `Provider locked balance is ${view.currentLockedOg.toFixed(3)} 0G, below the recommended ${view.recommendedMinLockedOg.toFixed(3)} 0G.`,
    );
  }

  if (!view.provider) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "Select a provider/model first.",
      nextAction: "switch_provider",
      reasonCode: ErrorCodes.ZG_PROVIDER_NOT_FOUND,
      allowedAutoActions: ["switch_provider", "deposit_ledger"],
      requiresApproval: ["funds"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  if (view.ledgerAvailableOg <= 0 && (view.currentLockedOg ?? 0) <= 0) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "Deposit 0G into the compute ledger before funding the provider.",
      nextAction: "deposit_ledger",
      reasonCode: ErrorCodes.ZG_LEDGER_NOT_FOUND,
      allowedAutoActions: ["deposit_ledger", "fund_provider", "ack_provider", "create_api_key"],
      requiresApproval: ["funds"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  if (view.provider && !view.subAccountExists) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "Fund the selected model to create a provider account.",
      nextAction: "fund_provider",
      reasonCode: ErrorCodes.ZG_INSUFFICIENT_BALANCE,
      allowedAutoActions: ["deposit_ledger", "fund_provider"],
      requiresApproval: ["funds"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  if (view.recommendedMinLockedOg != null && view.currentLockedOg != null && view.currentLockedOg < view.recommendedMinLockedOg) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "The provider still needs more locked 0G.",
      nextAction: "fund_provider",
      reasonCode: ErrorCodes.ZG_INSUFFICIENT_BALANCE,
      allowedAutoActions: ["deposit_ledger", "fund_provider", "ack_provider", "create_api_key"],
      requiresApproval: ["funds"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  if (view.acknowledged === false) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "The provider signer still needs an ACK.",
      nextAction: "ack_provider",
      reasonCode: ErrorCodes.ZG_ACKNOWLEDGE_FAILED,
      allowedAutoActions: ["ack_provider", "create_api_key"],
      requiresApproval: ["funds"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  if (runtime === "claude-code" && !process.env.ZG_CLAUDE_AUTH_TOKEN) {
    return {
      phase: "fund",
      status: "needs_action",
      runtime,
      recommendedRuntime: autoDetectProvider().name,
      summary: "Claude Code still needs an API key token to be stored locally.",
      nextAction: "create_api_key",
      reasonCode: ErrorCodes.ZG_API_KEY_FAILED,
      allowedAutoActions: ["create_api_key"],
      requiresApproval: ["funds", "secrets"],
      warnings,
      manualSteps: [],
      view,
    };
  }

  return {
    phase: "fund",
    status: "ready",
    runtime,
    recommendedRuntime: autoDetectProvider().name,
    summary: "Funding state looks healthy.",
    nextAction: "verify_setup",
    reasonCode: null,
    allowedAutoActions: ["deposit_ledger", "fund_provider", "ack_provider", "create_api_key"],
    requiresApproval: ["funds"],
    warnings,
    manualSteps: [],
    view,
  };
}
