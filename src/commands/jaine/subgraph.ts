import { Command } from "commander";
import { isAddress, getAddress } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess, writeStderr } from "../../utils/output.js";
import { spinner, infoBox, colors, createTable } from "../../utils/ui.js";
import { subgraphClient } from "../../jaine/subgraph/client.js";

// --- Validation helpers ---

function parseLimit(value: string, name: string, max = 1000): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid ${name}: ${value}`, `Must be 1-${max}`);
  }
  return n;
}

function requireAddress(value: string, name: string): string {
  if (!isAddress(value)) {
    throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid ${name}: ${value}`);
  }
  return getAddress(value).toLowerCase();
}

function formatUsd(value: string): string {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatTimestamp(ts: string | number): string {
  const n = typeof ts === "string" ? parseInt(ts, 10) : ts;
  return new Date(n * 1000).toISOString();
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// --- Command factory ---

export function createSubgraphSubcommand(): Command {
  const subgraph = new Command("subgraph")
    .description("Jaine V3 subgraph queries (read-only market intelligence)")
    .exitOverride();

  // ============ META ============
  subgraph
    .command("meta")
    .description("Subgraph health: block number, indexing errors, deployment")
    .action(async () => {
      const spin = spinner("Fetching subgraph meta...");
      spin.start();

      const meta = await subgraphClient.getMeta();
      spin.succeed("Meta loaded");

      if (isHeadless()) {
        writeJsonSuccess({ meta });
      } else {
        const lines = [
          `Block: ${colors.value(String(meta.block.number))}`,
          `Deployment: ${colors.muted(meta.deployment)}`,
          `Indexing errors: ${meta.hasIndexingErrors ? colors.error("YES") : colors.success("none")}`,
        ];
        if (meta.block.timestamp) {
          lines.push(`Block time: ${colors.muted(formatTimestamp(meta.block.timestamp))}`);
        }
        infoBox("Subgraph Meta", lines.join("\n"));
      }
    });

  // ============ POOLS GROUP ============
  const pools = new Command("pools")
    .description("Pool queries")
    .exitOverride();

  pools
    .command("top")
    .description("Top pools by TVL")
    .option("--limit <n>", "Number of pools", "20")
    .option("--min-tvl <usd>", "Minimum TVL in USD")
    .action(async (options: { limit: string; minTvl?: string }) => {
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching top pools...");
      spin.start();

      let result = await subgraphClient.getTopPools(limit);
      spin.succeed(`Fetched ${result.length} pools`);

      if (options.minTvl) {
        const minTvl = parseFloat(options.minTvl);
        result = result.filter(p => parseFloat(p.totalValueLockedUSD) >= minTvl);
      }

      if (isHeadless()) {
        writeJsonSuccess({ pools: result });
      } else {
        const table = createTable([
          { header: "Pool", width: 14 },
          { header: "Pair", width: 16 },
          { header: "Fee", width: 8 },
          { header: "TVL", width: 12 },
          { header: "Vol (USD)", width: 12 },
          { header: "Txns", width: 8 },
        ]);
        for (const p of result) {
          table.push([
            truncAddr(p.id),
            `${p.token0.symbol}/${p.token1.symbol}`,
            `${(parseInt(p.feeTier, 10) / 10000).toFixed(2)}%`,
            formatUsd(p.totalValueLockedUSD),
            formatUsd(p.volumeUSD),
            p.txCount,
          ]);
        }
        writeStderr(table.toString());
      }
    });

  pools
    .command("newest")
    .description("Newest pools")
    .option("--limit <n>", "Number of pools", "20")
    .action(async (options: { limit: string }) => {
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching newest pools...");
      spin.start();

      const result = await subgraphClient.getNewestPools(limit);
      spin.succeed(`Fetched ${result.length} pools`);

      if (isHeadless()) {
        writeJsonSuccess({ pools: result });
      } else {
        const table = createTable([
          { header: "Pool", width: 14 },
          { header: "Pair", width: 16 },
          { header: "Fee", width: 8 },
          { header: "TVL", width: 12 },
          { header: "Created", width: 22 },
        ]);
        for (const p of result) {
          table.push([
            truncAddr(p.id),
            `${p.token0.symbol}/${p.token1.symbol}`,
            `${(parseInt(p.feeTier, 10) / 10000).toFixed(2)}%`,
            formatUsd(p.totalValueLockedUSD),
            formatTimestamp(p.createdAtTimestamp),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  pools
    .command("for-token <token>")
    .description("Pools containing a specific token")
    .option("--limit <n>", "Number of pools", "20")
    .action(async (token: string, options: { limit: string }) => {
      const tokenAddr = requireAddress(token, "token");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching pools...");
      spin.start();

      const result = await subgraphClient.getPoolsForToken(tokenAddr, { limit });
      spin.succeed(`Found ${result.length} pools`);

      if (isHeadless()) {
        writeJsonSuccess({ token: tokenAddr, pools: result });
      } else {
        const table = createTable([
          { header: "Pool", width: 14 },
          { header: "Pair", width: 16 },
          { header: "Fee", width: 8 },
          { header: "TVL", width: 12 },
          { header: "Vol (USD)", width: 12 },
        ]);
        for (const p of result) {
          table.push([
            truncAddr(p.id),
            `${p.token0.symbol}/${p.token1.symbol}`,
            `${(parseInt(p.feeTier, 10) / 10000).toFixed(2)}%`,
            formatUsd(p.totalValueLockedUSD),
            formatUsd(p.volumeUSD),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  pools
    .command("for-pair <tokenA> <tokenB>")
    .description("Pools for a specific token pair")
    .option("--limit <n>", "Number of pools", "20")
    .action(async (tokenA: string, tokenB: string, options: { limit: string }) => {
      const addrA = requireAddress(tokenA, "tokenA");
      const addrB = requireAddress(tokenB, "tokenB");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching pools...");
      spin.start();

      const result = await subgraphClient.getPoolsForPair(addrA, addrB, { limit });
      spin.succeed(`Found ${result.length} pools`);

      if (isHeadless()) {
        writeJsonSuccess({ tokenA: addrA, tokenB: addrB, pools: result });
      } else {
        const table = createTable([
          { header: "Pool", width: 14 },
          { header: "Pair", width: 16 },
          { header: "Fee", width: 8 },
          { header: "TVL", width: 12 },
          { header: "Vol (USD)", width: 12 },
        ]);
        for (const p of result) {
          table.push([
            truncAddr(p.id),
            `${p.token0.symbol}/${p.token1.symbol}`,
            `${(parseInt(p.feeTier, 10) / 10000).toFixed(2)}%`,
            formatUsd(p.totalValueLockedUSD),
            formatUsd(p.volumeUSD),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  subgraph.addCommand(pools);

  // ============ POOL (singular) ============
  const pool = new Command("pool")
    .description("Single pool queries")
    .exitOverride();

  pool
    .command("info <id>")
    .description("Detailed pool info")
    .action(async (id: string) => {
      const poolAddr = requireAddress(id, "pool");

      const spin = spinner("Fetching pool...");
      spin.start();

      const result = await subgraphClient.getPool(poolAddr);
      spin.succeed("Pool loaded");

      if (!result) {
        throw new EchoError(ErrorCodes.POOL_NOT_FOUND, `Pool not found: ${id}`);
      }

      if (isHeadless()) {
        writeJsonSuccess({ pool: result });
      } else {
        infoBox(
          `Pool ${truncAddr(result.id)}`,
          `Pair: ${colors.info(`${result.token0.symbol}/${result.token1.symbol}`)}\n` +
          `Fee: ${(parseInt(result.feeTier, 10) / 10000).toFixed(2)}%\n` +
          `TVL: ${colors.value(formatUsd(result.totalValueLockedUSD))}\n` +
          `Volume: ${colors.value(formatUsd(result.volumeUSD))}\n` +
          `Fees: ${colors.value(formatUsd(result.feesUSD))}\n` +
          `Txns: ${result.txCount}\n` +
          `Liquidity: ${result.liquidity}\n` +
          `Token0 Price: ${result.token0Price}\n` +
          `Token1 Price: ${result.token1Price}\n` +
          `LP Count: ${result.liquidityProviderCount}\n` +
          `Created: ${formatTimestamp(result.createdAtTimestamp)}`
        );
      }
    });

  pool
    .command("days <id>")
    .description("Pool daily OHLCV data")
    .option("--days <n>", "Number of days", "7")
    .action(async (id: string, options: { days: string }) => {
      const poolAddr = requireAddress(id, "pool");
      const days = parseLimit(options.days, "days");

      const spin = spinner("Fetching pool day data...");
      spin.start();

      const result = await subgraphClient.getPoolDayData(poolAddr, { limit: days });
      spin.succeed(`Fetched ${result.length} days`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: poolAddr, dayData: result });
      } else {
        const table = createTable([
          { header: "Date", width: 12 },
          { header: "TVL", width: 12 },
          { header: "Volume", width: 12 },
          { header: "Fees", width: 10 },
          { header: "Open", width: 14 },
          { header: "Close", width: 14 },
          { header: "Txns", width: 7 },
        ]);
        for (const d of result) {
          table.push([
            new Date(d.date * 1000).toISOString().slice(0, 10),
            formatUsd(d.tvlUSD),
            formatUsd(d.volumeUSD),
            formatUsd(d.feesUSD),
            parseFloat(d.open).toPrecision(6),
            parseFloat(d.close).toPrecision(6),
            d.txCount,
          ]);
        }
        writeStderr(table.toString());
      }
    });

  pool
    .command("hours <id>")
    .description("Pool hourly data")
    .option("--hours <n>", "Number of hours", "24")
    .action(async (id: string, options: { hours: string }) => {
      const poolAddr = requireAddress(id, "pool");
      const hours = parseLimit(options.hours, "hours");

      const spin = spinner("Fetching pool hour data...");
      spin.start();

      const result = await subgraphClient.getPoolHourData(poolAddr, { limit: hours });
      spin.succeed(`Fetched ${result.length} hours`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: poolAddr, hourData: result });
      } else {
        const table = createTable([
          { header: "Time", width: 22 },
          { header: "TVL", width: 12 },
          { header: "Volume", width: 12 },
          { header: "Fees", width: 10 },
          { header: "Close", width: 14 },
          { header: "Txns", width: 7 },
        ]);
        for (const h of result) {
          table.push([
            formatTimestamp(h.periodStartUnix),
            formatUsd(h.tvlUSD),
            formatUsd(h.volumeUSD),
            formatUsd(h.feesUSD),
            parseFloat(h.close).toPrecision(6),
            h.txCount,
          ]);
        }
        writeStderr(table.toString());
      }
    });

  subgraph.addCommand(pool);

  // ============ SWAPS ============
  subgraph
    .command("swaps <pool>")
    .description("Recent swaps for a pool")
    .option("--limit <n>", "Number of swaps", "20")
    .action(async (poolId: string, options: { limit: string }) => {
      const addr = requireAddress(poolId, "pool");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching swaps...");
      spin.start();

      const result = await subgraphClient.getRecentSwaps(addr, { limit });
      spin.succeed(`Fetched ${result.length} swaps`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: addr, swaps: result });
      } else {
        const table = createTable([
          { header: "Time", width: 22 },
          { header: "Amount0", width: 16 },
          { header: "Amount1", width: 16 },
          { header: "USD", width: 12 },
          { header: "Origin", width: 14 },
        ]);
        for (const s of result) {
          table.push([
            formatTimestamp(s.timestamp),
            parseFloat(s.amount0).toPrecision(6),
            parseFloat(s.amount1).toPrecision(6),
            formatUsd(s.amountUSD),
            truncAddr(s.origin),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  // ============ LP EVENTS GROUP ============
  const lp = new Command("lp")
    .description("LP events (mints, burns, collects)")
    .exitOverride();

  lp.command("mints <pool>")
    .description("Mint events for a pool")
    .option("--limit <n>", "Number of events", "20")
    .action(async (poolId: string, options: { limit: string }) => {
      const addr = requireAddress(poolId, "pool");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching mints...");
      spin.start();

      const result = await subgraphClient.getMints(addr, { limit });
      spin.succeed(`Fetched ${result.length} mints`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: addr, mints: result });
      } else {
        const table = createTable([
          { header: "Time", width: 22 },
          { header: "Amount0", width: 16 },
          { header: "Amount1", width: 16 },
          { header: "USD", width: 12 },
          { header: "Owner", width: 14 },
        ]);
        for (const m of result) {
          table.push([
            formatTimestamp(m.timestamp),
            parseFloat(m.amount0).toPrecision(6),
            parseFloat(m.amount1).toPrecision(6),
            m.amountUSD ? formatUsd(m.amountUSD) : "-",
            truncAddr(m.owner),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  lp.command("burns <pool>")
    .description("Burn events for a pool")
    .option("--limit <n>", "Number of events", "20")
    .action(async (poolId: string, options: { limit: string }) => {
      const addr = requireAddress(poolId, "pool");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching burns...");
      spin.start();

      const result = await subgraphClient.getBurns(addr, { limit });
      spin.succeed(`Fetched ${result.length} burns`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: addr, burns: result });
      } else {
        const table = createTable([
          { header: "Time", width: 22 },
          { header: "Amount0", width: 16 },
          { header: "Amount1", width: 16 },
          { header: "USD", width: 12 },
          { header: "Owner", width: 14 },
        ]);
        for (const b of result) {
          table.push([
            formatTimestamp(b.timestamp),
            parseFloat(b.amount0).toPrecision(6),
            parseFloat(b.amount1).toPrecision(6),
            b.amountUSD ? formatUsd(b.amountUSD) : "-",
            b.owner ? truncAddr(b.owner) : "-",
          ]);
        }
        writeStderr(table.toString());
      }
    });

  lp.command("collects <pool>")
    .description("Collect events for a pool")
    .option("--limit <n>", "Number of events", "20")
    .action(async (poolId: string, options: { limit: string }) => {
      const addr = requireAddress(poolId, "pool");
      const limit = parseLimit(options.limit, "limit");

      const spin = spinner("Fetching collects...");
      spin.start();

      const result = await subgraphClient.getCollects(addr, { limit });
      spin.succeed(`Fetched ${result.length} collects`);

      if (isHeadless()) {
        writeJsonSuccess({ poolId: addr, collects: result });
      } else {
        const table = createTable([
          { header: "Time", width: 22 },
          { header: "Amount0", width: 16 },
          { header: "Amount1", width: 16 },
          { header: "USD", width: 12 },
          { header: "Owner", width: 14 },
        ]);
        for (const c of result) {
          table.push([
            formatTimestamp(c.timestamp),
            parseFloat(c.amount0).toPrecision(6),
            parseFloat(c.amount1).toPrecision(6),
            c.amountUSD ? formatUsd(c.amountUSD) : "-",
            c.owner ? truncAddr(c.owner) : "-",
          ]);
        }
        writeStderr(table.toString());
      }
    });

  subgraph.addCommand(lp);

  // ============ DEX STATS ============
  subgraph
    .command("dex-stats")
    .description("Global DEX daily stats")
    .option("--days <n>", "Number of days", "7")
    .action(async (options: { days: string }) => {
      const days = parseLimit(options.days, "days");

      const spin = spinner("Fetching DEX stats...");
      spin.start();

      const result = await subgraphClient.getDexDayData(days);
      spin.succeed(`Fetched ${result.length} days`);

      if (isHeadless()) {
        writeJsonSuccess({ dexDayData: result });
      } else {
        const table = createTable([
          { header: "Date", width: 12 },
          { header: "Volume", width: 14 },
          { header: "Fees", width: 12 },
          { header: "TVL", width: 14 },
          { header: "Txns", width: 10 },
        ]);
        for (const d of result) {
          table.push([
            new Date(d.date * 1000).toISOString().slice(0, 10),
            formatUsd(d.volumeUSD),
            formatUsd(d.feesUSD),
            formatUsd(d.tvlUSD),
            d.txCount,
          ]);
        }
        writeStderr(table.toString());
      }
    });

  // ============ TOKEN ============
  subgraph
    .command("token <address>")
    .description("Token info (TVL, volume, derivedETH)")
    .action(async (address: string) => {
      const tokenAddr = requireAddress(address, "token");

      const spin = spinner("Fetching token...");
      spin.start();

      const result = await subgraphClient.getToken(tokenAddr);
      spin.succeed("Token loaded");

      if (!result) {
        throw new EchoError(ErrorCodes.TOKEN_NOT_FOUND, `Token not found: ${address}`);
      }

      if (isHeadless()) {
        writeJsonSuccess({ token: result });
      } else {
        infoBox(
          `Token: ${result.symbol}`,
          `Name: ${result.name}\n` +
          `Address: ${colors.address(result.id)}\n` +
          `Decimals: ${result.decimals}\n` +
          `TVL: ${colors.value(formatUsd(result.totalValueLockedUSD))}\n` +
          `Volume: ${colors.value(formatUsd(result.volumeUSD))}\n` +
          `Fees: ${colors.value(formatUsd(result.feesUSD))}\n` +
          `Pools: ${result.poolCount}\n` +
          `Txns: ${result.txCount}\n` +
          `DerivedETH: ${result.derivedETH}`
        );
      }
    });

  // ============ TOP TOKENS ============
  subgraph
    .command("top-tokens")
    .description("Top tokens by TVL or volume")
    .option("--limit <n>", "Number of tokens", "20")
    .option("--by <metric>", "Sort by tvl or volume", "tvl")
    .action(async (options: { limit: string; by: string }) => {
      const limit = parseLimit(options.limit, "limit");
      const by = options.by === "volume" ? "volume" as const : "tvl" as const;

      const spin = spinner(`Fetching top tokens by ${by}...`);
      spin.start();

      const result = await subgraphClient.getTopTokens({ limit, by });
      spin.succeed(`Fetched ${result.length} tokens`);

      if (isHeadless()) {
        writeJsonSuccess({ tokens: result, sortedBy: by });
      } else {
        const table = createTable([
          { header: "Symbol", width: 10 },
          { header: "Name", width: 16 },
          { header: "TVL", width: 14 },
          { header: "Volume", width: 14 },
          { header: "Pools", width: 6 },
          { header: "DerivedETH", width: 14 },
        ]);
        for (const t of result) {
          table.push([
            t.symbol,
            t.name.length > 16 ? t.name.slice(0, 14) + ".." : t.name,
            formatUsd(t.totalValueLockedUSD),
            formatUsd(t.volumeUSD),
            t.poolCount,
            parseFloat(t.derivedETH).toPrecision(6),
          ]);
        }
        writeStderr(table.toString());
      }
    });

  return subgraph;
}
