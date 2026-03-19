import { Command } from "commander";
import { chainscanClient } from "../../chainscan/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { spinner, formatAddress, printTable } from "../../utils/ui.js";
import { resolveAddress, parseIntOpt, formatTimestamp } from "./helpers.js";

export function createTransfersSubcommand(): Command {
  const transfers = new Command("transfers")
    .description("Token transfer queries")
    .exitOverride();

  transfers
    .command("erc20")
    .description("List ERC-20 token transfers")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .option("--contract <addr>", "Filter by token contract address")
    .option("--page <n>", "Page number", parseIntOpt)
    .option("--offset <n>", "Results per page (max 100)", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .action(async (address: string | undefined, opts: { contract?: string; page?: number; offset?: number; sort?: string }) => {
      const addr = resolveAddress(address);
      const spin = spinner("Fetching ERC-20 transfers...");
      spin.start();
      const txs = await chainscanClient.getTokenTransfers(addr, {
        page: opts.page,
        offset: opts.offset,
        sort: opts.sort as "asc" | "desc" | undefined,
        contractaddress: opts.contract,
      });
      spin.succeed(`Found ${txs.length} ERC-20 transfer(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ address: addr, count: txs.length, transfers: txs });
      } else {
        if (!txs.length) {
          respond({ data: {}, ui: { type: "info", title: "ERC-20 Transfers", body: "No transfers found" } });
          return;
        }
        printTable(
          [
            { header: "Token", width: 10 },
            { header: "From", width: 16 },
            { header: "To", width: 16 },
            { header: "Value", width: 18 },
            { header: "Time", width: 22 },
          ],
          txs.map(tx => [
            tx.tokenSymbol || formatAddress(tx.contractAddress),
            formatAddress(tx.from),
            formatAddress(tx.to),
            tx.value,
            formatTimestamp(tx.timeStamp),
          ])
        );
      }
    });

  transfers
    .command("erc721")
    .description("List ERC-721 (NFT) transfers")
    .argument("[address]", "Wallet address (default: configured wallet)")
    .option("--contract <addr>", "Filter by NFT contract address")
    .option("--page <n>", "Page number", parseIntOpt)
    .option("--offset <n>", "Results per page (max 100)", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .action(async (address: string | undefined, opts: { contract?: string; page?: number; offset?: number; sort?: string }) => {
      const addr = resolveAddress(address);
      const spin = spinner("Fetching NFT transfers...");
      spin.start();
      const txs = await chainscanClient.getNftTransfers(addr, {
        page: opts.page,
        offset: opts.offset,
        sort: opts.sort as "asc" | "desc" | undefined,
        contractaddress: opts.contract,
      });
      spin.succeed(`Found ${txs.length} NFT transfer(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ address: addr, count: txs.length, transfers: txs });
      } else {
        if (!txs.length) {
          respond({ data: {}, ui: { type: "info", title: "NFT Transfers", body: "No NFT transfers found" } });
          return;
        }
        printTable(
          [
            { header: "Token", width: 10 },
            { header: "ID", width: 8 },
            { header: "From", width: 16 },
            { header: "To", width: 16 },
            { header: "Time", width: 22 },
          ],
          txs.map(tx => [
            tx.tokenSymbol || formatAddress(tx.contractAddress),
            tx.tokenID,
            formatAddress(tx.from),
            formatAddress(tx.to),
            formatTimestamp(tx.timeStamp),
          ])
        );
      }
    });

  return transfers;
}
