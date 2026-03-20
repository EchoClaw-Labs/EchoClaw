/**
 * Shared runtime catalog — neutral module for runtime metadata.
 *
 * No CLI, launcher, or UI dependencies.
 * Both CLI and launcher UI import from here.
 */

import type { ProviderName } from "../providers/types.js";

// ── External runtimes (skill-linkable, ProviderName-typed) ───────

export interface RuntimeMeta {
  key: ProviderName;
  label: string;
  description: string;
}

/** External AI runtimes that can be linked via EchoClaw skill. */
export const RUNTIME_CATALOG: RuntimeMeta[] = [
  { key: "openclaw", label: "OpenClaw", description: "Open-source AI gateway with 30+ channel support" },
  { key: "claude-code", label: "Claude Code", description: "Anthropic agentic coding CLI for your terminal" },
  { key: "codex", label: "Codex", description: "OpenAI lightweight coding agent for your terminal" },
  { key: "other", label: "Other", description: "Custom or manual AI runtime configuration" },
];

/** Key → label for external runtimes (ProviderName only). */
export const PROVIDER_LABELS: Record<ProviderName, string> = Object.fromEntries(
  RUNTIME_CATALOG.map((m) => [m.key, m.label]),
) as Record<ProviderName, string>;

// ── EchoClaw Agent (separate entity, NOT a ProviderName) ─────────

/** EchoClaw Agent is our Docker-hosted agent, NOT an external runtime. */
export const ECHOCLAW_AGENT = {
  key: "echoclaw-agent" as const,
  label: "EchoClaw Agent",
  description: "Your own AI agent running in Docker",
} as const;

export type EchoClawAgentKey = typeof ECHOCLAW_AGENT.key;

// ── Lookup ───────────────────────────────────────────────────────

/**
 * Get display label for any runtime key (external or EchoClaw Agent).
 */
export function runtimeLabel(key: string): string {
  if (key === ECHOCLAW_AGENT.key || key === "echoclaw") return ECHOCLAW_AGENT.label;
  return RUNTIME_CATALOG.find((o) => o.key === key)?.label
    ?? key.charAt(0).toUpperCase() + key.slice(1);
}
