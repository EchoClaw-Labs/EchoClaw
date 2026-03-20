/**
 * Shared fund orchestration helpers.
 *
 * Pure orchestration layer — no transport (HTTP) or interactive (inquirer) logic.
 * Both CLI and launcher delegate here for canonical provider selection and API key creation.
 */

import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import {
  createApiKey,
  configureOpenclawProvider,
  listChatServices,
  type ApiKeyInfo,
  type ServiceDetail,
} from "../../0g-compute/operations.js";
import { getAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { loadConfig, saveConfig } from "../../config/store.js";
import { CLAUDE_PROXY_DEFAULT_PORT } from "../../claude/constants.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import logger from "../../utils/logger.js";
import { loadOpenclawConfig } from "../../openclaw/config.js";
import {
  resolvePreferredComputeSelection,
  persistComputeSelection,
  syncConfiguredRuntimes,
  clearAuthCredentials,
  checkAuthState,
  shouldClearRuntimeAuth,
  type ComputeSelection,
  type AuthState,
} from "./compute-selection.js";

// ── Types ────────────────────────────────────────────────────────

export interface SelectFundProviderResult {
  selection: ComputeSelection;
  authState: AuthState;
  wasProviderChanged: boolean;
}

export interface CreateCanonicalApiKeyOptions {
  broker: ZGComputeNetworkBroker;
  /** Zwalidowany ComputeSelection — helper operuje na nim, nie na surowych polach. */
  selection: ComputeSelection;
  tokenId?: number;
  saveClaudeToken?: boolean;
  patchOpenclaw?: boolean;
}

export interface CreateCanonicalApiKeyFromServicesOptions {
  broker: ZGComputeNetworkBroker;
  services?: ServiceDetail[];
  tokenId?: number;
  saveClaudeToken?: boolean;
  patchOpenclaw?: boolean;
}

export interface CreateCanonicalApiKeyResult {
  apiKey: ApiKeyInfo;
  selection: ComputeSelection;
  claudeTokenSaved: boolean;
  openclawPatched: boolean;
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────

function saveClaudeTokenNonInteractive(provider: string, token: string): boolean {
  const cfg = loadConfig();
  if (!cfg.claude || cfg.claude.provider.toLowerCase() !== provider.toLowerCase()) {
    return false;
  }

  writeAppEnvValue("ZG_CLAUDE_AUTH_TOKEN", token);
  process.env.ZG_CLAUDE_AUTH_TOKEN = token;
  return true;
}

// ── selectFundProvider ───────────────────────────────────────────

/**
 * Persist a provider/model selection, sync all configured runtimes,
 * and conditionally clear stale auth credentials.
 *
 * This is the single canonical path for "user chose a provider."
 * Both CLI interactive ("switch") and launcher ("select-provider") delegate here.
 */
export async function selectFundProvider(
  providerAddress: string,
  services?: ServiceDetail[],
): Promise<SelectFundProviderResult> {
  if (!services) {
    const broker = await getAuthenticatedBroker();
    services = await listChatServices(broker);
  }

  if (services.length === 0) {
    throw new EchoError(
      ErrorCodes.ZG_PROVIDER_NOT_FOUND,
      "No chat providers found on the network.",
    );
  }

  const svc = services.find(s => s.provider.toLowerCase() === providerAddress.toLowerCase());
  if (!svc) {
    throw new EchoError(
      ErrorCodes.ZG_PROVIDER_NOT_FOUND,
      `Provider ${providerAddress.slice(0, 10)}... is not currently live on the network.`,
    );
  }

  const currentSelection = resolvePreferredComputeSelection(services);
  const isSameProvider = currentSelection != null
    && currentSelection.provider.toLowerCase() === svc.provider.toLowerCase();

  const selection: ComputeSelection = {
    provider: svc.provider,
    model: svc.model,
    endpoint: svc.url,
    source: "compute-state",
  };

  // Persist canonical selection
  persistComputeSelection(svc.provider, svc.model);

  // Sync runtimes (endpoint/model only, not auth)
  syncConfiguredRuntimes(selection);

  // Clear auth credentials based on provider change
  if (!isSameProvider) {
    clearAuthCredentials();
  } else {
    const currentAuthState = checkAuthState(svc.provider, svc.url);
    const clearClaude = shouldClearRuntimeAuth(currentAuthState, "claude");
    const clearOpenclaw = shouldClearRuntimeAuth(currentAuthState, "openclaw");
    if (clearClaude || clearOpenclaw) {
      clearAuthCredentials({
        ...(clearClaude ? { claude: true } : {}),
        ...(clearOpenclaw ? { openclaw: true } : {}),
      });
    }
  }

  // Compute fresh auth state for response
  const authState = checkAuthState(svc.provider, svc.url);

  logger.debug(`Fund provider selected: ${svc.provider.slice(0, 10)}... (model: ${svc.model})`);

  return { selection, authState, wasProviderChanged: !isSameProvider };
}

// ── createCanonicalApiKey ────────────────────────────────────────

/**
 * Create an API key, persist compute selection, sync runtimes,
 * and optionally save the Claude token and/or patch OpenClaw config.
 *
 * Accepts a validated ComputeSelection — caller is responsible for resolving it.
 */
export async function createCanonicalApiKey(
  options: CreateCanonicalApiKeyOptions,
): Promise<CreateCanonicalApiKeyResult> {
  const { broker, selection, tokenId = 0, saveClaudeToken, patchOpenclaw } = options;
  const warnings: string[] = [];

  // Create the API key (on-chain operation — must happen before any persist)
  const apiKey = await createApiKey(broker, selection.provider, tokenId);

  // Persist canonical selection + sync runtimes
  persistComputeSelection(selection.provider, selection.model);
  syncConfiguredRuntimes(selection);

  // Optionally save Claude token (init config.claude if needed)
  let claudeTokenSaved = false;
  if (saveClaudeToken) {
    try {
      const cfg = loadConfig();
      if (!cfg.claude) {
        cfg.claude = {
          provider: selection.provider,
          model: selection.model,
          providerEndpoint: selection.endpoint,
          proxyPort: CLAUDE_PROXY_DEFAULT_PORT,
        };
        saveConfig(cfg);
        logger.debug("Initialized config.claude from canonical selection");
      }
      claudeTokenSaved = saveClaudeTokenNonInteractive(selection.provider, apiKey.rawToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`API key created, but Claude token could not be saved: ${msg}`);
      logger.warn(`Claude token save failed after API key creation: ${msg}`);
    }
  }

  // Patch OpenClaw when explicitly requested or when the runtime is already configured.
  let openclawPatched = false;
  let shouldPatchOpenclaw = patchOpenclaw === true;
  if (!shouldPatchOpenclaw) {
    try {
      shouldPatchOpenclaw = loadOpenclawConfig() != null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`API key created, but OpenClaw config could not be inspected: ${msg}`);
      logger.warn(`OpenClaw config inspection failed after API key creation: ${msg}`);
    }
  }
  if (shouldPatchOpenclaw) {
    try {
      await configureOpenclawProvider(broker, selection.provider, apiKey.rawToken);
      openclawPatched = true;
      logger.debug(`OpenClaw config patched for provider ${selection.provider.slice(0, 10)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`API key created, but OpenClaw config patch failed: ${msg}`);
      logger.warn(`OpenClaw patch failed after API key creation: ${msg}`);
    }
  }

  logger.debug(`Canonical API key created (tokenId ${apiKey.tokenId})`);

  return { apiKey, selection, claudeTokenSaved, openclawPatched, warnings };
}

// ── createCanonicalApiKeyFromServices ────────────────────────────

/**
 * Resolve canonical selection from live services, then create API key.
 *
 * Use this when the caller does not have a pre-validated ComputeSelection
 * (e.g., CLI interactive "api-key" action).
 */
export async function createCanonicalApiKeyFromServices(
  options: CreateCanonicalApiKeyFromServicesOptions,
): Promise<CreateCanonicalApiKeyResult> {
  const { broker, tokenId, saveClaudeToken, patchOpenclaw } = options;

  let services = options.services;
  if (!services) {
    services = await listChatServices(broker);
  }

  const selection = resolvePreferredComputeSelection(services);
  if (!selection) {
    throw new EchoError(
      ErrorCodes.ZG_PROVIDER_NOT_FOUND,
      "No live 0G providers are currently available.",
    );
  }

  return createCanonicalApiKey({ broker, selection, tokenId, saveClaudeToken, patchOpenclaw });
}
