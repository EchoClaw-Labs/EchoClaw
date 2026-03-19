/**
 * Bridge API handlers.
 *
 * Wraps Khalani client for cross-chain bridge operations.
 */

import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { getKhalaniClient } from "../../khalani/client.js";
import { getCachedKhalaniChains } from "../../khalani/chains.js";
import { prepareQuoteRequest } from "../../commands/khalani/request.js";
import { resolveRouteBestIndex } from "../../commands/khalani/helpers.js";
import logger from "../../utils/logger.js";

// ── GET /api/bridge/chains ───────────────────────────────────────

const handleChains: RouteHandler = async (_req, res) => {
  const chains = await getCachedKhalaniChains();
  jsonResponse(res, 200, { chains });
};

// ── POST /api/bridge/tokens ──────────────────────────────────────

const handleTokens: RouteHandler = async (_req, res, params) => {
  const query = params.body?.query as string | undefined;
  const chainId = params.body?.chainId as number | undefined;
  const chainIds = chainId ? [chainId] : undefined;

  const client = getKhalaniClient();
  const tokens = query && query.trim().length > 0
    ? (await client.searchTokens(query.trim(), chainIds)).data
    : await client.getTopTokens(chainIds);

  jsonResponse(res, 200, { tokens: tokens.slice(0, 20) });
};

// ── POST /api/bridge/quote ───────────────────────────────────────

const handleQuote: RouteHandler = async (_req, res, params) => {
  const body = params.body as Record<string, unknown>;
  if (!body.fromChain || !body.fromToken || !body.toChain || !body.toToken || !body.amount) {
    errorResponse(res, 400, "MISSING_FIELDS", "Required: fromChain, fromToken, toChain, toToken, amount");
    return;
  }

  const prepared = await prepareQuoteRequest({
    fromChain: String(body.fromChain),
    fromToken: String(body.fromToken),
    toChain: String(body.toChain),
    toToken: String(body.toToken),
    amount: String(body.amount),
    tradeType: (body.tradeType as string) ?? "EXACT_INPUT",
    fromAddress: body.fromAddress as string | undefined,
    recipient: body.recipient as string | undefined,
    refundTo: body.refundTo as string | undefined,
  });

  const client = getKhalaniClient();
  const quotes = await client.getQuotes(prepared.request);
  const bestIndex = quotes.routes.length > 0 ? resolveRouteBestIndex(quotes.routes) : -1;

  jsonResponse(res, 200, {
    quoteId: quotes.quoteId,
    routes: quotes.routes,
    bestIndex,
    fromChainId: prepared.fromChainId,
    toChainId: prepared.toChainId,
  });
};

// ── POST /api/bridge/deposit-build ───────────────────────────────

const handleDepositBuild: RouteHandler = async (_req, res, params) => {
  const { from, quoteId, routeId, depositMethod } = params.body as Record<string, string>;
  if (!from || !quoteId || !routeId) {
    errorResponse(res, 400, "MISSING_FIELDS", "Required: from, quoteId, routeId");
    return;
  }

  const client = getKhalaniClient();
  const plan = await client.buildDeposit({
    from,
    quoteId,
    routeId,
    depositMethod: depositMethod as "CONTRACT_CALL" | "TRANSFER" | undefined,
  });

  jsonResponse(res, 200, { plan });
};

// ── POST /api/bridge/deposit-submit ──────────────────────────────

const handleDepositSubmit: RouteHandler = async (_req, res, params) => {
  const { quoteId, routeId, depositMethod } = params.body as Record<string, string>;
  if (!quoteId || !routeId) {
    errorResponse(res, 400, "MISSING_FIELDS", "Required: quoteId, routeId");
    return;
  }

  // Import bridge executor dynamically to avoid loading wallet deps on startup
  const { executeDepositPlan } = await import("../../commands/khalani/bridge-executor.js");
  const chains = await getCachedKhalaniChains();
  const client = getKhalaniClient();

  // Build deposit plan first
  const plan = await client.buildDeposit({
    from: (params.body?.from as string) ?? "",
    quoteId,
    routeId,
    depositMethod: depositMethod as "CONTRACT_CALL" | "TRANSFER" | undefined,
  });

  const sourceChainId = params.body?.sourceChainId as number | undefined;
  if (!sourceChainId) {
    errorResponse(res, 400, "MISSING_FIELDS", "sourceChainId is required for execution");
    return;
  }

  const sourceChain = chains.find(c => c.id === sourceChainId);
  if (!sourceChain) {
    errorResponse(res, 400, "CHAIN_NOT_FOUND", `Chain ${sourceChainId} not found`);
    return;
  }

  const result = await executeDepositPlan(plan, sourceChain, chains, quoteId, routeId);

  logger.info(`[launcher] bridge executed: order ${result.orderId}`);
  jsonResponse(res, 200, {
    phase: "bridge", status: "applied",
    summary: `Bridge executed. Order: ${result.orderId}`,
    orderId: result.orderId,
    txHash: result.txHash,
  });
};

// ── Registration ─────────────────────────────────────────────────

export function registerBridgeRoutes(): void {
  registerRoute("GET", "/api/bridge/chains", handleChains);
  registerRoute("POST", "/api/bridge/tokens", handleTokens);
  registerRoute("POST", "/api/bridge/quote", handleQuote);
  registerRoute("POST", "/api/bridge/deposit-build", handleDepositBuild);
  registerRoute("POST", "/api/bridge/deposit-submit", handleDepositSubmit);
}
