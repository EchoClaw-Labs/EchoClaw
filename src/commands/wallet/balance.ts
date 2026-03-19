import { Command } from "commander";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import {
  infoBox,
  spinner,
  printTable,
  colors,
  formatBalance,
} from "../../utils/ui.js";
import { writeStderr, isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { requireWallet } from "./index.js";

export function createBalanceSubcommand(): Command {
  return new Command("balance")
    .description("Show native wallet balance")
    .action(async () => {
      const address = requireWallet();
      const cfg = loadConfig();
      const client = getPublicClient();

      const spin = spinner(`Fetching balance from ${cfg.chain.chainId === 16661 ? "0G Mainnet" : `chain ${cfg.chain.chainId}`}...`);
      spin.start();

      try {
        // Fetch native balance
        const nativeBalance = await client.getBalance({ address });
        spin.succeed("Balance fetched");

        // Prepare table data
        const rows: string[][] = [];

        // Native balance (0G)
        rows.push([
          colors.bold("0G"),
          colors.value(formatBalance(nativeBalance, 18)),
          colors.muted("native"),
        ]);

        // JSON output for automation
        if (isHeadless()) {
          writeJsonSuccess({
            address,
            chainId: cfg.chain.chainId,
            native: {
              symbol: "0G",
              balanceWei: nativeBalance.toString(),
              balance: formatBalance(nativeBalance, 18),
            },
          });
          return;
        }

        // Print header
        writeStderr("");
        infoBox("Wallet Balance", colors.address(address));

        // Print table
        printTable(
          [
            { header: "Token", width: 12 },
            { header: "Balance", width: 20 },
            { header: "Address", width: 16 },
          ],
          rows
        );
      } catch (err) {
        spin.fail("Failed to fetch balance");

        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("fetch") || errMsg.includes("timeout") || errMsg.includes("ECONNREFUSED")) {
          throw new EchoError(
            ErrorCodes.RPC_ERROR,
            `Could not connect to RPC: ${cfg.chain.rpcUrl}`,
            "Check your network or run: echoclaw config set-rpc <new-url>"
          );
        }
        throw new EchoError(ErrorCodes.RPC_ERROR, `RPC error: ${errMsg}`);
      }
    });
}
