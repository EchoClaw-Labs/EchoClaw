import type { RoutingDecision } from "../api";

export type WizardStep = "password" | "wallet" | "runtime" | "provider" | "fund" | "finalize" | "done";

interface WizardSnapshot {
  wallet?: {
    password?: { status?: string };
    evmKeystorePresent?: boolean;
  };
}

export function deriveWizardBootstrapStep(
  snapshot: WizardSnapshot | null,
  routing: RoutingDecision | null,
): WizardStep {
  if (routing?.reason === "ready") {
    return "done";
  }

  const passwordReady = snapshot?.wallet?.password?.status === "ready"
    || snapshot?.wallet?.password?.status === "drift";

  if (!passwordReady) {
    return "password";
  }

  if (!snapshot?.wallet?.evmKeystorePresent) {
    return "wallet";
  }

  return "runtime";
}
