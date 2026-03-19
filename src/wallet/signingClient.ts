import { createWalletClient, http } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config/store.js";

export function getSigningClient(privateKey: Hex) {
  const cfg = loadConfig();
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: {
      id: cfg.chain.chainId,
      name: "0G",
      nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
      rpcUrls: { default: { http: [cfg.chain.rpcUrl] } },
    },
    transport: http(cfg.chain.rpcUrl, { timeout: 30_000, retryCount: 2 }),
  });
}
