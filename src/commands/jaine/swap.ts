import { Command } from "commander";
import { isAddress, getAddress, parseUnits, formatUnits } from "viem";
import { loadConfig } from "../../config/store.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { resolveToken, getTokenSymbol } from "../../jaine/coreTokens.js";
import { loadUserTokens } from "../../jaine/userTokens.js";
import { findBestRouteExactInput, findBestRouteExactOutput, formatRoute } from "../../jaine/routing.js";
import { ensureAllowance } from "../../jaine/allowance.js";
import { ROUTER_ABI } from "../../jaine/abi/router.js";
import { getTokenDecimals } from "./helpers.js";

export function createSwapSubcommand(): Command {
  const swap = new Command("swap")
    .description("Swap tokens on Jaine DEX")
    .exitOverride();

  swap
    .command("sell <tokenIn> <tokenOut>")
    .description("Sell exact amount of tokenIn for tokenOut")
    .requiredOption("--amount-in <amount>", "Amount of tokenIn to sell")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--deadline-sec <sec>", "Transaction deadline in seconds", "90")
    .option("--recipient <address>", "Recipient address (defaults to wallet)")
    .option("--max-hops <n>", "Maximum routing hops", "3")
    .option("--approve-exact", "Approve exact amount instead of unlimited")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .action(
      async (
        tokenIn: string,
        tokenOut: string,
        options: {
          amountIn: string;
          slippageBps: string;
          deadlineSec: string;
          recipient?: string;
          maxHops: string;
          approveExact?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        }
      ) => {
        const userTokens = loadUserTokens();
        const tokenInAddr = resolveToken(tokenIn, userTokens.aliases);
        const tokenOutAddr = resolveToken(tokenOut, userTokens.aliases);

        const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));
        const maxHops = Math.min(Math.max(parseIntSafe(options.maxHops, "maxHops"), 1), 4);
        const deadlineSec = parseIntSafe(options.deadlineSec, "deadlineSec");

        const decimalsIn = await getTokenDecimals(tokenInAddr);
        const decimalsOut = await getTokenDecimals(tokenOutAddr);
        const amountIn = parseUnits(options.amountIn, decimalsIn);

        // Find best route
        const spin = spinner("Finding best route...");
        spin.start();

        const route = await findBestRouteExactInput(tokenInAddr, tokenOutAddr, amountIn, {
          maxHops,
        });

        if (!route) {
          spin.fail("No route found");
          throw new EchoError(ErrorCodes.NO_ROUTE_FOUND, "No route found for this swap");
        }

        spin.succeed("Route found");

        // Calculate minimum output with slippage
        const amountOutMinimum = (route.amountOut * BigInt(10000 - slippageBps)) / 10000n;

        const routeStr = formatRoute(route, userTokens.aliases);

        // Dry run output
        if (options.dryRun) {
          if (isHeadless()) {
            writeJsonSuccess({
              dryRun: true,
              tokenIn: tokenInAddr,
              tokenOut: tokenOutAddr,
              amountIn: amountIn.toString(),
              amountOut: route.amountOut.toString(),
              amountOutMinimum: amountOutMinimum.toString(),
              route: routeStr,
              hops: route.tokens.length - 1,
              slippageBps,
              formatted: {
                amountIn: options.amountIn,
                amountOut: formatUnits(route.amountOut, decimalsOut),
                amountOutMinimum: formatUnits(amountOutMinimum, decimalsOut),
              },
            });
          } else {
            infoBox(
              "Swap Quote (Dry Run)",
              `Sell: ${colors.value(options.amountIn)} ${getTokenSymbol(tokenInAddr, userTokens.aliases)}\n` +
                `Receive: ~${colors.value(formatUnits(route.amountOut, decimalsOut))} ${getTokenSymbol(tokenOutAddr, userTokens.aliases)}\n` +
                `Min receive: ${colors.value(formatUnits(amountOutMinimum, decimalsOut))}\n` +
                `Route: ${routeStr}\n` +
                `Slippage: ${(slippageBps / 100).toFixed(2)}%`
            );
          }
          return;
        }

        // Require --yes for actual execution
        if (!options.yes) {
          throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
        }

        const { address, privateKey } = requireWalletAndKeystore();
        const cfg = loadConfig();

        let recipient = address;
        if (options.recipient) {
          if (!isAddress(options.recipient)) {
            throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid recipient: ${options.recipient}`);
          }
          recipient = getAddress(options.recipient);
        }

        // Check and approve if needed
        const spinApprove = spinner("Checking allowance...");
        spinApprove.start();

        const approvalResult = await ensureAllowance(
          tokenInAddr,
          cfg.protocol.jaineRouter,
          amountIn,
          privateKey,
          options.approveExact
        );

        if (approvalResult && approvalResult.txHash !== "0x0") {
          spinApprove.succeed("Token approved");
        } else {
          spinApprove.succeed("Allowance sufficient");
        }

        // Execute swap
        const spinSwap = spinner("Executing swap...");
        spinSwap.start();

        const walletClient = getSigningClient(privateKey);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);

        try {
          const txHash = await walletClient.writeContract({
            address: cfg.protocol.jaineRouter,
            abi: ROUTER_ABI,
            functionName: "exactInput",
            args: [
              {
                path: route.encodedPath,
                recipient,
                deadline,
                amountIn,
                amountOutMinimum,
              },
            ],
          });

          spinSwap.succeed("Swap executed");

          const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

          if (isHeadless()) {
            writeJsonSuccess({
              txHash,
              explorerUrl,
              tokenIn: tokenInAddr,
              tokenOut: tokenOutAddr,
              amountIn: amountIn.toString(),
              amountOutExpected: route.amountOut.toString(),
              amountOutMinimum: amountOutMinimum.toString(),
              route: routeStr,
              recipient,
            });
          } else {
            successBox(
              "Swap Executed",
              `Sold: ${colors.value(options.amountIn)} ${getTokenSymbol(tokenInAddr, userTokens.aliases)}\n` +
                `Expected: ~${colors.value(formatUnits(route.amountOut, decimalsOut))} ${getTokenSymbol(tokenOutAddr, userTokens.aliases)}\n` +
                `Route: ${routeStr}\n` +
                `Tx: ${colors.info(txHash)}\n` +
                `Explorer: ${colors.muted(explorerUrl)}`
            );
          }
        } catch (err) {
          spinSwap.fail("Swap failed");
          throw new EchoError(ErrorCodes.SWAP_FAILED, `Swap failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    );

  swap
    .command("buy <tokenIn> <tokenOut>")
    .description("Buy exact amount of tokenOut using tokenIn")
    .requiredOption("--amount-out <amount>", "Amount of tokenOut to buy")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--deadline-sec <sec>", "Transaction deadline in seconds", "90")
    .option("--recipient <address>", "Recipient address (defaults to wallet)")
    .option("--max-hops <n>", "Maximum routing hops", "3")
    .option("--approve-exact", "Approve exact amount instead of unlimited")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .action(
      async (
        tokenIn: string,
        tokenOut: string,
        options: {
          amountOut: string;
          slippageBps: string;
          deadlineSec: string;
          recipient?: string;
          maxHops: string;
          approveExact?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        }
      ) => {
        const userTokens = loadUserTokens();
        const tokenInAddr = resolveToken(tokenIn, userTokens.aliases);
        const tokenOutAddr = resolveToken(tokenOut, userTokens.aliases);

        const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));
        const maxHops = Math.min(Math.max(parseIntSafe(options.maxHops, "maxHops"), 1), 4);
        const deadlineSec = parseIntSafe(options.deadlineSec, "deadlineSec");

        const decimalsIn = await getTokenDecimals(tokenInAddr);
        const decimalsOut = await getTokenDecimals(tokenOutAddr);
        const amountOut = parseUnits(options.amountOut, decimalsOut);

        // Find best route
        const spin = spinner("Finding best route...");
        spin.start();

        const route = await findBestRouteExactOutput(tokenInAddr, tokenOutAddr, amountOut, {
          maxHops,
        });

        if (!route) {
          spin.fail("No route found");
          throw new EchoError(ErrorCodes.NO_ROUTE_FOUND, "No route found for this swap");
        }

        spin.succeed("Route found");

        // Calculate maximum input with slippage
        const amountInMaximum = (route.amountIn * BigInt(10000 + slippageBps)) / 10000n;

        const routeStr = formatRoute(route, userTokens.aliases);

        // Dry run output
        if (options.dryRun) {
          if (isHeadless()) {
            writeJsonSuccess({
              dryRun: true,
              tokenIn: tokenInAddr,
              tokenOut: tokenOutAddr,
              amountOut: amountOut.toString(),
              amountIn: route.amountIn.toString(),
              amountInMaximum: amountInMaximum.toString(),
              route: routeStr,
              hops: route.tokens.length - 1,
              slippageBps,
              formatted: {
                amountOut: options.amountOut,
                amountIn: formatUnits(route.amountIn, decimalsIn),
                amountInMaximum: formatUnits(amountInMaximum, decimalsIn),
              },
            });
          } else {
            infoBox(
              "Swap Quote (Dry Run)",
              `Buy: ${colors.value(options.amountOut)} ${getTokenSymbol(tokenOutAddr, userTokens.aliases)}\n` +
                `Cost: ~${colors.value(formatUnits(route.amountIn, decimalsIn))} ${getTokenSymbol(tokenInAddr, userTokens.aliases)}\n` +
                `Max cost: ${colors.value(formatUnits(amountInMaximum, decimalsIn))}\n` +
                `Route: ${routeStr}\n` +
                `Slippage: ${(slippageBps / 100).toFixed(2)}%`
            );
          }
          return;
        }

        // Require --yes for actual execution
        if (!options.yes) {
          throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
        }

        const { address, privateKey } = requireWalletAndKeystore();
        const cfg = loadConfig();

        let recipient = address;
        if (options.recipient) {
          if (!isAddress(options.recipient)) {
            throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid recipient: ${options.recipient}`);
          }
          recipient = getAddress(options.recipient);
        }

        // Check and approve if needed
        const spinApprove = spinner("Checking allowance...");
        spinApprove.start();

        const approvalResult = await ensureAllowance(
          tokenInAddr,
          cfg.protocol.jaineRouter,
          amountInMaximum,
          privateKey,
          options.approveExact
        );

        if (approvalResult && approvalResult.txHash !== "0x0") {
          spinApprove.succeed("Token approved");
        } else {
          spinApprove.succeed("Allowance sufficient");
        }

        // Execute swap
        const spinSwap = spinner("Executing swap...");
        spinSwap.start();

        const walletClient = getSigningClient(privateKey);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);

        try {
          const txHash = await walletClient.writeContract({
            address: cfg.protocol.jaineRouter,
            abi: ROUTER_ABI,
            functionName: "exactOutput",
            args: [
              {
                path: route.encodedPath,
                recipient,
                deadline,
                amountOut,
                amountInMaximum,
              },
            ],
          });

          spinSwap.succeed("Swap executed");

          const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

          if (isHeadless()) {
            writeJsonSuccess({
              txHash,
              explorerUrl,
              tokenIn: tokenInAddr,
              tokenOut: tokenOutAddr,
              amountOut: amountOut.toString(),
              amountInExpected: route.amountIn.toString(),
              amountInMaximum: amountInMaximum.toString(),
              route: routeStr,
              recipient,
            });
          } else {
            successBox(
              "Swap Executed",
              `Bought: ${colors.value(options.amountOut)} ${getTokenSymbol(tokenOutAddr, userTokens.aliases)}\n` +
                `Expected cost: ~${colors.value(formatUnits(route.amountIn, decimalsIn))} ${getTokenSymbol(tokenInAddr, userTokens.aliases)}\n` +
                `Route: ${routeStr}\n` +
                `Tx: ${colors.info(txHash)}\n` +
                `Explorer: ${colors.muted(explorerUrl)}`
            );
          }
        } catch (err) {
          spinSwap.fail("Swap failed");
          throw new EchoError(ErrorCodes.SWAP_FAILED, `Swap failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    );

  return swap;
}
