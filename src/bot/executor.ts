/**
 * Bot trade executor — standalone module for buy/sell without UI.
 *
 * Imports from shared modules (quote, abi, wallet, config) but
 * does NOT import from commands/slop.ts to avoid coupling.
 * Minimal helper duplication is intentional (V1).
 */

import {
  type Address,
  type Hex,
  formatUnits,
} from "viem";
import { loadConfig } from "../config/store.js";
import { getPublicClient } from "../wallet/client.js";
import { getSigningClient } from "../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { SLOP_TOKEN_ABI } from "../slop/abi/token.js";
import { SLOP_REGISTRY_ABI } from "../slop/abi/registry.js";
import {
  calculateTokensOut,
  calculateOgOut,
  calculatePartialFill,
  applySlippage,
} from "../slop/quote.js";
import logger from "../utils/logger.js";

// ── Wallet helpers (re-export from shared module) ──────────────

export { requireWalletAndKeystore } from "../wallet/auth.js";


// ── Token state / validation ───────────────────────────────────

export interface TokenState {
  ogReserves: bigint;
  tokenReserves: bigint;
  virtualOgReserves: bigint;
  virtualTokenReserves: bigint;
  k: bigint;
  curveSupply: bigint;
  buyFeeBps: bigint;
  sellFeeBps: bigint;
  isGraduated: boolean;
}

export async function getTokenState(tokenAddr: Address): Promise<TokenState> {
  const client = getPublicClient();

  const [
    ogReserves,
    tokenReserves,
    virtualOgReserves,
    virtualTokenReserves,
    k,
    curveSupply,
    buyFeeBps,
    sellFeeBps,
    isGraduated,
  ] = await Promise.all([
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "ogReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "tokenReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "virtualOgReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "virtualTokenReserves" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "k" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "CURVE_SUPPLY" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "buyFeeBps" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "sellFeeBps" }),
    client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
  ]);

  return {
    ogReserves,
    tokenReserves,
    virtualOgReserves,
    virtualTokenReserves,
    k,
    curveSupply,
    buyFeeBps: BigInt(buyFeeBps),
    sellFeeBps: BigInt(sellFeeBps),
    isGraduated,
  };
}

export async function validateOfficialToken(tokenAddr: Address): Promise<void> {
  const cfg = loadConfig();
  const client = getPublicClient();

  const isValid = await client.readContract({
    address: cfg.slop.tokenRegistry,
    abi: SLOP_REGISTRY_ABI,
    functionName: "isValidToken",
    args: [tokenAddr],
  });

  if (!isValid) {
    throw new EchoError(ErrorCodes.SLOP_TOKEN_NOT_OFFICIAL, `Not an official slop.money token: ${tokenAddr}`);
  }
}

export async function checkNotGraduated(tokenAddr: Address): Promise<void> {
  const client = getPublicClient();
  const isGraduated = await client.readContract({
    address: tokenAddr,
    abi: SLOP_TOKEN_ABI,
    functionName: "isGraduated",
  });

  if (isGraduated) {
    throw new EchoError(ErrorCodes.SLOP_TOKEN_GRADUATED, "Token has graduated - bonding curve trading disabled");
  }
}

export async function checkTradingEnabled(tokenAddr: Address): Promise<void> {
  const client = getPublicClient();
  const isTradingEnabled = await client.readContract({
    address: tokenAddr,
    abi: SLOP_TOKEN_ABI,
    functionName: "isTradingEnabled",
  });

  if (!isTradingEnabled) {
    throw new EchoError(ErrorCodes.SLOP_TRADE_DISABLED, "Trading is disabled for this token");
  }
}

// ── Balance helpers ────────────────────────────────────────────

export async function getTokenBalance(token: Address, wallet: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.readContract({
    address: token,
    abi: SLOP_TOKEN_ABI,
    functionName: "balanceOf",
    args: [wallet],
  });
}

export async function getOgBalance(wallet: Address): Promise<bigint> {
  const client = getPublicClient();
  return client.getBalance({ address: wallet });
}

// ── Trade execution (zero UI) ──────────────────────────────────

export interface TradeResult {
  txHash: Hex;
  explorerUrl: string;
}

/**
 * Execute a buy on the bonding curve.
 * Handles partial fill (graduation cap) via calculatePartialFill.
 */
export async function executeBuy(params: {
  token: Address;
  amountOgWei: bigint;
  slippageBps: number;
  privateKey: Hex;
}): Promise<TradeResult> {
  const { token, amountOgWei, slippageBps, privateKey } = params;
  const cfg = loadConfig();

  await validateOfficialToken(token);
  await checkNotGraduated(token);
  await checkTradingEnabled(token);

  const state = await getTokenState(token);

  // Calculate quote with partial fill awareness
  const quote = calculatePartialFill(
    state.ogReserves,
    state.tokenReserves,
    state.virtualTokenReserves,
    state.curveSupply,
    amountOgWei,
    state.buyFeeBps
  );

  const minTokensOut = applySlippage(quote.tokensOut, BigInt(slippageBps));

  logger.info(
    `[Executor] BUY ${formatUnits(amountOgWei, 18)} 0G → ~${formatUnits(quote.tokensOut, 18)} tokens (min: ${formatUnits(minTokensOut, 18)}, hitCap: ${quote.hitCap})`
  );

  const walletClient = getSigningClient(privateKey);

  const txHash = await walletClient.writeContract({
    address: token,
    abi: SLOP_TOKEN_ABI,
    functionName: "buyWithSlippage",
    args: [minTokensOut],
    value: amountOgWei,
  });

  const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;
  logger.info(`[Executor] BUY tx: ${txHash}`);

  return { txHash, explorerUrl };
}

/**
 * Execute a sell on the bonding curve.
 */
export async function executeSell(params: {
  token: Address;
  amountTokenWei: bigint;
  slippageBps: number;
  privateKey: Hex;
}): Promise<TradeResult> {
  const { token, amountTokenWei, slippageBps, privateKey } = params;
  const cfg = loadConfig();

  await validateOfficialToken(token);
  await checkNotGraduated(token);
  await checkTradingEnabled(token);

  const state = await getTokenState(token);

  let ogOutGross: bigint;
  try {
    ogOutGross = calculateOgOut(state.k, state.ogReserves, state.tokenReserves, amountTokenWei);
  } catch (err) {
    throw new EchoError(
      ErrorCodes.SLOP_QUOTE_FAILED,
      `Sell quote failed: ${err instanceof Error ? err.message : err}`
    );
  }

  const fee = (ogOutGross * state.sellFeeBps) / 10000n;
  const ogOutNet = ogOutGross - fee;
  const minOgOut = applySlippage(ogOutNet, BigInt(slippageBps));

  logger.info(
    `[Executor] SELL ${formatUnits(amountTokenWei, 18)} tokens → ~${formatUnits(ogOutNet, 18)} 0G (min: ${formatUnits(minOgOut, 18)})`
  );

  const walletClient = getSigningClient(privateKey);

  const txHash = await walletClient.writeContract({
    address: token,
    abi: SLOP_TOKEN_ABI,
    functionName: "sellWithSlippage",
    args: [amountTokenWei, minOgOut],
  });

  const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;
  logger.info(`[Executor] SELL tx: ${txHash}`);

  return { txHash, explorerUrl };
}
