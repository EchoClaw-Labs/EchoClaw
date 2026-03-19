/**
 * Jupiter Prediction Markets service.
 * Binary prediction trading — YES/NO contracts on real-world events.
 * Geo-restricted: US and South Korea IPs blocked.
 * Response shapes verified against live API 2026-03-14.
 */

import { Keypair } from "@solana/web3.js";
import { fetchJson } from "../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders } from "./jupiter-client.js";
import { signAndSendVersionedTx } from "./tx.js";
import { solanaExplorerUrl } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { TransferResult } from "../types.js";

const PREDICT_BASE = "/prediction/v1";

// --- Normalized types (mapped from API wire format) ---

export interface PredictEvent {
  id: string;
  title: string;
  category: string;
  status: string;
  markets?: PredictMarket[];
}

export interface PredictMarket {
  marketId: string;
  title: string;
  status: string;
  result: string;
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  volume: number;
}

export interface PredictPosition {
  pubkey: string;
  marketId: string;
  isYes: boolean;
  contracts: number;
  totalCostUsd: number;
  valueUsd: number;
  pnlUsd: number;
  pnlUsdPercent: number;
  claimable: boolean;
}

// --- Wire format types (what API actually returns) ---

interface ApiEvent {
  eventId?: string;
  id?: string;
  title?: string;
  metadata?: { title?: string };
  category?: string;
  isActive?: boolean;
  isLive?: boolean;
  status?: string;
  markets?: ApiMarket[];
}

interface ApiMarket {
  marketId?: string;
  id?: string;
  title?: string;
  metadata?: { title?: string };
  status?: string;
  result?: string;
  pricing?: {
    buyYesPriceUsd?: number;
    buyNoPriceUsd?: number;
    volume?: number;
  };
  buyYesPriceUsd?: number;
  buyNoPriceUsd?: number;
  volume?: number;
}

function normalizeEvent(e: ApiEvent): PredictEvent {
  const status = e.status ?? (e.isLive ? "live" : e.isActive ? "active" : "unknown");
  return {
    id: e.eventId ?? e.id ?? "",
    title: e.metadata?.title ?? e.title ?? "",
    category: e.category ?? "",
    status,
    markets: e.markets?.map(normalizeMarket),
  };
}

function normalizeMarket(m: ApiMarket): PredictMarket {
  return {
    marketId: m.marketId ?? m.id ?? "",
    title: m.metadata?.title ?? m.title ?? "",
    status: m.status ?? "",
    result: m.result ?? "",
    buyYesPriceUsd: m.pricing?.buyYesPriceUsd ?? m.buyYesPriceUsd ?? 0,
    buyNoPriceUsd: m.pricing?.buyNoPriceUsd ?? m.buyNoPriceUsd ?? 0,
    volume: m.pricing?.volume ?? m.volume ?? 0,
  };
}

// --- API methods ---

export async function listEvents(
  category?: string,
  filter?: "trending" | "live" | "new",
): Promise<PredictEvent[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (filter) params.set("filter", filter);
  params.set("includeMarkets", "true");

  // Response: { data: ApiEvent[] } — NOT a raw array
  const result = await fetchJson<{ data: ApiEvent[] }>(
    `${base}${PREDICT_BASE}/events?${params}`,
    { headers },
  );
  return (result.data ?? []).map(normalizeEvent);
}

export async function searchEvents(query: string): Promise<PredictEvent[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  const result = await fetchJson<{ data: ApiEvent[] }>(
    `${base}${PREDICT_BASE}/events/search?query=${encodeURIComponent(query)}`,
    { headers },
  );
  return (result.data ?? []).map(normalizeEvent);
}

export async function getMarket(marketId: string): Promise<PredictMarket> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const raw = await fetchJson<ApiMarket>(`${base}${PREDICT_BASE}/markets/${marketId}`, { headers });
  return normalizeMarket(raw);
}

export async function createPredictOrder(
  secretKey: Uint8Array,
  marketId: string,
  isYes: boolean,
  amountUsdc: number,
): Promise<{ signature: string; positionPubkey: string }> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const depositAmount = Math.round(amountUsdc * 1_000_000);

  const resp = await fetchJson<{
    transaction: string;
    order: { positionPubkey: string };
  }>(
    `${base}${PREDICT_BASE}/orders`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        ownerPubkey: keypair.publicKey.toBase58(),
        marketId,
        isYes,
        isBuy: true,
        depositAmount,
        depositMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature, positionPubkey: resp.order.positionPubkey };
}

export async function getPositions(address: string): Promise<PredictPosition[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  try {
    // Response: { data: [...], pagination: {...} } — NOT a raw array
    const result = await fetchJson<{ data: PredictPosition[] }>(
      `${base}${PREDICT_BASE}/positions?ownerPubkey=${address}`,
      { headers },
    );
    return result.data ?? [];
  } catch {
    return [];
  }
}

export async function claimPosition(
  secretKey: Uint8Array,
  positionPubkey: string,
): Promise<TransferResult> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}${PREDICT_BASE}/positions/${positionPubkey}/claim`,
    {
      method: "POST", headers,
      body: JSON.stringify({ ownerPubkey: keypair.publicKey.toBase58() }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function closePosition(
  secretKey: Uint8Array,
  positionPubkey: string,
): Promise<TransferResult> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}${PREDICT_BASE}/positions/${positionPubkey}`,
    {
      method: "DELETE", headers,
      body: JSON.stringify({ ownerPubkey: keypair.publicKey.toBase58() }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}
