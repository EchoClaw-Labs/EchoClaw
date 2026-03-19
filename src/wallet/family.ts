import { EchoError, ErrorCodes } from "../errors.js";

export type WalletChain = "eip155" | "solana";

export function normalizeWalletChain(input?: string): WalletChain {
  if (!input || input === "eip155" || input === "evm") {
    return "eip155";
  }
  if (input === "solana" || input === "sol") {
    return "solana";
  }

  throw new EchoError(
    ErrorCodes.INVALID_ADDRESS,
    `Unsupported wallet chain: ${input}`,
    "Use --chain eip155 or --chain solana.",
  );
}

export function formatWalletChain(chain: WalletChain, evmChainId?: number): string {
  return chain === "solana" ? "Solana" : `EVM (${evmChainId ?? "configured"})`;
}
