/**
 * Solana address and amount validation utilities.
 */

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { loadConfig } from "../../config/store.js";

export function validateSolanaAddress(addr: string): string {
  try {
    const pubkey = new PublicKey(addr);
    if (!PublicKey.isOnCurve(pubkey)) {
      // Off-curve addresses are valid (PDAs), but warn-worthy in some contexts
    }
    return pubkey.toBase58();
  } catch {
    throw new EchoError(
      ErrorCodes.SOLANA_INVALID_ADDRESS,
      `Invalid Solana address: ${addr}`,
      "Provide a valid base58-encoded Solana public key.",
    );
  }
}

export function parseSolAmount(value: string): { lamports: bigint; ui: number } {
  const ui = Number(value);
  if (Number.isNaN(ui) || ui < 0) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `Invalid SOL amount: ${value}`,
      "Amount must be a non-negative number.",
    );
  }
  if (ui > 1_000_000_000) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `SOL amount too large: ${value}`,
    );
  }
  const lamports = BigInt(Math.round(ui * LAMPORTS_PER_SOL));
  return { lamports, ui };
}

export function parseSplAmount(value: string, decimals: number): { atomic: bigint; ui: number } {
  const ui = Number(value);
  if (Number.isNaN(ui) || ui < 0) {
    throw new EchoError(
      ErrorCodes.SOLANA_INSUFFICIENT_BALANCE,
      `Invalid token amount: ${value}`,
      "Amount must be a non-negative number.",
    );
  }
  const atomic = BigInt(Math.round(ui * 10 ** decimals));
  return { atomic, ui };
}

export function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

export function tokenAmountToUi(rawAmount: string | bigint, decimals: number): number {
  return Number(BigInt(rawAmount)) / 10 ** decimals;
}

export function uiToTokenAmount(uiAmount: number, decimals: number): bigint {
  return BigInt(Math.round(uiAmount * 10 ** decimals));
}

export function solanaExplorerUrl(
  hashOrAddress: string,
  type: "tx" | "address" = "tx",
): string {
  const cfg = loadConfig();
  const base = cfg.solana?.explorerUrl ?? "https://explorer.solana.com";
  const clusterParam = cfg.solana?.cluster && cfg.solana.cluster !== "mainnet-beta"
    ? `?cluster=${cfg.solana.cluster}`
    : "";
  return `${base}/${type}/${hashOrAddress}${clusterParam}`;
}

export function shortenSolanaAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}
