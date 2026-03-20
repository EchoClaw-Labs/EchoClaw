/**
 * Funding API handlers.
 *
 * Full parity with runInteractiveFund():
 * view, plan, deposit, fund provider, ACK, API key, providers list.
 */

import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { buildFundView, readProviderSelection } from "../../commands/echo/fund.js";
import { buildFundPayload } from "../../commands/echo/fund-assessment.js";
import {
  listChatServices,
  depositToLedger,
  fundProvider,
  ackWithReadback,
} from "../../0g-compute/operations.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { getAuthenticatedBroker, resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { autoDetectProvider } from "../../providers/registry.js";
import { normalizeRuntime } from "../../commands/echo/assessment.js";
import { resolvePreferredComputeSelection } from "../../commands/echo/compute-selection.js";
import { selectFundProvider, createCanonicalApiKey } from "../../commands/echo/fund-apply.js";
import { EchoError } from "../../errors.js";
import logger from "../../utils/logger.js";

// ── GET /api/fund/view ───────────────────────────────────────────

const handleFundView: RouteHandler = async (_req, res, params) => {
  const provider = params.query.provider || null;
  const fresh = params.query.fresh === "1" || params.query.fresh === "true";

  try {
    const view = await buildFundView({ provider, fresh });
    jsonResponse(res, 200, view);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 500, "FUND_VIEW_FAILED", `Failed to build fund view: ${msg}`,
      "Ensure wallet is configured and network is reachable.");
  }
};

// ── POST /api/fund/plan ──────────────────────────────────────────

const handleFundPlan: RouteHandler = async (_req, res, params) => {
  const runtime = params.body?.runtime
    ? normalizeRuntime(params.body.runtime as string)
    : autoDetectProvider().name;
  const provider = readProviderSelection();
  const view = await buildFundView({ provider });
  const payload = buildFundPayload(view, runtime);
  jsonResponse(res, 200, payload);
};

// ── GET /api/fund/providers ──────────────────────────────────────

const handleProviders: RouteHandler = async (_req, res) => {
  const broker = await getAuthenticatedBroker();
  const services = await listChatServices(broker);

  const providers = services.map(svc => {
    const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);
    return {
      provider: svc.provider,
      model: svc.model,
      inputPricePerMTokens: formatPricePerMTokens(svc.inputPrice),
      outputPricePerMTokens: formatPricePerMTokens(svc.outputPrice),
      recommendedMinLockedOg: pricing.recommendedMinLockedOg,
      endpoint: svc.url,
    };
  });

  jsonResponse(res, 200, { providers });
};

// ── POST /api/fund/deposit ───────────────────────────────────────

const handleDeposit: RouteHandler = async (_req, res, params) => {
  const amount = params.body?.amount as string | undefined;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    errorResponse(res, 400, "INVALID_AMOUNT", "amount must be a positive number.");
    return;
  }

  const broker = await getAuthenticatedBroker();
  await depositToLedger(broker, amount);

  logger.info(`[launcher] deposited ${amount} 0G to ledger`);
  jsonResponse(res, 200, {
    phase: "fund", status: "applied",
    summary: `Deposited ${amount} 0G to compute ledger.`,
  });
};

// ── POST /api/fund/provider ──────────────────────────────────────

const handleFundProvider: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  const amount = params.body?.amount as string | undefined;

  if (!provider) { errorResponse(res, 400, "MISSING_PROVIDER", "provider is required."); return; }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    errorResponse(res, 400, "INVALID_AMOUNT", "amount must be a positive number."); return;
  }

  try {
    const broker = await getAuthenticatedBroker();
    await fundProvider(broker, provider, amount);

    logger.info(`[launcher] funded ${amount} 0G to provider ${provider.slice(0, 10)}...`);
    jsonResponse(res, 200, {
      phase: "fund", status: "applied",
      summary: `Locked ${amount} 0G for provider.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    errorResponse(res, 500, "FUND_PROVIDER_FAILED", `Failed to fund provider: ${msg}`, "Check ledger balance and network.");
  }
};

// ── POST /api/fund/ack ───────────────────────────────────────────

const handleAck: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  if (!provider) { errorResponse(res, 400, "MISSING_PROVIDER", "provider is required."); return; }

  try {
    const broker = await getAuthenticatedBroker();
    const confirmed = await ackWithReadback(broker, provider);

    jsonResponse(res, 200, {
      phase: "fund", status: "applied",
      summary: confirmed ? "Provider acknowledged and confirmed." : "ACK sent but confirmation timed out.",
      confirmed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    errorResponse(res, 500, "ACK_FAILED", `Failed to acknowledge provider: ${msg}`, "Ensure provider is funded and network is reachable.");
  }
};

// ── POST /api/fund/api-key ───────────────────────────────────────

const handleApiKey: RouteHandler = async (_req, res, params) => {
  const requestedProvider = params.body?.provider as string | undefined;
  const tokenId = params.body?.tokenId != null ? Number(params.body.tokenId) : 0;
  const saveClaudeToken = params.body?.saveClaudeToken === true;
  const patchOpenclaw = params.body?.patchOpenclaw === true;

  if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > 254) {
    errorResponse(res, 400, "INVALID_TOKEN_ID", "tokenId must be an integer between 0 and 254."); return;
  }

  try {
    const broker = await getAuthenticatedBroker();
    const services = await listChatServices(broker);

    // Resolve canonical selection from live services
    const selection = resolvePreferredComputeSelection(services);
    if (!selection) {
      errorResponse(res, 404, "PROVIDER_NOT_FOUND", "No live 0G providers are currently available.");
      return;
    }

    // Staleness check — HTTP-specific concern (UI race condition guard)
    if (requestedProvider && requestedProvider.toLowerCase() !== selection.provider.toLowerCase()) {
      errorResponse(res, 409, "STALE_PROVIDER_SELECTION", "Selected provider changed. Refresh the Fund view and try again.");
      return;
    }

    // Delegate to shared helper
    const result = await createCanonicalApiKey({
      broker, selection, tokenId, saveClaudeToken, patchOpenclaw,
    });

    logger.info(`[launcher] API key created (tokenId ${result.apiKey.tokenId})`);
    jsonResponse(res, 200, {
      phase: "fund", status: "applied",
      summary: result.warnings[0] ?? `API key created (token ID ${result.apiKey.tokenId}).`,
      tokenId: result.apiKey.tokenId,
      claudeTokenSaved: result.claudeTokenSaved,
      openclawPatched: result.openclawPatched,
      warnings: result.warnings,
      rawToken: result.apiKey.rawToken,
      provider: result.selection.provider,
      model: result.selection.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    errorResponse(res, 500, "API_KEY_FAILED", `Failed to create API key: ${msg}`, "Ensure provider is funded and ACKed.");
  }
};

// ── POST /api/fund/select-provider ───────────────────────────────

const handleSelectProvider: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  if (!provider) {
    errorResponse(res, 400, "MISSING_PROVIDER", "provider is required.");
    return;
  }

  try {
    const broker = await getAuthenticatedBroker();
    const services = await listChatServices(broker);
    const result = await selectFundProvider(provider, services);

    logger.info(`[launcher] provider selected: ${result.selection.provider.slice(0, 10)}... (model: ${result.selection.model})`);
    jsonResponse(res, 200, {
      phase: "fund",
      status: "applied",
      summary: `Provider selected: ${result.selection.model}`,
      provider: result.selection.provider,
      model: result.selection.model,
      requiresApiKeyRotation: result.authState.requiresApiKeyRotation,
      selectionWarning: result.authState.selectionWarning,
    });
  } catch (err) {
    if (err instanceof EchoError) {
      errorResponse(res, 404, err.code, err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 500, "SELECT_PROVIDER_FAILED", `Failed to select provider: ${msg}`);
  }
};

// ── Registration ─────────────────────────────────────────────────

export function registerFundRoutes(): void {
  registerRoute("GET", "/api/fund/view", handleFundView);
  registerRoute("POST", "/api/fund/plan", handleFundPlan);
  registerRoute("GET", "/api/fund/providers", handleProviders);
  registerRoute("POST", "/api/fund/deposit", handleDeposit);
  registerRoute("POST", "/api/fund/provider", handleFundProvider);
  registerRoute("POST", "/api/fund/ack", handleAck);
  registerRoute("POST", "/api/fund/api-key", handleApiKey);
  registerRoute("POST", "/api/fund/select-provider", handleSelectProvider);
}
