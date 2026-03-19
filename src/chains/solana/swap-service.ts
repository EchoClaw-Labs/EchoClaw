/**
 * Solana swap service — Jupiter Ultra API.
 * Ultra automatically routes through Raydium, Orca, Meteora and other DEXes.
 * Includes gasless, RFQ, MEV protection, and Juno routing.
 */

import { Keypair } from "@solana/web3.js";
import { resolveToken } from "./token-registry.js";
import {
  jupiterUltraOrder,
  jupiterUltraExecute,
  type UltraOrderResponse,
} from "./jupiter-client.js";
import { deserializeVersionedTx, signVersionedTx } from "./tx.js";
import { solanaExplorerUrl, uiToTokenAmount, tokenAmountToUi } from "./validation.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { SwapQuote, SwapResult } from "../types.js";

export interface SwapOptions {
  slippageBps?: number;
}

export async function getSwapQuote(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
  uiAmount: number,
  opts?: SwapOptions,
): Promise<{ quote: SwapQuote; raw: UltraOrderResponse }> {
  const inputToken = await resolveToken(inputSymbolOrMint);
  if (!inputToken) {
    throw new EchoError(
      ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      `Input token not found: ${inputSymbolOrMint}`,
      "Use a mint address or check spelling. Browse: echoclaw solana browse",
    );
  }

  const outputToken = await resolveToken(outputSymbolOrMint);
  if (!outputToken) {
    throw new EchoError(
      ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      `Output token not found: ${outputSymbolOrMint}`,
      "Use a mint address or check spelling. Browse: echoclaw solana browse",
    );
  }

  const atomicAmount = uiToTokenAmount(uiAmount, inputToken.decimals);

  let raw: UltraOrderResponse;
  try {
    // Quote-only: no taker = no transaction in response
    raw = await jupiterUltraOrder({
      inputMint: inputToken.address,
      outputMint: outputToken.address,
      amount: atomicAmount.toString(),
      slippageBps: opts?.slippageBps,
    });
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(
      ErrorCodes.SOLANA_QUOTE_FAILED,
      `Failed to get swap quote: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (raw.errorCode) {
    throw new EchoError(
      ErrorCodes.SOLANA_QUOTE_FAILED,
      raw.errorMessage ?? `Quote error code: ${raw.errorCode}`,
    );
  }

  const route = raw.routePlan.map((r) => r.swapInfo.label);

  const quote: SwapQuote = {
    inputToken,
    outputToken,
    inputAmount: tokenAmountToUi(raw.inAmount, inputToken.decimals).toString(),
    outputAmount: tokenAmountToUi(raw.outAmount, outputToken.decimals).toString(),
    priceImpactPct: raw.priceImpactPct,
    route,
    provider: `jupiter-ultra (${raw.router})`,
    slippageBps: raw.slippageBps,
  };

  return { quote, raw };
}

export async function executeSwap(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
  uiAmount: number,
  secretKey: Uint8Array,
  opts?: SwapOptions,
): Promise<SwapResult> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const userPublicKey = keypair.publicKey.toBase58();

  const inputToken = await resolveToken(inputSymbolOrMint);
  const outputToken = await resolveToken(outputSymbolOrMint);
  if (!inputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Input token not found: ${inputSymbolOrMint}`);
  if (!outputToken) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Output token not found: ${outputSymbolOrMint}`);

  const atomicAmount = uiToTokenAmount(uiAmount, inputToken.decimals);

  // Step 1: Get order WITH taker (includes transaction)
  let orderResp: UltraOrderResponse;
  try {
    orderResp = await jupiterUltraOrder({
      inputMint: inputToken.address,
      outputMint: outputToken.address,
      amount: atomicAmount.toString(),
      taker: userPublicKey,
      slippageBps: opts?.slippageBps,
    });
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(ErrorCodes.SOLANA_SWAP_FAILED, `Failed to get swap order: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (orderResp.errorCode || !orderResp.transaction) {
    throw new EchoError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      orderResp.errorMessage ?? "No transaction returned from Ultra order",
    );
  }

  // Step 2: Sign the transaction locally
  const tx = deserializeVersionedTx(orderResp.transaction);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  // Step 3: Execute via Jupiter (not direct RPC — Jupiter handles landing + MEV protection)
  let execResp;
  try {
    execResp = await jupiterUltraExecute(signedBase64, orderResp.requestId);
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(ErrorCodes.SOLANA_SWAP_FAILED, `Swap execution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (execResp.status !== "Success") {
    throw new EchoError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `Swap failed (code ${execResp.code}): ${execResp.error ?? "unknown"}`,
    );
  }

  const inputAmountUi = tokenAmountToUi(execResp.inputAmountResult || orderResp.inAmount, inputToken.decimals);
  const outputAmountUi = tokenAmountToUi(execResp.outputAmountResult || orderResp.outAmount, outputToken.decimals);

  return {
    signature: execResp.signature,
    explorerUrl: solanaExplorerUrl(execResp.signature),
    inputAmount: inputAmountUi.toString(),
    outputAmount: outputAmountUi.toString(),
  };
}
