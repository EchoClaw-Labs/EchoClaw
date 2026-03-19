import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { chainscanClient } from "../../chainscan/client.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { spinner, printTable } from "../../utils/ui.js";
import { parseIntOpt, formatTimestamp } from "./helpers.js";

export function createStatsSubcommand(): Command {
  const stats = new Command("stats")
    .description("Token statistics (meme coin intel)")
    .exitOverride();

  stats
    .command("holders")
    .description("Token holder count over time")
    .argument("<contractAddress>", "Token contract address")
    .option("--limit <n>", "Max results (max 2000)", parseIntOpt)
    .option("--skip <n>", "Skip results", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .option("--min-timestamp <n>", "Min timestamp (seconds)", parseIntOpt)
    .option("--max-timestamp <n>", "Max timestamp (seconds)", parseIntOpt)
    .action(async (contractAddress: string, opts: Record<string, unknown>) => {
      const spin = spinner("Fetching holder stats...");
      spin.start();
      const data = await chainscanClient.getTokenHolderStats(contractAddress, {
        limit: opts.limit as number | undefined,
        skip: opts.skip as number | undefined,
        sort: opts.sort as "asc" | "desc" | undefined,
        minTimestamp: opts.minTimestamp as number | undefined,
        maxTimestamp: opts.maxTimestamp as number | undefined,
      });
      spin.succeed(`Found ${data.length} data point(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ contractAddress, count: data.length, holderStats: data });
      } else {
        if (!data.length) {
          respond({ data: {}, ui: { type: "info", title: "Holder Stats", body: "No data found" } });
          return;
        }
        printTable(
          [{ header: "Date", width: 22 }, { header: "Holders", width: 12 }],
          data.map(d => [formatTimestamp(d.statTime), d.holderCount])
        );
      }
    });

  stats
    .command("transfers")
    .description("Token transfer count over time")
    .argument("<contractAddress>", "Token contract address")
    .option("--limit <n>", "Max results (max 2000)", parseIntOpt)
    .option("--skip <n>", "Skip results", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .option("--min-timestamp <n>", "Min timestamp (seconds)", parseIntOpt)
    .option("--max-timestamp <n>", "Max timestamp (seconds)", parseIntOpt)
    .action(async (contractAddress: string, opts: Record<string, unknown>) => {
      const spin = spinner("Fetching transfer stats...");
      spin.start();
      const data = await chainscanClient.getTokenTransferStats(contractAddress, {
        limit: opts.limit as number | undefined,
        skip: opts.skip as number | undefined,
        sort: opts.sort as "asc" | "desc" | undefined,
        minTimestamp: opts.minTimestamp as number | undefined,
        maxTimestamp: opts.maxTimestamp as number | undefined,
      });
      spin.succeed(`Found ${data.length} data point(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ contractAddress, count: data.length, transferStats: data });
      } else {
        if (!data.length) {
          respond({ data: {}, ui: { type: "info", title: "Transfer Stats", body: "No data found" } });
          return;
        }
        printTable(
          [
            { header: "Date", width: 22 },
            { header: "Transfers", width: 12 },
            { header: "Users", width: 12 },
          ],
          data.map(d => [formatTimestamp(d.statTime), d.transferCount, d.userCount])
        );
      }
    });

  stats
    .command("participants")
    .description("Unique trading participants over time")
    .argument("<contractAddress>", "Token contract address")
    .option("--limit <n>", "Max results (max 2000)", parseIntOpt)
    .option("--skip <n>", "Skip results", parseIntOpt)
    .option("--sort <dir>", "Sort direction (asc|desc)")
    .option("--min-timestamp <n>", "Min timestamp (seconds)", parseIntOpt)
    .option("--max-timestamp <n>", "Max timestamp (seconds)", parseIntOpt)
    .action(async (contractAddress: string, opts: Record<string, unknown>) => {
      const spin = spinner("Fetching participant stats...");
      spin.start();
      const data = await chainscanClient.getTokenUniqueParticipants(contractAddress, {
        limit: opts.limit as number | undefined,
        skip: opts.skip as number | undefined,
        sort: opts.sort as "asc" | "desc" | undefined,
        minTimestamp: opts.minTimestamp as number | undefined,
        maxTimestamp: opts.maxTimestamp as number | undefined,
      });
      spin.succeed(`Found ${data.length} data point(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ contractAddress, count: data.length, participantStats: data });
      } else {
        if (!data.length) {
          respond({ data: {}, ui: { type: "info", title: "Participant Stats", body: "No data found" } });
          return;
        }
        printTable(
          [{ header: "Date", width: 22 }, { header: "Unique Participants", width: 20 }],
          data.map(d => [formatTimestamp(d.statTime), d.uniqueParticipant])
        );
      }
    });

  stats
    .command("top-wallets")
    .description("Top token senders/receivers/participants")
    .option("--type <type>", "Wallet type: senders, receivers, or participants", "participants")
    .option("--span <span>", "Time span: 24h, 3d, or 7d", "24h")
    .action(async (opts: { type: string; span: string }) => {
      const validTypes = ["senders", "receivers", "participants"] as const;
      const validSpans = ["24h", "3d", "7d"] as const;

      if (!validTypes.includes(opts.type as typeof validTypes[number])) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid type: ${opts.type}`, "Use: senders, receivers, or participants");
      }
      if (!validSpans.includes(opts.span as typeof validSpans[number])) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid span: ${opts.span}`, "Use: 24h, 3d, or 7d");
      }

      const spanType = opts.span as "24h" | "3d" | "7d";
      const spin = spinner(`Fetching top ${opts.type}...`);
      spin.start();

      let data: { address: string; value: string }[];
      switch (opts.type) {
        case "senders":
          data = await chainscanClient.getTopTokenSenders(spanType);
          break;
        case "receivers":
          data = await chainscanClient.getTopTokenReceivers(spanType);
          break;
        default:
          data = await chainscanClient.getTopTokenParticipants(spanType);
      }
      spin.succeed(`Found ${data.length} wallet(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ type: opts.type, span: opts.span, count: data.length, wallets: data });
      } else {
        if (!data.length) {
          respond({ data: {}, ui: { type: "info", title: "Top Wallets", body: "No data found" } });
          return;
        }
        printTable(
          [
            { header: "#", width: 5 },
            { header: "Address", width: 46 },
            { header: "Value", width: 18 },
          ],
          data.map((d, i) => [String(i + 1), d.address, d.value])
        );
      }
    });

  return stats;
}
