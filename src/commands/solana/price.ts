/**
 * Solana price lookup — Jupiter Price V3 API.
 * Standalone price query (Khalani gives prices only in balance context).
 */

import { Command } from "commander";
import { jupiterGetPrices } from "../../chains/solana/jupiter-client.js";
import { resolveTokens } from "../../chains/solana/token-registry.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { shortenSolanaAddress } from "../../chains/solana/validation.js";

function formatPrice(price: number): string {
  if (price < 0.0001) return `$${price.toFixed(10)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function createPriceSubcommand(): Command {
  return new Command("price")
    .description("Get token prices (Jupiter Price V3)")
    .argument("<tokens...>", "Token symbols or mint addresses (1 or more)")
    .exitOverride()
    .action(async (tokens: string[]) => {
      const spin = spinner(`Fetching prices for ${tokens.length} token(s)...`);
      spin.start();

      try {
        // Resolve all tokens
        const resolved = await resolveTokens(tokens);
        const notFound = tokens.filter((t) => !resolved.has(t));
        if (notFound.length > 0 && resolved.size === 0) {
          spin.fail("No tokens found");
          throw new EchoError(
            ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
            `Tokens not found: ${notFound.join(", ")}`,
          );
        }

        // Fetch prices for resolved mints
        const mints = Array.from(resolved.values()).map((t) => t.address);
        const prices = await jupiterGetPrices(mints);

        spin.succeed(`Prices for ${resolved.size} token(s)`);

        const results = Array.from(resolved.entries()).map(([query, meta]) => ({
          query,
          symbol: meta.symbol,
          mint: meta.address,
          priceUsd: prices.get(meta.address) ?? null,
        }));

        if (isHeadless()) {
          writeJsonSuccess({ prices: results, notFound });
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Mint", width: 14 },
            { header: "Price USD", width: 18 },
          ],
          results.map((r) => [
            r.symbol,
            shortenSolanaAddress(r.mint),
            r.priceUsd != null ? formatPrice(r.priceUsd) : colors.muted("N/A"),
          ]),
        );

        if (notFound.length > 0) {
          process.stderr.write(
            `\n  ${colors.muted(`Not found: ${notFound.join(", ")}`)}\n`,
          );
        }
      } catch (err) {
        spin.fail("Price fetch failed");
        throw err;
      }
    });
}
