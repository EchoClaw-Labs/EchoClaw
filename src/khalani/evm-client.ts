import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { KhalaniChain } from "./types.js";
import { getChainRpcUrl } from "./chains.js";

const EVM_RPC_TIMEOUT_MS = 30_000;
const EVM_RPC_RETRY_COUNT = 2;

function toViemChain(chain: KhalaniChain, rpcUrl: string): Chain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: chain.blockExplorers?.default
      ? {
          default: {
            name: chain.blockExplorers.default.name,
            url: chain.blockExplorers.default.url,
          },
        }
      : undefined,
  };
}

export function createDynamicWalletClient(chain: KhalaniChain, chains: KhalaniChain[], privateKey: Hex) {
  const rpcUrl = getChainRpcUrl(chain.id, chains);
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: toViemChain(chain, rpcUrl),
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  });
}

export function createDynamicPublicClient(chain: KhalaniChain, chains: KhalaniChain[]) {
  const rpcUrl = getChainRpcUrl(chain.id, chains);
  return createPublicClient({
    chain: toViemChain(chain, rpcUrl),
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  });
}
