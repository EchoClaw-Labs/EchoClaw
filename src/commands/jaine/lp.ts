import { Command } from "commander";
import {
  parseUnits,
  formatUnits,
  getAddress,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess, writeStderr } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors, createTable } from "../../utils/ui.js";
import { resolveToken, getTokenSymbol } from "../../jaine/coreTokens.js";
import { loadUserTokens } from "../../jaine/userTokens.js";
import { NFT_MANAGER_ABI } from "../../jaine/abi/nftManager.js";
import { POOL_ABI } from "../../jaine/abi/pool.js";
import { type FeeTier } from "../../jaine/abi/factory.js";
import { ensureAllowance } from "../../jaine/allowance.js";
import { validateFeeTier, getTokenDecimals } from "./helpers.js";

export function createLpSubcommand(): Command {
  const lp = new Command("lp")
    .description("Liquidity position management")
    .exitOverride();

  lp.command("list")
    .description("List your LP positions")
    .action(async () => {
      const cfg = loadConfig();
      if (!cfg.wallet.address) {
        throw new EchoError(ErrorCodes.WALLET_NOT_CONFIGURED, "No wallet configured.");
      }

      const client = getPublicClient();
      const nftManager = cfg.protocol.nftPositionManager;

      const spin = spinner("Fetching positions...");
      spin.start();

      const balance = await client.readContract({
        address: nftManager,
        abi: NFT_MANAGER_ABI,
        functionName: "balanceOf",
        args: [cfg.wallet.address],
      });

      if (balance === 0n) {
        spin.succeed("No positions found");
        if (isHeadless()) {
          writeJsonSuccess({ positions: [] });
        } else {
          infoBox("LP Positions", "You have no LP positions.");
        }
        return;
      }

      // Fetch all token IDs
      const tokenIds: bigint[] = [];
      for (let i = 0n; i < balance; i++) {
        const tokenId = await client.readContract({
          address: nftManager,
          abi: NFT_MANAGER_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [cfg.wallet.address, i],
        });
        tokenIds.push(tokenId);
      }

      // Fetch position details
      const userTokens = loadUserTokens();
      const positions = [];

      for (const tokenId of tokenIds) {
        const position = await client.readContract({
          address: nftManager,
          abi: NFT_MANAGER_ABI,
          functionName: "positions",
          args: [tokenId],
        });

        const [
          ,
          ,
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity,
          ,
          ,
          tokensOwed0,
          tokensOwed1,
        ] = position;

        positions.push({
          tokenId: tokenId.toString(),
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity: liquidity.toString(),
          tokensOwed0: tokensOwed0.toString(),
          tokensOwed1: tokensOwed1.toString(),
        });
      }

      spin.succeed(`Found ${positions.length} positions`);

      if (isHeadless()) {
        writeJsonSuccess({ positions });
      } else {
        const table = createTable([
          { header: "ID", width: 8 },
          { header: "Pair", width: 20 },
          { header: "Fee", width: 8 },
          { header: "Liquidity", width: 20 },
        ]);

        for (const pos of positions) {
          const symbol0 = getTokenSymbol(pos.token0 as Address, userTokens.aliases);
          const symbol1 = getTokenSymbol(pos.token1 as Address, userTokens.aliases);
          table.push([
            pos.tokenId,
            `${symbol0}/${symbol1}`,
            `${(pos.fee / 10000).toFixed(2)}%`,
            pos.liquidity === "0" ? colors.muted("0") : pos.liquidity,
          ]);
        }

        writeStderr(table.toString());
      }
    });

  lp.command("show <tokenId>")
    .description("Show details of a specific LP position")
    .action(async (tokenId: string) => {
      const cfg = loadConfig();
      const client = getPublicClient();
      const nftManager = cfg.protocol.nftPositionManager;

      const spin = spinner("Fetching position...");
      spin.start();

      try {
        const position = await client.readContract({
          address: nftManager,
          abi: NFT_MANAGER_ABI,
          functionName: "positions",
          args: [BigInt(tokenId)],
        });

        const [
          nonce,
          operator,
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity,
          feeGrowthInside0LastX128,
          feeGrowthInside1LastX128,
          tokensOwed0,
          tokensOwed1,
        ] = position;

        spin.succeed("Position loaded");

        const userTokens = loadUserTokens();
        const [decimals0, decimals1] = await Promise.all([
          getTokenDecimals(token0),
          getTokenDecimals(token1),
        ]);

        const symbol0 = getTokenSymbol(token0, userTokens.aliases);
        const symbol1 = getTokenSymbol(token1, userTokens.aliases);

        if (isHeadless()) {
          writeJsonSuccess({
            tokenId,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity: liquidity.toString(),
            tokensOwed0: tokensOwed0.toString(),
            tokensOwed1: tokensOwed1.toString(),
            formatted: {
              pair: `${symbol0}/${symbol1}`,
              fee: `${(fee / 10000).toFixed(2)}%`,
              tokensOwed0: formatUnits(tokensOwed0, decimals0),
              tokensOwed1: formatUnits(tokensOwed1, decimals1),
            },
          });
        } else {
          infoBox(
            `Position #${tokenId}`,
            `Pair: ${colors.info(`${symbol0}/${symbol1}`)}\n` +
              `Fee: ${(fee / 10000).toFixed(2)}%\n` +
              `Tick Range: ${tickLower} → ${tickUpper}\n` +
              `Liquidity: ${liquidity.toString()}\n` +
              `\nUncollected Fees:\n` +
              `  ${symbol0}: ${colors.value(formatUnits(tokensOwed0, decimals0))}\n` +
              `  ${symbol1}: ${colors.value(formatUnits(tokensOwed1, decimals1))}`
          );
        }
      } catch (err) {
        spin.fail("Failed to fetch position");
        throw new EchoError(
          ErrorCodes.POSITION_NOT_FOUND,
          `Position not found: ${tokenId}`
        );
      }
    });

  lp.command("collect <tokenId>")
    .description("Collect fees from LP position")
    .option("--recipient <address>", "Recipient address")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (tokenId: string, options: { recipient?: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const { address, privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();
      const recipient = options.recipient ? getAddress(options.recipient) : address;

      const spin = spinner("Collecting fees...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: cfg.protocol.nftPositionManager,
          abi: NFT_MANAGER_ABI,
          functionName: "collect",
          args: [
            {
              tokenId: BigInt(tokenId),
              recipient,
              amount0Max: BigInt("0xffffffffffffffffffffffffffffffff"), // uint128 max
              amount1Max: BigInt("0xffffffffffffffffffffffffffffffff"),
            },
          ],
        });

        spin.succeed("Fees collected");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({ txHash, explorerUrl, tokenId, recipient });
        } else {
          successBox(
            "Fees Collected",
            `Position: #${tokenId}\n` +
              `Recipient: ${colors.address(recipient)}\n` +
              `Tx: ${colors.info(txHash)}`
          );
        }
      } catch (err) {
        spin.fail("Collection failed");
        throw new EchoError(
          ErrorCodes.LP_OPERATION_FAILED,
          `Failed to collect: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  lp.command("remove <tokenId>")
    .description("Remove liquidity from position")
    .requiredOption("--percent <n>", "Percentage of liquidity to remove (1-100)")
    .option("--burn", "Burn the NFT after removing all liquidity")
    .option("--slippage-bps <bps>", "Slippage tolerance", "50")
    .requiredOption("--yes", "Confirm the transaction")
    .action(
      async (
        tokenId: string,
        options: { percent: string; burn?: boolean; slippageBps: string; yes: boolean }
      ) => {
        if (!options.yes) {
          throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
        }

        const percent = parseIntSafe(options.percent, "percent");
        if (percent < 1 || percent > 100) {
          throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Percent must be between 1 and 100");
        }

        const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));
        const { address, privateKey } = requireWalletAndKeystore();
        const cfg = loadConfig();
        const client = getPublicClient();

        // Fetch position to get liquidity
        const spin = spinner("Fetching position...");
        spin.start();

        const position = await client.readContract({
          address: cfg.protocol.nftPositionManager,
          abi: NFT_MANAGER_ABI,
          functionName: "positions",
          args: [BigInt(tokenId)],
        });

        const [, , token0, token1, , , , liquidity] = position;

        // Allow operation even with 0 liquidity - user may want to collect fees and/or burn
        if (liquidity === 0n && !options.burn) {
          spin.fail("Position has no liquidity");
          throw new EchoError(
            ErrorCodes.LP_OPERATION_FAILED,
            "Position has no liquidity to remove",
            "Use --burn to collect any remaining fees and burn the NFT"
          );
        }

        const liquidityToRemove = (liquidity * BigInt(percent)) / 100n;

        spin.text = "Removing liquidity...";

        const walletClient = getSigningClient(privateKey);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);

        // Calculate minimum amounts with slippage (simplified - 0 for now)
        const amount0Min = 0n;
        const amount1Min = 0n;

        try {
          const MAX_UINT128 = (2n ** 128n) - 1n;
          const calls: Hex[] = [];

          // 1) decreaseLiquidity (only if there's liquidity to remove)
          if (liquidityToRemove > 0n) {
            calls.push(
              encodeFunctionData({
                abi: NFT_MANAGER_ABI,
                functionName: "decreaseLiquidity",
                args: [{
                  tokenId: BigInt(tokenId),
                  liquidity: liquidityToRemove,
                  amount0Min,
                  amount1Min,
                  deadline,
                }],
              })
            );
          }

          // 2) collect (always - clears tokensOwed)
          calls.push(
            encodeFunctionData({
              abi: NFT_MANAGER_ABI,
              functionName: "collect",
              args: [{
                tokenId: BigInt(tokenId),
                recipient: address,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128,
              }],
            })
          );

          // 3) burn (only with --burn and percent=100)
          const shouldBurn = options.burn && percent === 100;
          if (shouldBurn) {
            calls.push(
              encodeFunctionData({
                abi: NFT_MANAGER_ABI,
                functionName: "burn",
                args: [BigInt(tokenId)],
              })
            );
          }

          // Single atomic transaction via multicall
          const txHash = await walletClient.writeContract({
            address: cfg.protocol.nftPositionManager,
            abi: NFT_MANAGER_ABI,
            functionName: "multicall",
            args: [calls],
          });

          spin.succeed(shouldBurn ? "Liquidity removed and NFT burned" : "Liquidity removed");

          const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

          if (isHeadless()) {
            writeJsonSuccess({
              txHash,
              explorerUrl,
              tokenId,
              percent,
              liquidityRemoved: liquidityToRemove.toString(),
              burned: shouldBurn,
            });
          } else {
            successBox(
              shouldBurn ? "Liquidity Removed & NFT Burned" : "Liquidity Removed",
              `Position: #${tokenId}\n` +
                `Removed: ${percent}%\n` +
                `Tx: ${colors.info(txHash)}` +
                (shouldBurn ? `\n${colors.muted("NFT burned")}` : "")
            );
          }
        } catch (err) {
          spin.fail("Operation failed");
          throw new EchoError(
            ErrorCodes.LP_OPERATION_FAILED,
            `Failed to remove liquidity: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    );

  lp.command("add")
    .description("Add liquidity to create a new position")
    .requiredOption("--token0 <token>", "First token")
    .requiredOption("--token1 <token>", "Second token")
    .requiredOption("--fee <fee>", "Fee tier (100, 500, 3000, 10000)")
    .requiredOption("--amount0 <amount>", "Amount of token0")
    .requiredOption("--amount1 <amount>", "Amount of token1")
    .option("--range-pct <percent>", "Price range percentage around current price", "10")
    .option("--tick-lower <tick>", "Lower tick (overrides --range-pct)")
    .option("--tick-upper <tick>", "Upper tick (overrides --range-pct)")
    .option("--create-pool", "Create pool if it doesn't exist")
    .option("--sqrt-price-x96 <uint160>", "Initial sqrtPriceX96 for new pool (as decimal string)")
    .option("--approve-exact", "Approve exact amounts")
    .requiredOption("--yes", "Confirm the transaction")
    .action(
      async (options: {
        token0: string;
        token1: string;
        fee: string;
        amount0: string;
        amount1: string;
        rangePct: string;
        tickLower?: string;
        tickUpper?: string;
        createPool?: boolean;
        sqrtPriceX96?: string;
        approveExact?: boolean;
        yes: boolean;
      }) => {
        if (!options.yes) {
          throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
        }

        const userTokens = loadUserTokens();
        let token0Addr = resolveToken(options.token0, userTokens.aliases);
        let token1Addr = resolveToken(options.token1, userTokens.aliases);
        const fee = validateFeeTier(parseIntSafe(options.fee, "fee"));

        // Sort tokens (token0 < token1)
        if (token0Addr.toLowerCase() > token1Addr.toLowerCase()) {
          [token0Addr, token1Addr] = [token1Addr, token0Addr];
          [options.amount0, options.amount1] = [options.amount1, options.amount0];
        }

        const { address, privateKey } = requireWalletAndKeystore();
        const cfg = loadConfig();
        const client = getPublicClient();

        // Fetch decimals
        const [decimals0, decimals1] = await Promise.all([
          getTokenDecimals(token0Addr),
          getTokenDecimals(token1Addr),
        ]);

        const amount0Desired = parseUnits(options.amount0, decimals0);
        const amount1Desired = parseUnits(options.amount1, decimals1);

        // Check if pool exists
        const spin = spinner("Checking pool...");
        spin.start();

        const poolAddress = await client.readContract({
          address: cfg.protocol.jaineFactory,
          abi: [
            {
              type: "function",
              name: "getPool",
              stateMutability: "view",
              inputs: [
                { name: "tokenA", type: "address" },
                { name: "tokenB", type: "address" },
                { name: "fee", type: "uint24" },
              ],
              outputs: [{ name: "pool", type: "address" }],
            },
          ],
          functionName: "getPool",
          args: [token0Addr, token1Addr, fee],
        });

        const walletClient = getSigningClient(privateKey);

        if (poolAddress === "0x0000000000000000000000000000000000000000") {
          if (!options.createPool || !options.sqrtPriceX96) {
            spin.fail("Pool does not exist");
            throw new EchoError(
              ErrorCodes.POOL_NOT_FOUND,
              "Pool does not exist for this token pair and fee tier",
              "Use --create-pool --sqrt-price-x96 <uint160> to create it"
            );
          }

          // Create pool
          spin.text = "Creating pool...";

          // Parse sqrtPriceX96 as BigInt directly (precise, no float conversion)
          let sqrtPriceX96: bigint;
          try {
            sqrtPriceX96 = BigInt(options.sqrtPriceX96);
          } catch {
            throw new EchoError(
              ErrorCodes.INVALID_AMOUNT,
              `Invalid sqrtPriceX96: ${options.sqrtPriceX96}`,
              "Must be a valid uint160 decimal string"
            );
          }

          try {
            const createTxHash = await walletClient.writeContract({
              address: cfg.protocol.nftPositionManager,
              abi: NFT_MANAGER_ABI,
              functionName: "createAndInitializePoolIfNecessary",
              args: [token0Addr, token1Addr, fee, sqrtPriceX96],
            });
            // Wait for pool creation to confirm
            await client.waitForTransactionReceipt({ hash: createTxHash });
            spin.succeed("Pool created");
          } catch (err) {
            spin.fail("Failed to create pool");
            throw new EchoError(
              ErrorCodes.LP_OPERATION_FAILED,
              `Failed to create pool: ${err instanceof Error ? err.message : err}`
            );
          }
        } else {
          spin.succeed("Pool exists");
        }

        // Get current tick for range calculation
        const spinTick = spinner("Fetching pool state...");
        spinTick.start();

        let tickLower: number;
        let tickUpper: number;
        let tickSpacing: number;

        const poolAddr = poolAddress !== "0x0000000000000000000000000000000000000000"
          ? poolAddress
          : await client.readContract({
              address: cfg.protocol.jaineFactory,
              abi: [
                {
                  type: "function",
                  name: "getPool",
                  stateMutability: "view",
                  inputs: [
                    { name: "tokenA", type: "address" },
                    { name: "tokenB", type: "address" },
                    { name: "fee", type: "uint24" },
                  ],
                  outputs: [{ name: "pool", type: "address" }],
                },
              ],
              functionName: "getPool",
              args: [token0Addr, token1Addr, fee],
            });

        const [slot0, spacing] = await Promise.all([
          client.readContract({
            address: poolAddr as Address,
            abi: POOL_ABI,
            functionName: "slot0",
          }),
          client.readContract({
            address: poolAddr as Address,
            abi: POOL_ABI,
            functionName: "tickSpacing",
          }),
        ]);

        const currentTick = slot0[1];
        tickSpacing = spacing;

        if (options.tickLower && options.tickUpper) {
          tickLower = parseIntSafe(options.tickLower, "tickLower");
          tickUpper = parseIntSafe(options.tickUpper, "tickUpper");
        } else {
          // Calculate range based on percentage
          const rangePct = parseIntSafe(options.rangePct, "rangePct");
          // Approximate tick range: 1% price change ≈ 100 ticks
          const tickRange = Math.floor(rangePct * 100);
          tickLower = currentTick - tickRange;
          tickUpper = currentTick + tickRange;
        }

        // Round to tick spacing
        tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
        tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;

        spinTick.succeed("Pool state fetched");

        // Approve tokens
        const spinApprove = spinner("Approving tokens...");
        spinApprove.start();

        await ensureAllowance(
          token0Addr,
          cfg.protocol.nftPositionManager,
          amount0Desired,
          privateKey,
          options.approveExact
        );
        await ensureAllowance(
          token1Addr,
          cfg.protocol.nftPositionManager,
          amount1Desired,
          privateKey,
          options.approveExact
        );

        spinApprove.succeed("Tokens approved");

        // Mint position
        const spinMint = spinner("Minting position...");
        spinMint.start();

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);

        try {
          const txHash = await walletClient.writeContract({
            address: cfg.protocol.nftPositionManager,
            abi: NFT_MANAGER_ABI,
            functionName: "mint",
            args: [
              {
                token0: token0Addr,
                token1: token1Addr,
                fee,
                tickLower,
                tickUpper,
                amount0Desired,
                amount1Desired,
                amount0Min: 0n,
                amount1Min: 0n,
                recipient: address,
                deadline,
              },
            ],
          });

          spinMint.succeed("Position minted");

          const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

          const symbol0 = getTokenSymbol(token0Addr, userTokens.aliases);
          const symbol1 = getTokenSymbol(token1Addr, userTokens.aliases);

          if (isHeadless()) {
            writeJsonSuccess({
              txHash,
              explorerUrl,
              token0: token0Addr,
              token1: token1Addr,
              fee,
              tickLower,
              tickUpper,
              amount0Desired: amount0Desired.toString(),
              amount1Desired: amount1Desired.toString(),
            });
          } else {
            successBox(
              "Position Created",
              `Pair: ${colors.info(`${symbol0}/${symbol1}`)}\n` +
                `Fee: ${(fee / 10000).toFixed(2)}%\n` +
                `Range: ${tickLower} → ${tickUpper}\n` +
                `Amounts: ${options.amount0} ${symbol0} + ${options.amount1} ${symbol1}\n` +
                `Tx: ${colors.info(txHash)}\n` +
                `Explorer: ${colors.muted(explorerUrl)}`
            );
          }
        } catch (err) {
          spinMint.fail("Minting failed");
          throw new EchoError(
            ErrorCodes.LP_OPERATION_FAILED,
            `Failed to mint position: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    );

  lp.command("increase <tokenId>")
    .description("Add more liquidity to existing position")
    .requiredOption("--amount0 <amount>", "Amount of token0 to add")
    .requiredOption("--amount1 <amount>", "Amount of token1 to add")
    .option("--approve-exact", "Approve exact amounts")
    .requiredOption("--yes", "Confirm the transaction")
    .action(
      async (
        tokenId: string,
        options: { amount0: string; amount1: string; approveExact?: boolean; yes: boolean }
      ) => {
        if (!options.yes) {
          throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
        }

        const { address, privateKey } = requireWalletAndKeystore();
        const cfg = loadConfig();
        const client = getPublicClient();

        // Fetch position to get tokens
        const spin = spinner("Fetching position...");
        spin.start();

        const position = await client.readContract({
          address: cfg.protocol.nftPositionManager,
          abi: NFT_MANAGER_ABI,
          functionName: "positions",
          args: [BigInt(tokenId)],
        });

        const [, , token0, token1] = position;

        const [decimals0, decimals1] = await Promise.all([
          getTokenDecimals(token0),
          getTokenDecimals(token1),
        ]);

        const amount0Desired = parseUnits(options.amount0, decimals0);
        const amount1Desired = parseUnits(options.amount1, decimals1);

        spin.text = "Approving tokens...";

        await ensureAllowance(
          token0,
          cfg.protocol.nftPositionManager,
          amount0Desired,
          privateKey,
          options.approveExact
        );
        await ensureAllowance(
          token1,
          cfg.protocol.nftPositionManager,
          amount1Desired,
          privateKey,
          options.approveExact
        );

        spin.text = "Increasing liquidity...";

        const walletClient = getSigningClient(privateKey);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);

        try {
          const txHash = await walletClient.writeContract({
            address: cfg.protocol.nftPositionManager,
            abi: NFT_MANAGER_ABI,
            functionName: "increaseLiquidity",
            args: [
              {
                tokenId: BigInt(tokenId),
                amount0Desired,
                amount1Desired,
                amount0Min: 0n,
                amount1Min: 0n,
                deadline,
              },
            ],
          });

          spin.succeed("Liquidity increased");

          const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

          if (isHeadless()) {
            writeJsonSuccess({
              txHash,
              explorerUrl,
              tokenId,
              amount0Added: amount0Desired.toString(),
              amount1Added: amount1Desired.toString(),
            });
          } else {
            successBox(
              "Liquidity Increased",
              `Position: #${tokenId}\n` +
                `Added: ${options.amount0} + ${options.amount1}\n` +
                `Tx: ${colors.info(txHash)}`
            );
          }
        } catch (err) {
          spin.fail("Operation failed");
          throw new EchoError(
            ErrorCodes.LP_OPERATION_FAILED,
            `Failed to increase liquidity: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    );

  lp.command("rebalance <tokenId>")
    .description("Close position and open new one with different range")
    .requiredOption("--range-pct <percent>", "New price range percentage")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (tokenId: string, options: { rangePct: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      const instructions = [
        `echoclaw jaine lp remove ${tokenId} --percent 100 --yes`,
        `echoclaw jaine lp add --token0 <t0> --token1 <t1> --fee <fee> --amount0 <a0> --amount1 <a1> --range-pct ${options.rangePct} --yes`,
      ];

      // This is a compound operation: remove 100% + collect + mint new
      // For simplicity, we guide the user to do it in steps
      if (isHeadless()) {
        writeJsonSuccess({
          tokenId,
          rangePct: options.rangePct,
          instructions,
          note: "Rebalancing requires multiple transactions. Execute the instructions in order.",
        });
      } else {
        infoBox(
          "Rebalance Instructions",
          "Rebalancing requires multiple transactions:\n\n" +
            `1. Remove liquidity: ${instructions[0]}\n` +
            `2. Add new position: ${instructions[1]}`
        );
      }
    });

  return lp;
}
