import { Command } from "commander";
import { writeJsonSuccess, isHeadless } from "../../utils/output.js";
import { printTable, colors } from "../../utils/ui.js";
import { clearKhalaniChainsCache, getCachedKhalaniChains } from "../../khalani/chains.js";
import { formatChainFamily } from "./helpers.js";

export function createChainsSubcommand(): Command {
  return new Command("chains")
    .description("List supported Khalani chains")
    .option("--refresh", "Refresh the in-memory chain cache")
    .action(async (options: { refresh?: boolean }) => {
      if (options.refresh) {
        clearKhalaniChainsCache();
      }

      const chains = await getCachedKhalaniChains(!!options.refresh);

      if (isHeadless()) {
        writeJsonSuccess({ chains });
        return;
      }

      const rows = chains
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((chain) => [
          chain.name,
          colors.info(String(chain.id)),
          formatChainFamily(chain.type),
          `${chain.nativeCurrency.symbol} (${chain.nativeCurrency.decimals})`,
        ]);

      printTable(
        [
          { header: "Name", width: 22 },
          { header: "Chain ID", width: 16 },
          { header: "Type", width: 10 },
          { header: "Native", width: 18 },
        ],
        rows,
      );
    });
}
