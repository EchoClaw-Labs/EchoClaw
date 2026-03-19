import type { ProviderName } from "../../../../providers/types.js";

export interface RuntimeOption {
  key: ProviderName;
  label: string;
  subtitle?: string;
  recommended: boolean;
}

export const RUNTIME_OPTIONS: RuntimeOption[] = [
  { key: "openclaw", label: "EchoClaw Agent", subtitle: "OpenClaw gateway", recommended: true },
  { key: "claude-code", label: "Claude Code", recommended: false },
  { key: "codex", label: "Codex", recommended: false },
  { key: "other", label: "Other", recommended: false },
];

export function runtimeLabel(key: string): string {
  return RUNTIME_OPTIONS.find((o) => o.key === key)?.label
    ?? key.charAt(0).toUpperCase() + key.slice(1);
}
