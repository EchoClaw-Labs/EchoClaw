import type { ProviderName } from "../../../../../providers/types.js";

export type WizardStep = "password" | "wallet" | "runtime" | "provider" | "fund" | "finalize" | "done";

/** Whether the user chose our Docker agent or an external runtime. */
export type WizardPath = "echoclaw-agent" | "external-runtime";

export interface WizardProvider {
  provider: string;
  model: string;
  inputPricePerMTokens: string;
  outputPricePerMTokens: string;
  recommendedMinLockedOg?: number;
}

export interface WalletAddresses {
  evm: string;
  solana?: string;
}

/** Typed response from /api/wallet/create and /api/wallet/import. */
export interface WalletMutationResponse {
  status?: "confirm_required" | "applied";
  address?: string;
  message?: string;
  reason?: string;
}

/** Props shared by all step components. */
export interface StepProps {
  busy: boolean;
  onAction: (action: () => Promise<void>) => void;
}

export const WIZARD_STEPS: { key: WizardStep; title: string; num: number }[] = [
  { key: "password", title: "Set Password", num: 1 },
  { key: "wallet", title: "Create Wallet", num: 2 },
  { key: "runtime", title: "Select Runtime", num: 3 },
  { key: "provider", title: "Choose Provider", num: 4 },
  { key: "fund", title: "Fund Compute", num: 5 },
  { key: "finalize", title: "Finalize", num: 6 },
];

export const STEP_DESCRIPTIONS: Record<string, string> = {
  password: "Set a password to encrypt your keystore.",
  wallet: "Create an EVM wallet (and optionally Solana).",
  runtime: "Choose which AI runtime you'll connect.",
  provider: "Pick an AI provider on the 0G network.",
  fund: "Deposit 0G tokens to fund your AI compute.",
  finalize: "Finishing setup...",
};
