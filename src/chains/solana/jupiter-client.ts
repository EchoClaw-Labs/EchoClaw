/**
 * Jupiter API client — single module for all Jupiter endpoints.
 * Covers: token search, token by mint, swap quote, swap tx, trending tokens.
 */

import { loadConfig } from "../../config/store.js";
import { fetchJson } from "../../utils/http.js";
import { EchoError, ErrorCodes } from "../../errors.js";

// --- URL / Auth helpers ---

export function getJupiterBaseUrl(): string {
  const key = loadConfig().solana.jupiterApiKey;
  return key ? "https://api.jup.ag" : "https://lite-api.jup.ag";
}

export function getJupiterHeaders(): Record<string, string> {
  const key = loadConfig().solana.jupiterApiKey;
  return key ? { "x-api-key": key } : {};
}

// --- Ultra Swap API ---

export interface UltraOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}

export interface UltraOrderResponse {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label: string; ammKey: string }; percent: number }>;
  transaction: string | null;
  gasless: boolean;
  router: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface UltraExecuteResponse {
  status: "Success" | "Failed";
  signature: string;
  slot: string;
  code: number;
  inputAmountResult: string;
  outputAmountResult: string;
  error?: string;
}

export async function jupiterUltraOrder(params: UltraOrderRequest): Promise<UltraOrderResponse> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  if (params.taker) qs.set("taker", params.taker);
  if (params.slippageBps != null) qs.set("slippageBps", String(params.slippageBps));

  return fetchJson<UltraOrderResponse>(`${base}/ultra/v1/order?${qs.toString()}`, { headers });
}

export async function jupiterUltraExecute(
  signedTransaction: string,
  requestId: string,
): Promise<UltraExecuteResponse> {
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  return fetchJson<UltraExecuteResponse>(`${base}/ultra/v1/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ signedTransaction, requestId }),
  });
}

export interface HoldingsResponse {
  amount: string;
  uiAmount: number;
  tokens: Record<string, Array<{
    account: string;
    amount: string;
    uiAmount: number;
    decimals: number;
    isFrozen: boolean;
    isAssociatedTokenAccount: boolean;
    programId: string;
  }>>;
}

export async function jupiterHoldings(address: string): Promise<HoldingsResponse> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  return fetchJson<HoldingsResponse>(`${base}/ultra/v1/holdings/${address}`, { headers });
}

export interface ShieldWarning {
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
  source: string | null;
}

export async function jupiterShield(mints: string[]): Promise<Record<string, ShieldWarning[]>> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const result = await fetchJson<{ warnings: Record<string, ShieldWarning[]> }>(
    `${base}/ultra/v1/shield?mints=${mints.join(",")}`,
    { headers },
  );
  return result.warnings;
}

// --- Response types (Jupiter wire format) ---

export interface JupiterTokenInfo {
  id: string;          // mint address (Jupiter uses "id", not "address")
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;       // logo URL (Jupiter uses "icon", not "logoURI")
  tags?: string[];
}

export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label: string; ammKey: string } }>;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // base64 encoded VersionedTransaction
}

export interface JupiterTokenListEntry {
  id: string;          // mint address
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;       // logo URL
  usdPrice?: number;
  stats24h?: { buyVolume?: number; sellVolume?: number };
}

// --- API methods ---

export async function jupiterSearchTokens(query: string): Promise<JupiterTokenInfo[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  return fetchJson<JupiterTokenInfo[]>(
    `${base}/tokens/v2/search?query=${encodeURIComponent(query)}`,
    { headers },
  );
}

export async function jupiterGetTokensByMint(mints: string[]): Promise<JupiterTokenInfo[]> {
  if (mints.length === 0) return [];
  if (mints.length > 100) {
    throw new EchoError(
      ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      "Cannot fetch more than 100 tokens at once from Jupiter.",
    );
  }
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  // No /tokens/v2/{mints} endpoint exists — use search with comma-separated mints
  return fetchJson<JupiterTokenInfo[]>(
    `${base}/tokens/v2/search?query=${mints.join(",")}`,
    { headers },
  );
}

// --- Price API ---

export async function jupiterGetPrices(mints: string[]): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const ids = mints.join(",");
  const result = await fetchJson<{ data: Record<string, { price: string }> }>(
    `${base}/price/v3?ids=${ids}`,
    { headers },
  );
  const prices = new Map<string, number>();
  for (const [mint, info] of Object.entries(result.data ?? {})) {
    if (info?.price) prices.set(mint, Number(info.price));
  }
  return prices;
}

// --- Swap API ---

export interface JupiterQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

export async function jupiterGetSwapQuote(
  params: JupiterQuoteRequest,
): Promise<JupiterQuoteResponse> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps ?? 50),
  });
  return fetchJson<JupiterQuoteResponse>(
    `${base}/swap/v1/quote?${qs.toString()}`,
    { headers },
  );
}

export async function jupiterGetSwapTx(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string,
): Promise<string> {
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };
  const body = JSON.stringify({
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  });
  const result = await fetchJson<JupiterSwapResponse>(
    `${base}/swap/v1/swap`,
    { method: "POST", headers, body },
  );
  return result.swapTransaction;
}

type TrendingCategory = "toptrending" | "toptraded" | "toporganicscore" | "recent" | "lst" | "verified";
type TrendingInterval = "5m" | "1h" | "6h" | "24h";

export async function jupiterGetTrendingTokens(
  category: TrendingCategory = "toptrending",
  interval: TrendingInterval = "1h",
  limit = 20,
): Promise<JupiterTokenListEntry[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  let url: string;
  if (category === "lst" || category === "verified") {
    url = `${base}/tokens/v2/tag?query=${category}`;
  } else if (category === "recent") {
    url = `${base}/tokens/v2/recent`;
  } else {
    url = `${base}/tokens/v2/${category}/${interval}`;
  }

  const results = await fetchJson<JupiterTokenListEntry[]>(url, { headers });
  return results.slice(0, limit);
}
