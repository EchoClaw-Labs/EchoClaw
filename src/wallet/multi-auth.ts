import type { Address, Hex } from "viem";
import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { requireKeystorePassword } from "../utils/env.js";
import { requireWalletAndKeystore } from "./auth.js";
import { decryptSolanaSecretKey, deriveSolanaAddress, loadSolanaKeystore } from "./solana-keystore.js";
import type { ChainFamily } from "../khalani/types.js";

export interface EvmWallet {
  family: "eip155";
  address: Address;
  privateKey: Hex;
}

export interface SolanaWallet {
  family: "solana";
  address: string;
  secretKey: Uint8Array;
}

export type ChainWallet = EvmWallet | SolanaWallet;

export function requireEvmWallet(): EvmWallet {
  const { address, privateKey } = requireWalletAndKeystore();
  return { family: "eip155", address, privateKey };
}

export function requireSolanaWallet(): SolanaWallet {
  const cfg = loadConfig();
  if (!cfg.wallet.solanaAddress) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No Solana wallet configured.",
      "Run: echoclaw wallet create --chain solana",
    );
  }

  const keystore = loadSolanaKeystore();
  if (!keystore) {
    throw new EchoError(
      ErrorCodes.KHALANI_SOLANA_KEYSTORE_NOT_FOUND,
      "Solana keystore not found.",
      "Run: echoclaw wallet create --chain solana",
    );
  }

  const secretKey = decryptSolanaSecretKey(keystore, requireKeystorePassword());
  const derivedAddress = deriveSolanaAddress(secretKey);
  if (derivedAddress !== cfg.wallet.solanaAddress) {
    throw new EchoError(
      ErrorCodes.KHALANI_ADDRESS_MISMATCH,
      "Configured Solana address does not match the keystore.",
      "Run: echoclaw wallet ensure to refresh saved addresses.",
    );
  }

  return { family: "solana", address: derivedAddress, secretKey };
}

export function requireWalletForChain(family: ChainFamily): ChainWallet {
  return family === "solana" ? requireSolanaWallet() : requireEvmWallet();
}
