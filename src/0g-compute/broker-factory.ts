/**
 * Cached 0G Compute broker factory.
 *
 * NOTE: The SDK does not export a read-only broker constructor.
 * All operations (including listService) go through the authenticated broker.
 * The `providers` command uses the full broker but only performs contract reads.
 */

import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import type { Hex } from "viem";
import { createBrokerFromKey } from "./sdk-bridge.cjs";
import { withSuppressedConsole } from "./bridge.js";
import { requireWalletAndKeystore } from "../bot/executor.js";
import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { CHAIN } from "../constants/chain.js";
import logger from "../utils/logger.js";

let cachedBroker: ZGComputeNetworkBroker | null = null;

/**
 * Get or create an authenticated 0G Compute Network broker.
 * Cached per-process — the broker is reused for all commands in a single CLI invocation.
 *
 * If privateKey is not provided, reads from the Echo keystore.
 */
export async function getAuthenticatedBroker(privateKey?: Hex): Promise<ZGComputeNetworkBroker> {
  if (cachedBroker) return cachedBroker;

  const key = privateKey ?? requireWalletAndKeystore().privateKey;
  const cfg = loadConfig();

  try {
    const broker = await withSuppressedConsole(() =>
      createBrokerFromKey(key, cfg.chain.rpcUrl)
    );

    // Verify RPC responds with the expected chainId before caching
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(cfg.chain.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const json = (await res.json()) as { result?: string };
      const remoteChainId = json.result ? parseInt(json.result, 16) : undefined;
      if (remoteChainId !== undefined && remoteChainId !== CHAIN.chainId) {
        throw new EchoError(
          ErrorCodes.CHAIN_MISMATCH,
          `RPC chainId mismatch: expected ${CHAIN.chainId} (${CHAIN.name}), got ${remoteChainId}`,
          `Check chain.rpcUrl in your config — it must point to ${CHAIN.name} (chainId ${CHAIN.chainId}).`
        );
      }
    } catch (err) {
      if (err instanceof EchoError) throw err;
      logger.warn(`[0G Compute] Could not verify RPC chainId: ${err instanceof Error ? err.message : String(err)}`);
    }

    cachedBroker = broker;
    logger.debug("[0G Compute] Broker initialized");
    return broker;
  } catch (err) {
    if (err instanceof EchoError) throw err;
    throw new EchoError(
      ErrorCodes.ZG_BROKER_INIT_FAILED,
      `Failed to initialize 0G Compute broker: ${err instanceof Error ? err.message : String(err)}`,
      "Check your network connection and wallet configuration."
    );
  }
}

/** Test-only: reset cached broker. */
export function _resetBrokerCache(): void {
  cachedBroker = null;
}

/** Public reset hook for commands that require a fresh broker snapshot. */
export function resetAuthenticatedBroker(): void {
  cachedBroker = null;
}
