/**
 * Solana RPC connection singleton.
 * Reads from EchoConfig.solana — lazy-initialized on first use.
 */

import { Connection, type Commitment } from "@solana/web3.js";
import { loadConfig } from "../../config/store.js";

let instance: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (instance) return instance;

  const cfg = loadConfig();
  const rpcUrl = cfg.solana.rpcUrl;
  const commitment = (cfg.solana.commitment ?? "confirmed") as Commitment;

  instance = new Connection(rpcUrl, commitment);
  return instance;
}

/** Reset singleton — for tests and after config changes. */
export function resetSolanaConnection(): void {
  instance = null;
}
