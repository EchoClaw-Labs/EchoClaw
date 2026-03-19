/**
 * 0G Storage client config factory.
 * Plain strings only — no ethers objects. SDK calls go through sdk-bridge.cjs.
 */

import { loadConfig } from "../config/store.js";
import { requireWalletAndKeystore } from "../wallet/auth.js";
import type { StorageEndpoints } from "./types.js";

export interface StorageClientConfig {
  endpoints: StorageEndpoints;
  privateKey: string;
  address: string;
}

export function getStorageEndpoints(overrides?: Partial<StorageEndpoints>): StorageEndpoints {
  const cfg = loadConfig();
  return {
    evmRpcUrl: overrides?.evmRpcUrl ?? cfg.services.storageEvmRpcUrl,
    indexerRpcUrl: overrides?.indexerRpcUrl ?? cfg.services.storageIndexerRpcUrl,
    // flowContract: not used by current file upload/download (SDK resolves dynamically).
    // Forward-looking config for KV / batcher flows.
    flowContract: overrides?.flowContract ?? cfg.services.storageFlowContract,
  };
}

export function getStorageClientConfig(overrides?: Partial<StorageEndpoints>): StorageClientConfig {
  const endpoints = getStorageEndpoints(overrides);
  const { address, privateKey } = requireWalletAndKeystore();
  return { endpoints, privateKey, address };
}
