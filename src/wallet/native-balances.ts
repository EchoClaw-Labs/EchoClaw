import { formatUnits, getAddress } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ChainFamily, KhalaniChain } from "../khalani/types.js";
import { createDynamicPublicClient } from "../khalani/evm-client.js";

export interface NativeBalanceResult {
  family: ChainFamily;
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  balanceAtomic: string | null;
  balance: string | null;
  error?: string;
}

function uniqueChainIds(values: number[]): number[] {
  return Array.from(new Set(values));
}

function selectNativeChains(
  family: ChainFamily,
  chains: KhalaniChain[],
  opts: { chainIds?: number[]; tokenChainIds?: number[]; preferredChainId?: number },
): KhalaniChain[] {
  if (opts.chainIds && opts.chainIds.length > 0) {
    return chains.filter((chain) => chain.type === family && opts.chainIds?.includes(chain.id));
  }

  const selectedIds = uniqueChainIds([
    ...(opts.tokenChainIds ?? []),
    ...(opts.preferredChainId != null ? [opts.preferredChainId] : []),
  ]);

  if (selectedIds.length > 0) {
    return chains.filter((chain) => chain.type === family && selectedIds.includes(chain.id));
  }

  const fallback = chains.find((chain) => chain.type === family);
  return fallback ? [fallback] : [];
}

async function fetchEvmNativeBalance(
  address: string,
  chain: KhalaniChain,
  chains: KhalaniChain[],
): Promise<NativeBalanceResult> {
  try {
    const client = createDynamicPublicClient(chain, chains);
    const balanceAtomic = await client.getBalance({ address: getAddress(address) });
    return {
      family: "eip155",
      chainId: chain.id,
      chainName: chain.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      balanceAtomic: balanceAtomic.toString(),
      balance: formatUnits(balanceAtomic, chain.nativeCurrency.decimals),
    };
  } catch (err) {
    return {
      family: "eip155",
      chainId: chain.id,
      chainName: chain.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      balanceAtomic: null,
      balance: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchSolanaNativeBalance(address: string, chain: KhalaniChain): Promise<NativeBalanceResult> {
  try {
    const rpcUrl = chain.rpcUrls?.default?.http?.[0];
    if (!rpcUrl) {
      throw new Error(`Chain ${chain.id} does not expose an RPC URL.`);
    }

    const connection = new Connection(rpcUrl, "confirmed");
    const balanceAtomic = await connection.getBalance(new PublicKey(address), "confirmed");
    return {
      family: "solana",
      chainId: chain.id,
      chainName: chain.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      balanceAtomic: balanceAtomic.toString(),
      balance: formatUnits(BigInt(balanceAtomic), chain.nativeCurrency.decimals),
    };
  } catch (err) {
    return {
      family: "solana",
      chainId: chain.id,
      chainName: chain.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      balanceAtomic: null,
      balance: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function collectNativeBalances(
  address: string,
  family: ChainFamily,
  chains: KhalaniChain[],
  opts: { chainIds?: number[]; tokenChainIds?: number[]; preferredChainId?: number } = {},
): Promise<NativeBalanceResult[]> {
  const relevantChains = selectNativeChains(family, chains, opts);

  return Promise.all(relevantChains.map((chain) =>
    family === "solana"
      ? fetchSolanaNativeBalance(address, chain)
      : fetchEvmNativeBalance(address, chain, chains)));
}
