/**
 * Jupiter DCA (Recurring) and Limit (Trigger V1) order service.
 * Wire contracts verified against Jupiter docs 2026-03-14.
 *
 * DCA flow: POST /createOrder → sign → POST /execute → get order address
 * Trigger V1 flow: POST /createOrder → sign+send → done (order in response)
 */

import { Keypair } from "@solana/web3.js";
import { fetchJson } from "../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders, jupiterGetPrices } from "./jupiter-client.js";
import { resolveToken } from "./token-registry.js";
import { signAndSendVersionedTx, deserializeVersionedTx, signVersionedTx } from "./tx.js";
import { uiToTokenAmount } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";

// --- Types (matching actual Jupiter wire format) ---

export interface DcaOrder {
  orderKey: string;
  userPubkey: string;
  inputMint: string;
  outputMint: string;
  inAmountPerCycle: string;
  cycleFrequency: number;
  inDeposited: string;
  inUsed: string;
  outReceived: string;
  createdAt: string;
}

export interface TriggerOrder {
  orderKey: string;
  userPubkey: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  remainingMakingAmount: string;
  remainingTakingAmount: string;
  status: string;
  expiredAt: string | null;
  createdAt: string;
}

type DcaInterval = "minute" | "hour" | "day" | "week" | "month";

const INTERVAL_SECONDS: Record<DcaInterval, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2592000,
};

// --- DCA (Recurring API) ---

export async function createDcaOrder(
  secretKey: Uint8Array,
  inputSymbol: string,
  outputSymbol: string,
  amountPerCycle: number,
  interval: DcaInterval,
  numberOfOrders: number,
): Promise<{ orderKey: string; signature: string }> {
  const inputToken = await resolveToken(inputSymbol);
  const outputToken = await resolveToken(outputSymbol);
  if (!inputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${inputSymbol}`);
  if (!outputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${outputSymbol}`);

  const atomicPerCycle = uiToTokenAmount(amountPerCycle, inputToken.decimals);
  const keypair = Keypair.fromSecretKey(secretKey);
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  // Step 1: Create order — get unsigned tx + requestId
  const createResp = await fetchJson<{ requestId: string; transaction: string }>(
    `${base}/recurring/v1/createOrder`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        user: keypair.publicKey.toBase58(),
        inputMint: inputToken.address,
        outputMint: outputToken.address,
        params: {
          time: {
            inAmount: Number(atomicPerCycle),
            numberOfOrders,
            interval: INTERVAL_SECONDS[interval],
          },
        },
      }),
    },
  );

  // Step 2: Sign the transaction locally
  const tx = deserializeVersionedTx(createResp.transaction);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  // Step 3: Execute — submit signed tx to Jupiter, get real order address
  const execResp = await fetchJson<{ status: string; signature: string; order: string | null; error: string | null }>(
    `${base}/recurring/v1/execute`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        requestId: createResp.requestId,
        signedTransaction: signedBase64,
      }),
    },
  );

  if (execResp.status !== "Success" || !execResp.order) {
    throw new EchoError(
      ErrorCodes.SOLANA_ORDER_FAILED,
      `DCA creation failed: ${execResp.error ?? "unknown error"}`,
    );
  }

  return { orderKey: execResp.order, signature: execResp.signature };
}

export async function listDcaOrders(walletAddress: string): Promise<DcaOrder[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  try {
    const result = await fetchJson<{ time?: DcaOrder[] }>(
      `${base}/recurring/v1/getRecurringOrders?user=${walletAddress}&recurringType=time&orderStatus=active&page=1&includeFailedTx=false`,
      { headers },
    );
    return result.time ?? [];
  } catch {
    return [];
  }
}

export async function cancelDcaOrder(
  secretKey: Uint8Array,
  orderKey: string,
): Promise<string> {
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };
  const keypair = Keypair.fromSecretKey(secretKey);

  const resp = await fetchJson<{ requestId: string; transaction: string }>(
    `${base}/recurring/v1/cancelOrder`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        user: keypair.publicKey.toBase58(),
        order: orderKey,
        recurringType: "time",
      }),
    },
  );

  // Sign + execute cancel
  const tx = deserializeVersionedTx(resp.transaction);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  const execResp = await fetchJson<{ status: string; signature: string; error: string | null }>(
    `${base}/recurring/v1/execute`,
    {
      method: "POST", headers,
      body: JSON.stringify({ requestId: resp.requestId, signedTransaction: signedBase64 }),
    },
  );

  if (execResp.status !== "Success") {
    throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, `DCA cancel failed: ${execResp.error ?? "unknown"}`);
  }

  return execResp.signature;
}

// --- Limit Orders (Trigger V1) ---

export async function createLimitOrder(
  secretKey: Uint8Array,
  inputSymbol: string,
  outputSymbol: string,
  inputAmount: number,
  targetPriceUsd: number,
): Promise<{ orderKey: string; signature: string }> {
  const inputToken = await resolveToken(inputSymbol);
  const outputToken = await resolveToken(outputSymbol);
  if (!inputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${inputSymbol}`);
  if (!outputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${outputSymbol}`);

  const atomicInput = uiToTokenAmount(inputAmount, inputToken.decimals);
  const keypair = Keypair.fromSecretKey(secretKey);

  // Calculate takingAmount from targetPrice
  const prices = await jupiterGetPrices([inputToken.address]);
  const inputPriceUsd = prices.get(inputToken.address);
  if (!inputPriceUsd) {
    throw new EchoError(ErrorCodes.SOLANA_QUOTE_FAILED, `Cannot fetch price for ${inputSymbol}`);
  }
  const outputUiAmount = (inputAmount * inputPriceUsd) / targetPriceUsd;
  const atomicOutput = uiToTokenAmount(outputUiAmount, outputToken.decimals);

  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  // Trigger V1: params wraps makingAmount/takingAmount (verified 2026-03-14)
  const createResp = await fetchJson<{ requestId: string; transaction: string; order: string }>(
    `${base}/trigger/v1/createOrder`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        inputMint: inputToken.address,
        outputMint: outputToken.address,
        maker: keypair.publicKey.toBase58(),
        payer: keypair.publicKey.toBase58(),
        params: {
          makingAmount: atomicInput.toString(),
          takingAmount: atomicOutput.toString(),
        },
        computeUnitPrice: "auto",
        wrapAndUnwrapSol: true,
      }),
    },
  );

  // Sign locally, then submit via /trigger/v1/execute (not direct RPC send)
  const tx = deserializeVersionedTx(createResp.transaction);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  const execResp = await fetchJson<{ signature: string; status: string }>(
    `${base}/trigger/v1/execute`,
    {
      method: "POST", headers,
      body: JSON.stringify({ signedTransaction: signedBase64, requestId: createResp.requestId }),
    },
  );

  if (execResp.status !== "Success") {
    throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Trigger execute failed");
  }

  return { orderKey: createResp.order, signature: execResp.signature };
}

export async function listLimitOrders(walletAddress: string): Promise<TriggerOrder[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  try {
    // Response is { orders: [...], user, totalPages, page }, NOT a raw array
    const result = await fetchJson<{ orders: TriggerOrder[] }>(
      `${base}/trigger/v1/getTriggerOrders?user=${walletAddress}&orderStatus=active&page=1&includeFailedTx=false`,
      { headers },
    );
    return result.orders ?? [];
  } catch {
    return [];
  }
}

export async function cancelLimitOrder(
  secretKey: Uint8Array,
  orderKey: string,
): Promise<string> {
  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };
  const keypair = Keypair.fromSecretKey(secretKey);

  const resp = await fetchJson<{ requestId: string; transaction: string }>(
    `${base}/trigger/v1/cancelOrder`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        maker: keypair.publicKey.toBase58(),
        order: orderKey,
        computeUnitPrice: "auto",
      }),
    },
  );

  // Sign + execute via Jupiter (not direct RPC)
  const cancelTx = deserializeVersionedTx(resp.transaction);
  signVersionedTx(cancelTx, [keypair]);
  const signedBase64 = Buffer.from(cancelTx.serialize()).toString("base64");

  const execResp = await fetchJson<{ signature: string; status: string }>(
    `${base}/trigger/v1/execute`,
    {
      method: "POST", headers,
      body: JSON.stringify({ signedTransaction: signedBase64, requestId: resp.requestId }),
    },
  );

  return execResp.signature;
}
