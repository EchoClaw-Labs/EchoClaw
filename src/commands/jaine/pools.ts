import { Command } from "commander";
import { parseUnits, formatUnits, type Address } from "viem";
import { loadConfig } from "../../config/store.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess, writeStderr } from "../../utils/output.js";
import { spinner, infoBox, colors, createTable } from "../../utils/ui.js";
import { resolveToken, getTokenSymbol } from "../../jaine/coreTokens.js";
import { loadUserTokens } from "../../jaine/userTokens.js";
import {
  loadPoolsCache,
  savePoolsCache,
  scanCorePools,
  syncPoolsFromSubgraph,
  findPoolsForToken,
  findPoolsBetweenTokens,
  type PoolsCache,
} from "../../jaine/poolCache.js";
import { POOLS_CACHE_FILE } from "../../jaine/paths.js";
import { FEE_TIERS, type FeeTier } from "../../jaine/abi/factory.js";
import { findBestRouteExactInput, formatRoute } from "../../jaine/routing.js";
import { validateFeeTier, getTokenDecimals } from "./helpers.js";

export function createPoolsSubcommand(): Command {
  const pools = new Command("pools")
    .description("Pool discovery and cache management")
    .exitOverride();

  pools
    .command("scan-core")
    .description("Scan factory for pools between core tokens")
    .option("--source <source>", "Data source: subgraph or rpc", "subgraph")
    .option("--max-pools <n>", "Max pools to fetch from subgraph", "500")
    .option("--fee-tiers <tiers>", "Comma-separated fee tiers (rpc only)", FEE_TIERS.join(","))
    .action(async (options: { source: string; maxPools: string; feeTiers: string }) => {
      const source = options.source === "rpc" ? "rpc" : "subgraph";

      const spin = spinner(source === "subgraph" ? "Syncing pools from subgraph..." : "Scanning pools via RPC...");
      spin.start();

      const cfg = loadConfig();
      let foundPools;

      if (source === "subgraph") {
        const maxPools = parseIntSafe(options.maxPools, "maxPools");
        foundPools = await syncPoolsFromSubgraph(maxPools, (fetched) => {
          if (!isHeadless()) {
            spin.text = `Syncing pools from subgraph... (${fetched} fetched)`;
          }
        });
      } else {
        const feeTiers = options.feeTiers.split(",").map((t) => validateFeeTier(parseIntSafe(t.trim(), "feeTier")));
        foundPools = await scanCorePools(feeTiers as FeeTier[], (found, scanned) => {
          if (!isHeadless()) {
            spin.text = `Scanning pools... (${found} found, ${scanned} pairs scanned)`;
          }
        });
      }

      const cache: PoolsCache = {
        version: 1,
        chainId: cfg.chain.chainId,
        generatedAt: new Date().toISOString(),
        pools: foundPools,
      };

      savePoolsCache(cache);
      spin.succeed(`Found ${foundPools.length} pools (source: ${source})`);

      if (isHeadless()) {
        writeJsonSuccess({
          source,
          poolsFound: foundPools.length,
          generatedAt: cache.generatedAt,
          pools: foundPools,
        });
      } else {
        infoBox(
          "Pool Cache Updated",
          `Source: ${colors.info(source)}\n` +
          `Found: ${colors.value(foundPools.length.toString())} pools\n` +
            `Saved to: ${colors.muted(POOLS_CACHE_FILE)}`
        );
      }
    });

  pools
    .command("for-token <token>")
    .description("Find pools containing a specific token")
    .action(async (token: string) => {
      const userTokens = loadUserTokens();
      const tokenAddr = resolveToken(token, userTokens.aliases);

      const cache = loadPoolsCache();
      if (!cache) {
        throw new EchoError(ErrorCodes.NO_ROUTE_FOUND, "Pool cache is empty", "Run: echoclaw jaine pools scan-core");
      }

      const matchingPools = findPoolsForToken(tokenAddr, cache);

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          pools: matchingPools,
        });
      } else {
        if (matchingPools.length === 0) {
          infoBox("No Pools Found", `No pools found for ${getTokenSymbol(tokenAddr, userTokens.aliases)}`);
        } else {
          const table = createTable([
            { header: "Pool", width: 45 },
            { header: "Token0", width: 12 },
            { header: "Token1", width: 12 },
            { header: "Fee", width: 8 },
          ]);

          for (const pool of matchingPools) {
            table.push([
              pool.address,
              getTokenSymbol(pool.token0, userTokens.aliases),
              getTokenSymbol(pool.token1, userTokens.aliases),
              `${(pool.fee / 10000).toFixed(2)}%`,
            ]);
          }

          writeStderr(table.toString());
        }
      }
    });

  pools
    .command("find <tokenIn> <tokenOut>")
    .description("Find pools between two tokens")
    .option("--amount-in <amount>", "Amount in for quote")
    .action(async (tokenIn: string, tokenOut: string, options: { amountIn?: string }) => {
      const userTokens = loadUserTokens();
      const tokenInAddr = resolveToken(tokenIn, userTokens.aliases);
      const tokenOutAddr = resolveToken(tokenOut, userTokens.aliases);

      const directPools = findPoolsBetweenTokens(tokenInAddr, tokenOutAddr);

      if (options.amountIn) {
        const decimals = await getTokenDecimals(tokenInAddr);
        const amountIn = parseUnits(options.amountIn, decimals);

        const spin = spinner("Finding best route...");
        spin.start();

        const bestRoute = await findBestRouteExactInput(tokenInAddr, tokenOutAddr, amountIn);
        spin.succeed("Route found");

        if (!bestRoute) {
          throw new EchoError(ErrorCodes.NO_ROUTE_FOUND, "No route found for this swap");
        }

        const decimalsOut = await getTokenDecimals(tokenOutAddr);

        if (isHeadless()) {
          writeJsonSuccess({
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            amountIn: amountIn.toString(),
            amountOut: bestRoute.amountOut.toString(),
            route: formatRoute(bestRoute, userTokens.aliases),
            hops: bestRoute.tokens.length - 1,
            directPools,
          });
        } else {
          infoBox(
            "Best Route",
            `${colors.value(options.amountIn)} ${getTokenSymbol(tokenInAddr, userTokens.aliases)} → ` +
              `${colors.value(formatUnits(bestRoute.amountOut, decimalsOut))} ${getTokenSymbol(tokenOutAddr, userTokens.aliases)}\n\n` +
              `Route: ${formatRoute(bestRoute, userTokens.aliases)}\n` +
              `Hops: ${bestRoute.tokens.length - 1}`
          );
        }
      } else {
        if (isHeadless()) {
          writeJsonSuccess({
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            directPools,
          });
        } else {
          if (directPools.length === 0) {
            infoBox("No Direct Pools", "No direct pools found. Multi-hop routing may still work.");
          } else {
            const table = createTable([
              { header: "Pool", width: 45 },
              { header: "Fee", width: 10 },
            ]);

            for (const pool of directPools) {
              table.push([pool.address, `${(pool.fee / 10000).toFixed(2)}%`]);
            }

            writeStderr(table.toString());
          }
        }
      }
    });

  return pools;
}
