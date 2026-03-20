import { loadConfig } from "../../config/store.js";
import { getCachedKhalaniChains } from "../../khalani/chains.js";
import type { KhalaniChain } from "../../khalani/types.js";
import { buildEchoSnapshot } from "./snapshot.js";
import { collectNativeBalances } from "../../wallet/native-balances.js";

export interface WalletNativeBalanceView {
  address: string | null;
  configured: boolean;
  chainId: number | null;
  chainName: string | null;
  symbol: string | null;
  balance: string | null;
  error: string | null;
}

export interface WalletViewData {
  wallet: Awaited<ReturnType<typeof buildEchoSnapshot>>["wallet"];
  balances: {
    evm: WalletNativeBalanceView;
    solana: WalletNativeBalanceView;
  };
  refreshedAt: string;
}

function emptyBalance(address: string | null): WalletNativeBalanceView {
  return {
    address,
    configured: Boolean(address),
    chainId: null,
    chainName: null,
    symbol: null,
    balance: null,
    error: null,
  };
}

function unavailableBalance(address: string | null, chain: KhalaniChain | null, error: string): WalletNativeBalanceView {
  return {
    address,
    configured: Boolean(address),
    chainId: chain?.id ?? null,
    chainName: chain?.name ?? null,
    symbol: chain?.nativeCurrency.symbol ?? null,
    balance: null,
    error,
  };
}

async function buildEvmBalance(
  address: string | null,
  chains: KhalaniChain[] | null,
  chainId: number,
): Promise<WalletNativeBalanceView> {
  if (!address) return emptyBalance(null);
  if (!chains) return unavailableBalance(address, null, "Chain metadata unavailable.");

  const chain = chains.find((entry) => entry.type === "eip155" && entry.id === chainId) ?? null;
  if (!chain) {
    return unavailableBalance(address, null, `Configured EVM chain ${chainId} is not available.`);
  }

  const [balance] = await collectNativeBalances(address, "eip155", chains, { chainIds: [chain.id] });
  if (!balance) {
    return unavailableBalance(address, chain, "Unable to read native balance.");
  }

  return {
    address,
    configured: true,
    chainId: balance.chainId,
    chainName: balance.chainName,
    symbol: balance.symbol,
    balance: balance.balance,
    error: balance.error ?? null,
  };
}

async function buildSolanaBalance(
  address: string | null,
  chains: KhalaniChain[] | null,
  solanaRpcUrl: string,
): Promise<WalletNativeBalanceView> {
  if (!address) return emptyBalance(null);
  if (!chains) return unavailableBalance(address, null, "Chain metadata unavailable.");

  const chain = chains.find((entry) => entry.type === "solana") ?? null;
  if (!chain) {
    return unavailableBalance(address, null, "Solana chain metadata is not available.");
  }

  const [balance] = await collectNativeBalances(address, "solana", chains, {
    chainIds: [chain.id],
    solanaRpcUrl,
  });

  if (!balance) {
    return unavailableBalance(address, chain, "Unable to read native balance.");
  }

  return {
    address,
    configured: true,
    chainId: balance.chainId,
    chainName: balance.chainName,
    symbol: balance.symbol,
    balance: balance.balance,
    error: balance.error ?? null,
  };
}

export async function buildWalletView(opts?: { fresh?: boolean }): Promise<WalletViewData> {
  const snapshot = await buildEchoSnapshot({ includeReadiness: false, fresh: opts?.fresh });
  const cfg = loadConfig();

  let chains: KhalaniChain[] | null = null;
  try {
    chains = await getCachedKhalaniChains();
  } catch {
    chains = null;
  }

  const [evm, solana] = await Promise.all([
    buildEvmBalance(snapshot.wallet.evmAddress, chains, cfg.chain.chainId),
    buildSolanaBalance(snapshot.wallet.solanaAddress, chains, cfg.solana.rpcUrl),
  ]);

  return {
    wallet: snapshot.wallet,
    balances: { evm, solana },
    refreshedAt: new Date().toISOString(),
  };
}
