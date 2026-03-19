import type { ProviderAdapter, ProviderName, DetectionResult } from "./types.js";
import { OpenClawAdapter } from "./openclaw.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { OtherAdapter } from "./other.js";

const adapters: Record<ProviderName, () => ProviderAdapter> = {
  "openclaw": () => new OpenClawAdapter(),
  "claude-code": () => new ClaudeCodeAdapter(),
  "codex": () => new CodexAdapter(),
  "other": () => new OtherAdapter(),
};

/** Resolve a provider adapter by name. Throws on unknown name. */
export function resolveProvider(name: string): ProviderAdapter {
  // Normalize aliases
  const normalized = name === "claude" ? "claude-code" : name;
  const factory = adapters[normalized as ProviderName];
  if (!factory) {
    throw new Error(`Unknown provider: "${name}". Valid: openclaw, claude, codex, other`);
  }
  return factory();
}

/** Detect which providers are available on this system. */
export function detectProviders(): Record<ProviderName, DetectionResult> {
  const result = {} as Record<ProviderName, DetectionResult>;
  for (const [name, factory] of Object.entries(adapters)) {
    result[name as ProviderName] = factory().detect();
  }
  return result;
}

/**
 * Auto-detect the best available provider.
 * Priority: openclaw > claude-code > codex > other.
 */
export function autoDetectProvider(): ProviderAdapter {
  for (const name of ["openclaw", "claude-code", "codex"] as const) {
    const adapter = adapters[name]();
    if (adapter.detect().detected) return adapter;
  }
  return new OtherAdapter();
}
