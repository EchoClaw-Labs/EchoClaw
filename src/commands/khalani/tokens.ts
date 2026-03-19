import { Command } from "commander";
import { getCachedKhalaniChains } from "../../khalani/chains.js";
import { getKhalaniClient } from "../../khalani/client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeJsonSuccess, isHeadless } from "../../utils/output.js";
import { printTable, formatAddress, colors } from "../../utils/ui.js";
import { normalizeAddressForFamily, parseChainIdsOption, resolveConfiguredAddress } from "./helpers.js";

function renderTokenTable(title: string, tokens: Array<{
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  extensions?: { balance?: string; price?: { usd?: string } };
}>): void {
  const rows = tokens.map((token) => [
    colors.bold(token.symbol),
    token.name,
    colors.info(String(token.chainId)),
    formatAddress(token.address, 4),
    token.extensions?.balance ?? "-",
    token.extensions?.price?.usd ?? "-",
  ]);

  printTable(
    [
      { header: title, width: 14 },
      { header: "Name", width: 24 },
      { header: "Chain", width: 10 },
      { header: "Address", width: 16 },
      { header: "Balance", width: 18 },
      { header: "USD", width: 12 },
    ],
    rows,
  );
}

export function createTokensSubcommand(): Command {
  const tokens = new Command("tokens")
    .description("Inspect Khalani-backed token discovery and balances");

  tokens
    .command("top")
    .description("List top tokens from Khalani")
    .option("--chain-ids <ids>", "Comma-separated chain IDs or aliases")
    .action(async (options: { chainIds?: string }) => {
      const chains = await getCachedKhalaniChains();
      const chainIds = parseChainIdsOption(options.chainIds, chains);
      const result = await getKhalaniClient().getTopTokens(chainIds);

      if (isHeadless()) {
        writeJsonSuccess({ tokens: result });
        return;
      }

      renderTokenTable("Symbol", result);
    });

  tokens
    .command("search <query>")
    .description("Search Khalani tokens by name, symbol, or address")
    .option("--chain-ids <ids>", "Comma-separated chain IDs or aliases")
    .action(async (query: string, options: { chainIds?: string }) => {
      const chains = await getCachedKhalaniChains();
      const chainIds = parseChainIdsOption(options.chainIds, chains);
      const result = await getKhalaniClient().searchTokens(query, chainIds);

      if (isHeadless()) {
        writeJsonSuccess({ data: result.data });
        return;
      }

      renderTokenTable("Symbol", result.data);
    });

  tokens
    .command("autocomplete <keyword>")
    .description("Semantic token autocomplete from Khalani")
    .option("--chain-ids <ids>", "Comma-separated chain IDs or aliases")
    .option("--limit <n>", "Maximum result count")
    .action(async (keyword: string, options: { chainIds?: string; limit?: string }) => {
      const chains = await getCachedKhalaniChains();
      const chainIds = parseChainIdsOption(options.chainIds, chains);
      const limit = options.limit ? Number(options.limit) : undefined;
      const result = await getKhalaniClient().autocompleteToken(keyword, { chainIds, limit });

      if (isHeadless()) {
        writeJsonSuccess({
          data: result.data,
          parsed: result.parsed ?? null,
          nextSlots: result.nextSlots ?? [],
        });
        return;
      }

      const rows = result.data.map((entry) => [
        entry.description,
        entry.chain.name,
        entry.token.symbol,
        formatAddress(entry.token.address, 4),
        entry.amount ?? "-",
        entry.usdAmount ?? "-",
      ]);

      printTable(
        [
          { header: "Description", width: 34 },
          { header: "Chain", width: 16 },
          { header: "Token", width: 12 },
          { header: "Address", width: 16 },
          { header: "Amount", width: 18 },
          { header: "USD", width: 12 },
        ],
        rows,
      );
    });

  tokens
    .command("balances [address]")
    .description("Get Khalani token balances for an address")
    .option("--wallet <family>", "Configured wallet family fallback: eip155 | solana", "eip155")
    .option("--chain-ids <ids>", "Comma-separated chain IDs or aliases")
    .action(async (address: string | undefined, options: { wallet?: string; chainIds?: string }) => {
      const chains = await getCachedKhalaniChains();
      const family = options.wallet === "solana" ? "solana" : "eip155";
      const fallback = resolveConfiguredAddress(family);
      const targetAddress = address ?? fallback;
      if (!targetAddress) {
        throw new EchoError(
          ErrorCodes.WALLET_NOT_CONFIGURED,
          `No ${family === "solana" ? "Solana" : "EVM"} wallet address configured.`,
          "Pass the address explicitly or configure the matching wallet first."
        );
      }

      const normalizedAddress = normalizeAddressForFamily(targetAddress, family, "address");
      const chainIds = parseChainIdsOption(options.chainIds, chains);
      const result = await getKhalaniClient().getTokenBalances(normalizedAddress, chainIds);

      if (isHeadless()) {
        writeJsonSuccess({ address: normalizedAddress, tokens: result });
        return;
      }

      renderTokenTable("Symbol", result);
    });

  return tokens;
}
