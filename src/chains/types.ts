/**
 * Shared multichain types for chain adapters.
 * Designed for extension: Solana first, then EVM DEXes, DexScreener, Hyperliquid.
 */

import type { ChainFamily } from "../khalani/types.js";

export interface TokenMetadata {
  chain: ChainFamily;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

export interface SwapQuote {
  inputToken: TokenMetadata;
  outputToken: TokenMetadata;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: string;
  route: string[];
  provider: string;
  slippageBps: number;
}

export interface SwapResult {
  signature: string;
  explorerUrl: string;
  inputAmount: string;
  outputAmount: string;
}

export interface TransferResult {
  signature: string;
  explorerUrl: string;
}
