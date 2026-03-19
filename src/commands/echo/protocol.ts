import type { ProviderName } from "../../providers/types.js";
import { writeJsonSuccess } from "../../utils/output.js";

export type EchoPhase =
  | "connect"
  | "fund"
  | "verify"
  | "resume"
  | "status"
  | "doctor"
  | "support-report"
  | "explore"
  | "wallet"
  | "bridge"
  | "advanced";

export type EchoWorkflowStatus =
  | "ready"
  | "needs_action"
  | "blocked"
  | "applied"
  | "manual_required";

export interface EchoWorkflowPayload extends Record<string, unknown> {
  phase: EchoPhase;
  status: EchoWorkflowStatus;
  summary: string;
  runtime?: ProviderName | null;
  recommendedRuntime?: ProviderName | null;
  nextAction?: string | null;
  reasonCode?: string | null;
  requiresApproval?: string[];
  allowedAutoActions?: string[];
  manualSteps?: string[];
  warnings?: string[];
}

export function writeEchoWorkflow(payload: EchoWorkflowPayload): void {
  writeJsonSuccess({
    nextAction: null,
    reasonCode: null,
    requiresApproval: [],
    allowedAutoActions: [],
    manualSteps: [],
    warnings: [],
    ...payload,
  });
}
