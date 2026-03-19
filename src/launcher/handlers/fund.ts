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
  createApiKey,
} from "../../0g-compute/operations.js";
import { calculateProviderPricing, formatPricePerMTokens } from "../../0g-compute/pricing.js";
import { getAuthenticatedBroker, resetAuthenticatedBroker } from "../../0g-compute/broker-factory.js";
import { saveComputeState } from "../../0g-compute/readiness.js";
import { autoDetectProvider } from "../../providers/registry.js";
import { normalizeRuntime } from "../../commands/echo/assessment.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { loadConfig } from "../../config/store.js";
import logger from "../../utils/logger.js";

// ── GET /api/fund/view ───────────────────────────────────────────

const handleFundView: RouteHandler = async (_req, res, params) => {
  const provider = params.query.provider || readProviderSelection();
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

  const broker = await getAuthenticatedBroker();
  await fundProvider(broker, provider, amount);

  logger.info(`[launcher] funded ${amount} 0G to provider ${provider.slice(0, 10)}...`);
  jsonResponse(res, 200, {
    phase: "fund", status: "applied",
    summary: `Locked ${amount} 0G for provider.`,
  });
};

// ── POST /api/fund/ack ───────────────────────────────────────────

const handleAck: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  if (!provider) { errorResponse(res, 400, "MISSING_PROVIDER", "provider is required."); return; }

  const broker = await getAuthenticatedBroker();
  const confirmed = await ackWithReadback(broker, provider);

  jsonResponse(res, 200, {
    phase: "fund", status: "applied",
    summary: confirmed ? "Provider acknowledged and confirmed." : "ACK sent but confirmation timed out.",
    confirmed,
  });
};

// ── POST /api/fund/api-key ───────────────────────────────────────

const handleApiKey: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  const tokenId = params.body?.tokenId != null ? Number(params.body.tokenId) : 0;
  const saveClaudeToken = params.body?.saveClaudeToken === true;

  if (!provider) { errorResponse(res, 400, "MISSING_PROVIDER", "provider is required."); return; }

  const broker = await getAuthenticatedBroker();
  const apiKey = await createApiKey(broker, provider, tokenId);

  let claudeTokenSaved = false;
  if (saveClaudeToken) {
    const cfg = loadConfig();
    if (cfg.claude && cfg.claude.provider.toLowerCase() === provider.toLowerCase()) {
      writeAppEnvValue("ZG_CLAUDE_AUTH_TOKEN", apiKey.rawToken);
      process.env.ZG_CLAUDE_AUTH_TOKEN = apiKey.rawToken;
      claudeTokenSaved = true;
    }
  }

  // Save compute state — need model from services
  try {
    const services = await listChatServices(broker);
    const svc = services.find(s => s.provider.toLowerCase() === provider.toLowerCase());
    if (svc) {
      saveComputeState({ activeProvider: provider, model: svc.model, configuredAt: Date.now() });
    }
  } catch { /* non-fatal */ }

  logger.info(`[launcher] API key created (tokenId ${apiKey.tokenId})`);
  jsonResponse(res, 200, {
    phase: "fund", status: "applied",
    summary: `API key created (token ID ${apiKey.tokenId}).`,
    tokenId: apiKey.tokenId, claudeTokenSaved,
  });
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
}
