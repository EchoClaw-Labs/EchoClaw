import { Command } from "commander";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { getCachedKhalaniChains } from "../../khalani/chains.js";
import { getKhalaniClient } from "../../khalani/client.js";
import type { ChainFamily, KhalaniToken } from "../../khalani/types.js";
import { collectNativeBalances } from "../../wallet/native-balances.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { colors, infoBox, printTable } from "../../utils/ui.js";
import { parseChainIdsOption } from "../khalani/helpers.js";

type WalletSelector = "eip155" | "solana" | "all";

function parseWalletSelector(value?: string): WalletSelector {
  if (!value || value === "all") return "all";
  if (value === "eip155" || value === "evm") return "eip155";
  if (value === "solana" || value === "sol") return "solana";
  throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Unsupported wallet selector: ${value}`, "Use --wallet eip155, --wallet solana, or --wallet all.");
}

function resolveConfiguredWallets(selector: WalletSelector, cfg = loadConfig()): Array<{ family: ChainFamily; address: string }> {
  const wallets: Array<{ family: ChainFamily; address: string }> = [];

  if ((selector === "eip155" || selector === "all") && cfg.wallet.address) {
    wallets.push({ family: "eip155", address: cfg.wallet.address });
  }
  if ((selector === "solana" || selector === "all") && cfg.wallet.solanaAddress) {
    wallets.push({ family: "solana", address: cfg.wallet.solanaAddress });
  }

  if (wallets.length === 0) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      selector === "solana" ? "No Solana wallet configured." : selector === "eip155" ? "No EVM wallet configured." : "No wallets configured.",
      "Run: echoclaw wallet ensure --json",
    );
  }

  return wallets;
}

export function createBalancesSubcommand(): Command {
  return new Command("balances")
    .description("Aggregate Khalani-backed balances across configured wallets")
    .option("--wallet <family>", "Wallet selection: eip155 | solana | all", "all")
    .option("--chain-ids <ids>", "Comma-separated chain IDs or aliases")
    .action(async (options: { wallet?: string; chainIds?: string }) => {
      const walletSelector = parseWalletSelector(options.wallet);
      const cfg = loadConfig();
      const wallets = resolveConfiguredWallets(walletSelector, cfg);
      const chains = await getCachedKhalaniChains();
      const chainIds = parseChainIdsOption(options.chainIds, chains);

      const balances = await Promise.all(
        wallets.map(async (wallet) => {
          const tokens = await getKhalaniClient().getTokenBalances(wallet.address, chainIds);
          const nativeBalances = await collectNativeBalances(wallet.address, wallet.family, chains, {
            chainIds,
            tokenChainIds: tokens.map((token) => token.chainId),
            preferredChainId: wallet.family === "eip155" ? cfg.chain.chainId : undefined,
          });

          return {
            ...wallet,
            tokens,
            nativeBalances,
          };
        }),
      );

      if (isHeadless()) {
        writeJsonSuccess({ wallet: walletSelector, balances });
        return;
      }

      const tokenRows = balances.flatMap((wallet) =>
        wallet.tokens.map((token: KhalaniToken) => [
          wallet.family === "solana" ? "Solana" : "EVM",
          colors.address(wallet.address),
          "token",
          token.symbol,
          token.name,
          String(token.chainId),
          token.extensions?.balance ?? "-",
          token.extensions?.price?.usd ?? "-",
        ]),
      );
      const nativeRows = balances.flatMap((wallet) =>
        wallet.nativeBalances.map((nativeBalance) => [
          wallet.family === "solana" ? "Solana" : "EVM",
          colors.address(wallet.address),
          "native",
          nativeBalance.symbol,
          nativeBalance.chainName,
          String(nativeBalance.chainId),
          nativeBalance.balance ?? "-",
          nativeBalance.error ?? "-",
        ]),
      );
      const rows = [...nativeRows, ...tokenRows];

      if (rows.length === 0) {
        infoBox("Wallet Balances", "Khalani returned no token balances for the selected wallet scope.");
        return;
      }

      printTable(
        [
          { header: "Wallet", width: 10 },
          { header: "Owner", width: 24 },
          { header: "Type", width: 10 },
          { header: "Symbol", width: 12 },
          { header: "Name", width: 24 },
          { header: "Chain", width: 10 },
          { header: "Balance", width: 18 },
          { header: "USD / Error", width: 18 },
        ],
        rows,
      );
    });
}
