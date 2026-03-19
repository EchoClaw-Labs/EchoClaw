import type { ProviderName } from "../../../../providers/types.js";

export interface RuntimeOption {
  key: ProviderName;
  label: string;
  description: string;
  recommended: boolean;
}

/** External providers/runtimes for skill linking (left side of wizard step 3) */
export const RUNTIME_OPTIONS: RuntimeOption[] = [
  { key: "openclaw", label: "OpenClaw", description: "Open-source AI gateway with 30+ channel support", recommended: false },
  { key: "claude-code", label: "Claude Code", description: "Anthropic agentic coding CLI for your terminal", recommended: false },
  { key: "codex", label: "Codex", description: "OpenAI lightweight coding agent for your terminal", recommended: false },
  { key: "other", label: "Other", description: "Custom or manual AI runtime configuration", recommended: false },
];

export function runtimeLabel(key: string): string {
  if (key === "echoclaw") return "EchoClaw Agent";
  return RUNTIME_OPTIONS.find((o) => o.key === key)?.label
    ?? key.charAt(0).toUpperCase() + key.slice(1);
}
