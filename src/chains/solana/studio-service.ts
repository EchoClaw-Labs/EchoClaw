/**
 * Jupiter Studio service — token creation with Dynamic Bonding Curves.
 * Create tokens, manage fees, configure DBC parameters.
 */

import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { fetchJson, fetchWithTimeout } from "../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders } from "./jupiter-client.js";
import { loadConfig } from "../../config/store.js";
import { solanaExplorerUrl } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { TransferResult } from "../types.js";

export interface StudioCreateParams {
  tokenName: string;
  tokenSymbol: string;
  imagePath: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  initialMarketCap: number;
  migrationMarketCap: number;
  feeBps?: number;
  isLpLocked?: boolean;
}

export interface StudioFeeInfo {
  totalFees: string;
  unclaimedFees: string;
  poolAddress: string;
}

export async function studioCreateToken(
  secretKey: Uint8Array,
  params: StudioCreateParams,
): Promise<{ mint: string; signature: string | null; explorerUrl: string | null }> {
  // Studio requires API key — endpoints 404 on lite-api
  if (!loadConfig().solana.jupiterApiKey) {
    throw new EchoError(
      ErrorCodes.SOLANA_STUDIO_CREATE_FAILED,
      "Jupiter API key required for Studio.",
      "Run: echoclaw config set-jupiter-key <key> (get key at https://portal.jup.ag)",
    );
  }

  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  // Step 1: Get creation transaction + presigned URLs
  const createResp = await fetchJson<{
    transaction: string;
    mint: string;
    imagePresignedUrl: string;
    metadataPresignedUrl: string;
    imageUrl: string;
  }>(
    `${base}/studio/v1/dbc-pool/create-tx`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        buildCurveByMarketCapParam: {
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
          initialMarketCap: params.initialMarketCap,
          migrationMarketCap: params.migrationMarketCap,
          tokenQuoteDecimal: 6,
        },
        fee: { feeBps: params.feeBps ?? 100 },
        isLpLocked: params.isLpLocked ?? true,
        tokenName: params.tokenName,
        tokenSymbol: params.tokenSymbol,
        tokenImageContentType: "image/png",
        creator: keypair.publicKey.toBase58(),
      }),
    },
  );

  // Step 2: Upload image to presigned URL
  const imageData = readFileSync(params.imagePath);
  const imgResp = await fetchWithTimeout(createResp.imagePresignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: imageData,
  });
  if (!imgResp.ok) {
    throw new EchoError(ErrorCodes.SOLANA_STUDIO_CREATE_FAILED, `Image upload failed: ${imgResp.status}`);
  }

  // Step 3: Upload metadata to presigned URL
  const metaResp = await fetchWithTimeout(createResp.metadataPresignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.tokenName,
      symbol: params.tokenSymbol,
      description: params.description ?? "",
      image: createResp.imageUrl,
      website: params.website ?? "",
      twitter: params.twitter ?? "",
      telegram: params.telegram ?? "",
    }),
  });
  if (!metaResp.ok) {
    throw new EchoError(ErrorCodes.SOLANA_STUDIO_CREATE_FAILED, `Metadata upload failed: ${metaResp.status}`);
  }

  // Step 4: Sign the creation transaction locally (get signed bytes for submit)
  const { deserializeVersionedTx, signVersionedTx } = await import("./tx.js");
  const tx = deserializeVersionedTx(createResp.transaction);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  // Step 5: Submit SIGNED tx + metadata to Jupiter (Jupiter lands the tx, not us)
  const formData = new FormData();
  formData.append("transaction", signedBase64);
  formData.append("owner", keypair.publicKey.toBase58());
  formData.append("content", params.description ?? "");
  if (params.imagePath) {
    formData.append("headerImage", new Blob([readFileSync(params.imagePath)]));
  }

  const submitResp = await fetchWithTimeout(`${base}/studio/v1/dbc-pool/submit`, {
    method: "POST",
    body: formData,
  });
  if (!submitResp.ok) {
    throw new EchoError(ErrorCodes.SOLANA_STUDIO_CREATE_FAILED, `Studio submit failed: ${submitResp.status}`);
  }

  let signature: string | null = null;
  try {
    const submitResult = await submitResp.json() as { signature?: string };
    if (submitResult.signature) {
      signature = submitResult.signature;
    }
  } catch {
    // Submit may not return JSON — token is still created via the on-chain tx
  }

  return {
    mint: createResp.mint,
    signature,
    explorerUrl: signature ? solanaExplorerUrl(signature) : null,
  };
}

export async function studioGetFees(mint: string): Promise<StudioFeeInfo> {
  if (!loadConfig().solana.jupiterApiKey) {
    throw new EchoError(ErrorCodes.SOLANA_STUDIO_CLAIM_FAILED, "Jupiter API key required for Studio.", "Run: echoclaw config set-jupiter-key <key>");
  }
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  return fetchJson<StudioFeeInfo>(
    `${base}/studio/v1/dbc/fee`,
    {
      method: "POST", headers,
      body: JSON.stringify({ mint }),
    },
  );
}

export async function studioClaimFees(
  secretKey: Uint8Array,
  poolAddress: string,
  maxAmount?: string,
): Promise<TransferResult> {
  if (!loadConfig().solana.jupiterApiKey) {
    throw new EchoError(ErrorCodes.SOLANA_STUDIO_CLAIM_FAILED, "Jupiter API key required for Studio.", "Run: echoclaw config set-jupiter-key <key>");
  }
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ transaction: string }>(
    `${base}/studio/v1/dbc/fee/create-tx`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        ownerWallet: keypair.publicKey.toBase58(),
        poolAddress,
        ...(maxAmount ? { maxQuoteAmount: maxAmount } : {}),
      }),
    },
  );

  const { signAndSendVersionedTx } = await import("./tx.js");
  const claimSig = await signAndSendVersionedTx(resp.transaction, [keypair]);
  return { signature: claimSig, explorerUrl: solanaExplorerUrl(claimSig) };
}
