/**
 * Browse trending/top Solana tokens via Jupiter Token API.
 * This is the one discovery feature Khalani does NOT cover.
 */

import { Command } from "commander";
import {
  jupiterGetTrendingTokens,
  type JupiterTokenListEntry,
} from "../../chains/solana/jupiter-client.js";
import { cacheTokens } from "../../chains/solana/token-cache.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

type Category = "trending" | "top-traded" | "top-organic" | "recent" | "lst" | "verified";

const CATEGORY_MAP: Record<Category, string> = {
  trending: "toptrending",
  "top-traded": "toptraded",
  "top-organic": "toporganicscore",
  recent: "recent",
  lst: "lst",
  verified: "verified",
};

function formatPrice(price?: number): string {
  if (price == null) return "-";
  if (price < 0.01) return `$${price.toFixed(8)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVolume(vol?: number): string {
  if (vol == null) return "-";
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function createBrowseSubcommand(): Command {
  return new Command("browse")
    .description("Browse trending and top Solana tokens (Jupiter)")
    .argument("[category]", "Category: trending | top-traded | top-organic | recent | lst | verified", "trending")
    .option("--interval <interval>", "Time window: 5m | 1h | 6h | 24h", "1h")
    .option("--limit <n>", "Number of results", "20")
    .exitOverride()
    .action(async (category: string, options: { interval: string; limit: string }) => {
      const cat = category as Category;
      if (!(cat in CATEGORY_MAP)) {
        throw new EchoError(
          ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
          `Unknown category: ${cat}`,
          `Available: ${Object.keys(CATEGORY_MAP).join(", ")}`,
        );
      }

      const jupiterCategory = CATEGORY_MAP[cat] as Parameters<typeof jupiterGetTrendingTokens>[0];
      const interval = options.interval as Parameters<typeof jupiterGetTrendingTokens>[1];
      const limit = Number(options.limit) || 20;

      const spin = spinner(`Fetching ${cat} tokens...`);
      spin.start();

      try {
        const tokens = await jupiterGetTrendingTokens(jupiterCategory, interval, limit);

        // Cache resolved tokens for use by swap/transfer commands
        cacheTokens(tokens.map((t) => ({
          chain: "solana" as const,
          address: t.id,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          logoUri: t.icon,
        })));

        spin.succeed(`Found ${tokens.length} ${cat} tokens`);

        if (isHeadless()) {
          writeJsonSuccess({ category: cat, interval, tokens });
          return;
        }

        if (tokens.length === 0) {
          process.stderr.write(colors.muted("  No tokens found for this category.\n"));
          return;
        }

        const getVolume = (t: JupiterTokenListEntry): number | undefined => {
          if (!t.stats24h) return undefined;
          return (t.stats24h.buyVolume ?? 0) + (t.stats24h.sellVolume ?? 0);
        };

        printTable(
          [
            { header: "#", width: 4 },
            { header: "Symbol", width: 10 },
            { header: "Name", width: 20 },
            { header: "Mint", width: 14 },
            { header: "Price", width: 14 },
            { header: "Volume 24h", width: 12 },
          ],
          tokens.map((t: JupiterTokenListEntry, i: number) => [
            String(i + 1),
            t.symbol,
            t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name,
            `${t.id.slice(0, 4)}…${t.id.slice(-4)}`,
            formatPrice(t.usdPrice),
            formatVolume(getVolume(t)),
          ]),
        );
      } catch (err) {
        spin.fail("Failed to fetch tokens");
        if (err instanceof EchoError) throw err;
        throw new EchoError(
          ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
          `Failed to fetch ${cat} tokens: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
}
