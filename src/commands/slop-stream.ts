/**
 * `echoclaw slop-stream <token>` — Real-time token updates via Socket.IO.
 *
 * JSON mode: each event as a JSON line on stdout.
 * UI mode: formatted output with price, trade info, holders.
 */

import { Command } from "commander";
import { isAddress, getAddress } from "viem";
import { TokenStream } from "../bot/stream.js";
import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { isHeadless, writeStdout } from "../utils/output.js";
import logger from "../utils/logger.js";
import type { TokenUpdatePayload, TokenSnapshotPayload } from "../bot/types.js";

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export function createSlopStreamCommand(): Command {
  const cmd = new Command("slop-stream")
    .description("Stream real-time token updates from slop.money")
    .argument("<token>", "Token contract address")
    .option("--json", "Output JSON lines (default in headless mode)")
    .action(async (tokenArg: string, options: { json?: boolean }) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);
      const cfg = loadConfig();
      const jsonMode = options.json || isHeadless();

      const stream = new TokenStream({ url: cfg.services.slopWsUrl });

      // Graceful shutdown on Ctrl+C
      const cleanup = () => {
        stream.disconnect();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      stream.on("connected", () => {
        if (!jsonMode) {
          process.stderr.write(`Connected to ${cfg.services.slopWsUrl}\n`);
          process.stderr.write(`Subscribing to ${tokenAddr}...\n\n`);
        }
      });

      stream.on("snapshot", (payload: TokenSnapshotPayload) => {
        if (jsonMode) {
          writeStdout(JSON.stringify({ event: "snapshot", ...payload }));
        } else {
          const d = payload.data;
          process.stderr.write(
            `[SNAPSHOT] ${d.address}\n` +
            `  Price: ${formatPrice(d.actual_price ?? 0)} 0G | MCap: ${formatNumber(d.market_cap ?? 0)} 0G\n` +
            `  Bonding: ${(d.bonding_progress ?? 0).toFixed(1)}% | Status: ${d.status ?? "?"}\n` +
            `  Holders: ${d.holders_count ?? "?"} | Trades 24h: ${d.trades_24h ?? "?"}\n\n`
          );
        }
      });

      stream.on("update", (payload: TokenUpdatePayload) => {
        if (jsonMode) {
          writeStdout(JSON.stringify({ event: "update", ...payload }));
        } else {
          let line =
            `[UPDATE] ${payload.symbol} | ` +
            `Price: ${formatPrice(payload.price)} 0G | ` +
            `MCap: ${formatNumber(payload.marketCap)} 0G | ` +
            `Bonding: ${payload.bondingProgress.toFixed(1)}%`;

          if (payload.lastTrade) {
            const t = payload.lastTrade;
            line += ` | ${t.tx_type.toUpperCase()} ${formatNumber(t.amount_og)} 0G by ${t.wallet_address.slice(0, 8)}..`;
          }

          process.stderr.write(line + "\n");
        }
      });

      stream.on("disconnected", (reason: string) => {
        if (!jsonMode) {
          process.stderr.write(`\n[DISCONNECTED] ${reason} — reconnecting...\n`);
        }
      });

      stream.on("error", (err: Error) => {
        logger.error(`[slop-stream] ${err.message}`);
      });

      stream.connect();
      stream.subscribe(tokenAddr);

      // Keep process alive
      await new Promise<void>(() => {});
    });

  return cmd;
}
