/**
 * Jupiter Lend Earn service — deposit, withdraw, rates, positions.
 * Wire contracts verified against live API 2026-03-14.
 */

import { Keypair } from "@solana/web3.js";
import { fetchJson } from "../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders } from "./jupiter-client.js";
import { signAndSendVersionedTx } from "./tx.js";
import { solanaExplorerUrl } from "./validation.js";
import type { TransferResult } from "../types.js";

const LEND_BASE = "/lend/v1/earn";

// --- Normalized types (mapped from API wire format) ---

export interface LendToken {
  address: string;
  assetAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  totalAssets: string;
  totalSupply: string;
  supplyRate: number;
  rewardsRate: number;
  totalRate: number;
}

export interface LendPosition {
  ownerAddress: string;
  tokenSymbol: string;
  tokenAddress: string;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
}

// --- Wire format types ---

interface ApiLendToken {
  id?: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  assetAddress: string;
  totalAssets: string;
  totalSupply: string;
  supplyRate: string | number;
  rewardsRate: string | number;
  totalRate?: string | number;
}

interface ApiLendPosition {
  ownerAddress: string;
  token: {
    id?: string;
    address: string;
    symbol: string;
    name: string;
  };
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance?: string;
}

function toNumber(val: string | number): number {
  return typeof val === "string" ? Number.parseFloat(val) || 0 : val;
}

// --- API methods ---

export async function getLendRates(): Promise<LendToken[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const raw = await fetchJson<ApiLendToken[]>(`${base}${LEND_BASE}/tokens`, { headers });

  return raw.map((t) => ({
    address: t.address,
    assetAddress: t.assetAddress,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    totalAssets: t.totalAssets,
    totalSupply: t.totalSupply,
    supplyRate: toNumber(t.supplyRate),
    rewardsRate: toNumber(t.rewardsRate),
    totalRate: toNumber(t.totalRate ?? 0),
  }));
}

export async function getLendPositions(address: string): Promise<LendPosition[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();
  const raw = await fetchJson<ApiLendPosition[]>(`${base}${LEND_BASE}/positions?users=${address}`, { headers });

  return raw.map((p) => ({
    ownerAddress: p.ownerAddress,
    tokenSymbol: p.token.symbol,
    tokenAddress: p.token.address,
    shares: p.shares,
    underlyingAssets: p.underlyingAssets,
    underlyingBalance: p.underlyingBalance,
  }));
}

export async function lendDeposit(
  secretKey: Uint8Array,
  asset: string,
  amount: string,
): Promise<TransferResult> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}${LEND_BASE}/deposit`,
    {
      method: "POST", headers,
      body: JSON.stringify({ asset, amount, signer: keypair.publicKey.toBase58() }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function lendWithdraw(
  secretKey: Uint8Array,
  asset: string,
  amount: string,
): Promise<TransferResult> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}${LEND_BASE}/withdraw`,
    {
      method: "POST", headers,
      body: JSON.stringify({ asset, amount, signer: keypair.publicKey.toBase58() }),
    },
  );

  const signature = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}
