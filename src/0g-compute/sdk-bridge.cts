/**
 * CJS bridge module — ethers resolves to lib.commonjs here, matching SDK types.
 * This eliminates the #private nominal type mismatch between ESM and CJS Wallet.
 *
 * All parameters are plain strings — no ethers types cross the ESM/CJS boundary.
 */

import { Wallet, JsonRpcProvider } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

export async function createBrokerFromKey(
  privateKey: string,
  rpcUrl: string
): Promise<ZGComputeNetworkBroker> {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return createZGComputeNetworkBroker(wallet);
}
