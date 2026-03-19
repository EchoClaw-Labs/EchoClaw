import { Command } from "commander";
import { isAddress, getAddress } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess, writeStderr } from "../../utils/output.js";
import { successBox, colors, createTable } from "../../utils/ui.js";
import { loadUserTokens, addUserAlias, removeUserAlias, getMergedTokens } from "../../jaine/userTokens.js";

export function createTokensSubcommand(): Command {
  const tokens = new Command("tokens")
    .description("Manage token aliases")
    .exitOverride();

  tokens
    .command("list")
    .description("List all known tokens (core + user aliases)")
    .action(async () => {
      const merged = getMergedTokens();
      const userConfig = loadUserTokens();

      if (isHeadless()) {
        writeJsonSuccess({
          tokens: Object.entries(merged).map(([symbol, address]) => ({
            symbol,
            address,
            isUserAlias: !!userConfig.aliases[symbol],
          })),
        });
      } else {
        const table = createTable([
          { header: "Symbol", width: 15 },
          { header: "Address", width: 45 },
          { header: "Source", width: 10 },
        ]);

        for (const [symbol, address] of Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0]))) {
          const source = userConfig.aliases[symbol] ? colors.info("user") : colors.muted("core");
          table.push([symbol, address, source]);
        }

        writeStderr(table.toString());
      }
    });

  tokens
    .command("add-alias <symbol> <address>")
    .description("Add a user token alias")
    .action(async (symbol: string, address: string) => {
      if (!isAddress(address)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${address}`);
      }

      addUserAlias(symbol, getAddress(address));

      if (isHeadless()) {
        writeJsonSuccess({ symbol, address: getAddress(address) });
      } else {
        successBox("Token Alias Added", `${colors.info(symbol)} → ${colors.address(address)}`);
      }
    });

  tokens
    .command("remove-alias <symbol>")
    .description("Remove a user token alias")
    .action(async (symbol: string) => {
      const removed = removeUserAlias(symbol);

      if (!removed) {
        throw new EchoError(ErrorCodes.TOKEN_NOT_FOUND, `Alias not found: ${symbol}`);
      }

      if (isHeadless()) {
        writeJsonSuccess({ symbol, removed: true });
      } else {
        successBox("Token Alias Removed", `Removed alias: ${colors.info(symbol)}`);
      }
    });

  return tokens;
}
