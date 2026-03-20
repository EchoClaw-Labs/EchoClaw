/**
 * Canonical selection service for 0G provider/model.
 *
 * compute-state.json is the single source of truth.
 * All consumers (FundView, CLI, EchoClaw Agent, Claude Code, OpenClaw)
 * read the canonical selection from here.
 */

import { loadComputeState, saveComputeState } from "../../0g-compute/readiness.js";
import { loadConfig, saveConfig } from "../../config/store.js";
import { loadOpenclawConfig, patchOpenclawConfig, removeOpenclawConfigKey } from "../../openclaw/config.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import type { ServiceDetail } from "../../0g-compute/operations.js";
import logger from "../../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────

export interface ComputeSelection {
  provider: string;
  model: string;
  endpoint: string;
  source: "compute-state" | "claude-config" | "openclaw-config" | "live-fallback";
}

export interface RuntimeAuthInfo {
  configured: boolean;
  hasAuth: boolean;
  providerMatch: boolean;
}

export interface AuthState {
  requiresApiKeyRotation: boolean;
  selectionWarning: string | null;
  runtimes: {
    claude: RuntimeAuthInfo;
    openclaw: RuntimeAuthInfo;
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/** Strip trailing slashes and normalise scheme+host for URL comparison. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

function findServiceByProvider(services: ServiceDetail[], provider: string): ServiceDetail | undefined {
  return services.find(s => s.provider.toLowerCase() === provider.toLowerCase());
}

function findServiceByEndpoint(services: ServiceDetail[], endpoint: string): ServiceDetail | undefined {
  const norm = normalizeUrl(endpoint);
  return services.find(s => normalizeUrl(s.url) === norm);
}

// ── Resolve ──────────────────────────────────────────────────────

/**
 * Resolve the user's preferred provider/model, matching against live services.
 *
 * Resolution order (compute-state.json wins):
 *   1. compute-state.json → activeProvider
 *   2. cfg.claude.provider
 *   3. OpenClaw config → models.providers.zg.baseUrl matched to a live service
 *   4. First live service (fallback)
 *
 * If a source's provider is not live, it is skipped.
 * Returns null only if `services` is empty.
 */
export function resolvePreferredComputeSelection(
  services: ServiceDetail[],
): ComputeSelection | null {
  if (services.length === 0) return null;

  // 1. compute-state.json
  const state = loadComputeState();
  if (state?.activeProvider) {
    const svc = findServiceByProvider(services, state.activeProvider);
    if (svc) {
      return { provider: svc.provider, model: svc.model, endpoint: svc.url, source: "compute-state" };
    }
  }

  // 2. cfg.claude.provider
  const cfg = loadConfig();
  if (cfg.claude?.provider) {
    const svc = findServiceByProvider(services, cfg.claude.provider);
    if (svc) {
      return { provider: svc.provider, model: svc.model, endpoint: svc.url, source: "claude-config" };
    }
  }

  // 3. OpenClaw baseUrl match
  const ocConfig = loadOpenclawConfig();
  const zgBaseUrl = (ocConfig?.models as Record<string, any>)?.providers?.zg?.baseUrl as string | undefined;
  if (zgBaseUrl) {
    const svc = findServiceByEndpoint(services, zgBaseUrl);
    if (svc) {
      return { provider: svc.provider, model: svc.model, endpoint: svc.url, source: "openclaw-config" };
    }
  }

  // 4. Fallback: first live service
  const first = services[0]!;
  return { provider: first.provider, model: first.model, endpoint: first.url, source: "live-fallback" };
}

// ── Persist ──────────────────────────────────────────────────────

/**
 * Persist provider + model to compute-state.json.
 * This is the single write point for user selection.
 */
export function persistComputeSelection(provider: string, model: string): void {
  saveComputeState({ activeProvider: provider, model, configuredAt: Date.now() });
  logger.debug(`Compute selection persisted: ${provider.slice(0, 10)}... / ${model}`);
}

// ── Runtime sync ─────────────────────────────────────────────────

/**
 * After a provider switch, sync all configured runtimes
 * to match the new selection (endpoint/model only, NOT auth tokens).
 */
export function syncConfiguredRuntimes(
  selection: ComputeSelection,
  opts?: { skipClaude?: boolean; skipOpenclaw?: boolean },
): void {
  // Claude config
  if (!opts?.skipClaude) {
    const cfg = loadConfig();
    if (cfg.claude) {
      cfg.claude.provider = selection.provider;
      cfg.claude.model = selection.model;
      cfg.claude.providerEndpoint = selection.endpoint;
      saveConfig(cfg);
      logger.debug(`Claude config synced to provider ${selection.provider.slice(0, 10)}...`);
    }
  }

  // OpenClaw config
  if (!opts?.skipOpenclaw) {
    const ocConfig = loadOpenclawConfig();
    if (ocConfig) {
      patchOpenclawConfig("models.providers.zg.baseUrl", selection.endpoint, { force: true });
      patchOpenclawConfig("models.providers.zg.models", [
        { id: selection.model, name: `${selection.model} (0G Compute)`, contextWindow: 128000, maxTokens: 8192 },
      ], { force: true });
      patchOpenclawConfig("agents.defaults.model", { primary: `zg/${selection.model}` }, { force: true });
      logger.debug(`OpenClaw config synced to provider ${selection.provider.slice(0, 10)}...`);
    }
  }
}

// ── Auth credentials ─────────────────────────────────────────────

/**
 * Clear auth credentials for both Claude and OpenClaw.
 * Called on provider switch to invalidate stale keys.
 */
export function clearAuthCredentials(opts?: { claude?: boolean; openclaw?: boolean }): void {
  const clearClaude = opts == null ? true : opts.claude === true;
  const clearOpenclaw = opts == null ? true : opts.openclaw === true;

  if (clearClaude) {
    writeAppEnvValue("ZG_CLAUDE_AUTH_TOKEN", "");
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  }

  if (clearOpenclaw) {
    removeOpenclawConfigKey("models.providers.zg.apiKey");
  }

  const cleared: string[] = [];
  if (clearClaude) cleared.push("Claude");
  if (clearOpenclaw) cleared.push("OpenClaw");
  logger.debug(`Auth credentials cleared for: ${cleared.join(", ") || "none"}.`);
}

/**
 * Check whether a specific runtime needs its auth credentials cleared.
 * Returns true if the runtime is configured but has no auth or mismatched provider.
 */
export function shouldClearRuntimeAuth(authState: AuthState, runtime: "claude" | "openclaw"): boolean {
  const state = authState.runtimes[runtime];
  return state.configured && (!state.hasAuth || !state.providerMatch);
}

/**
 * Check whether each configured runtime has a valid auth token
 * for the given provider/endpoint.
 *
 * This is called on every buildFundView() so the auth state
 * is reconstructable from backend state, not a one-time toast.
 */
export function checkAuthState(provider: string, endpoint: string): AuthState {
  // Claude
  const cfg = loadConfig();
  const claudeConfigured = cfg.claude != null;
  const claudeHasAuth = !!process.env.ZG_CLAUDE_AUTH_TOKEN;
  const claudeProviderMatch = claudeConfigured
    ? cfg.claude!.provider.toLowerCase() === provider.toLowerCase()
    : false;
  const claudeStale = claudeConfigured && (!claudeHasAuth || !claudeProviderMatch);

  // OpenClaw
  const ocConfig = loadOpenclawConfig();
  const zgProvider = (ocConfig?.models as Record<string, any>)?.providers?.zg as
    | { baseUrl?: string; apiKey?: string }
    | undefined;
  const openclawConfigured = zgProvider != null;
  const openclawHasAuth = !!zgProvider?.apiKey;
  const openclawEndpointMatch = openclawConfigured && zgProvider?.baseUrl
    ? normalizeUrl(zgProvider.baseUrl) === normalizeUrl(endpoint)
    : false;
  const openclawStale = openclawConfigured && (!openclawHasAuth || !openclawEndpointMatch);

  // Build warning
  const staleRuntimes: string[] = [];
  if (claudeStale) staleRuntimes.push("Claude Code");
  if (openclawStale) staleRuntimes.push("OpenClaw");

  const requiresApiKeyRotation = staleRuntimes.length > 0;
  let selectionWarning: string | null = null;
  if (requiresApiKeyRotation) {
    selectionWarning = `Create a new API key — ${staleRuntimes.join(" and ")} ${staleRuntimes.length === 1 ? "needs" : "need"} a valid key for this provider.`;
  }

  return {
    requiresApiKeyRotation,
    selectionWarning,
    runtimes: {
      claude: { configured: claudeConfigured, hasAuth: claudeHasAuth, providerMatch: claudeProviderMatch },
      openclaw: { configured: openclawConfigured, hasAuth: openclawHasAuth, providerMatch: openclawEndpointMatch },
    },
  };
}
