import type { Address } from "viem";

/**
 * Base intent — chain-agnostic fields shared by all transfer intents.
 * Stored as JSON file in ~/.config/echoclaw/intents/<intentId>.json
 */
export interface BaseIntent {
  version: 1;
  intentId: string;
  type: string;
  createdAt: string;
  expiresAt: string;
  note?: string;
}

/**
 * 0G EVM native transfer intent (original pattern).
 */
export interface EvmTransferIntent extends BaseIntent {
  type: "evm-transfer";
  chainId: number;
  rpcUrl: string;
  from: Address;
  to: Address;
  valueWei: string;
  gasLimit: string;
  maxFeePerGas?: string;
  gasPrice?: string;
}

/**
 * Solana native SOL transfer intent.
 */
export interface SolanaTransferIntent extends BaseIntent {
  type: "solana-transfer";
  cluster: string;
  from: string;
  to: string;
  lamports: string;
  amountSol: number;
}

/**
 * Solana SPL token transfer intent.
 */
export interface SolanaSplTransferIntent extends BaseIntent {
  type: "solana-spl-transfer";
  cluster: string;
  from: string;
  to: string;
  mint: string;
  amount: string;
  amountUi: number;
  decimals: number;
  symbol: string;
}

/** Discriminated union of all transfer intent types. */
export type TransferIntent = EvmTransferIntent | SolanaTransferIntent | SolanaSplTransferIntent;

/** Backward-compat alias — existing send.ts uses this name. */
export type SendIntent = EvmTransferIntent;
