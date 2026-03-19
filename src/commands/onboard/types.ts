export interface StepStatus {
  configured: boolean;
  summary: string;
  warning?: string;
}

export interface StepResult {
  action: "configured" | "configured_with_warning" | "skipped" | "already_configured" | "failed";
  message: string;
}

export interface OnboardState {
  configInitialized: boolean;
  openclawLinked: boolean;
  passwordSet: boolean;
  webhooksConfigured: boolean;
  walletAddress: string | null;
  hasKeystore: boolean;
  computeReady: boolean;
  selectedProvider: string | null;
  monitorRunning: boolean;
  gatewayRestarted: boolean;
}

export interface OnboardStep {
  name: string;
  description: string;
  detect: (state: OnboardState) => StepStatus | Promise<StepStatus>;
  run: (state: OnboardState) => Promise<StepResult>;
}
