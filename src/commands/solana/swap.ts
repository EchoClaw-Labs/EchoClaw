/**
 * Solana swap commands — Jupiter DEX aggregator.
 * Pattern: modeled after commands/jaine/swap.ts (dry-run / confirm / execute).
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { getSwapQuote, executeSwap } from "../../chains/solana/swap-service.js";
import { loadConfig } from "../../config/store.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, colors, warnBox } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

function formatQuoteDisplay(quote: Awaited<ReturnType<typeof getSwapQuote>>["quote"]): string {
  const routeStr = quote.route.length > 0 ? quote.route.join(" → ") : "direct";
  return (
    `${colors.info(`${quote.inputAmount} ${quote.inputToken.symbol}`)} → ` +
    `${colors.info(`${quote.outputAmount} ${quote.outputToken.symbol}`)}\n` +
    `Price impact: ${colors.muted(quote.priceImpactPct + "%")}\n` +
    `Route: ${colors.muted(routeStr)} (${quote.provider})\n` +
    `Slippage: ${colors.muted((quote.slippageBps / 100).toFixed(1) + "%")}`
  );
}

export function createSwapSubcommand(): Command {
  const swap = new Command("swap")
    .description("Swap tokens via Jupiter (aggregates Raydium, Orca, Meteora)")
    .exitOverride();

  // echoclaw solana swap quote <from> <to> --amount <n>
  swap
    .command("quote <from> <to>")
    .description("Get a swap quote without executing")
    .requiredOption("--amount <n>", "Amount of input token")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .action(async (from: string, to: string, options: { amount: string; slippageBps: string }) => {
      const amount = Number(options.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        throw new EchoError(ErrorCodes.SOLANA_QUOTE_FAILED, `Invalid amount: ${options.amount}`);
      }

      const spin = spinner(`Getting quote: ${from} → ${to}...`);
      spin.start();

      try {
        const { quote } = await getSwapQuote(from, to, amount, {
          slippageBps: Number(options.slippageBps),
        });
        spin.succeed("Quote received");

        if (isHeadless()) {
          writeJsonSuccess({
            inputToken: quote.inputToken.symbol,
            inputMint: quote.inputToken.address,
            outputToken: quote.outputToken.symbol,
            outputMint: quote.outputToken.address,
            inputAmount: quote.inputAmount,
            outputAmount: quote.outputAmount,
            priceImpactPct: quote.priceImpactPct,
            route: quote.route,
            provider: quote.provider,
            slippageBps: quote.slippageBps,
          });
        } else {
          infoBox("Swap Quote", formatQuoteDisplay(quote));
        }
      } catch (err) {
        spin.fail("Quote failed");
        throw err;
      }
    });

  // echoclaw solana swap execute <from> <to> --amount <n> --yes
  swap
    .command("execute <from> <to>")
    .description("Execute a token swap")
    .requiredOption("--amount <n>", "Amount of input token")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--yes", "Skip confirmation prompt")
    .action(async (from: string, to: string, options: { amount: string; slippageBps: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const amount = Number(options.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        throw new EchoError(ErrorCodes.SOLANA_SWAP_FAILED, `Invalid amount: ${options.amount}`);
      }

      const cluster = loadConfig().solana.cluster;
      if (cluster !== "mainnet-beta" && !isHeadless()) {
        warnBox("Network Warning", `You are on ${colors.info(cluster)}, not mainnet.`);
      }

      // Show quote first
      const quoteSpin = spinner(`Getting quote: ${from} → ${to}...`);
      quoteSpin.start();

      const { quote } = await getSwapQuote(from, to, amount, {
        slippageBps: Number(options.slippageBps),
      });
      quoteSpin.succeed("Quote received");

      if (!isHeadless()) {
        infoBox("Swap Preview", formatQuoteDisplay(quote));
      }

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Use ${colors.muted("--yes")} to execute this swap.\n\n`);
        throw new EchoError(
          ErrorCodes.CONFIRMATION_REQUIRED,
          "Confirmation required. Add --yes to proceed.",
        );
      }

      const execSpin = spinner(`Swapping ${quote.inputAmount} ${quote.inputToken.symbol} → ${quote.outputToken.symbol}...`);
      execSpin.start();

      try {
        const result = await executeSwap(from, to, amount, wallet.secretKey, {
          slippageBps: Number(options.slippageBps),
        });
        execSpin.succeed("Swap executed");

        if (isHeadless()) {
          writeJsonSuccess({
            signature: result.signature,
            explorerUrl: result.explorerUrl,
            inputToken: quote.inputToken.symbol,
            outputToken: quote.outputToken.symbol,
            inputAmount: result.inputAmount,
            outputAmount: result.outputAmount,
            provider: quote.provider,
          });
        } else {
          successBox(
            "Swap Complete",
            `${colors.info(`${result.inputAmount} ${quote.inputToken.symbol}`)} → ` +
            `${colors.info(`${result.outputAmount} ${quote.outputToken.symbol}`)}\n` +
            `Signature: ${colors.muted(result.signature)}\n` +
            `Explorer: ${colors.muted(result.explorerUrl)}`,
          );
        }
      } catch (err) {
        execSpin.fail("Swap failed");
        throw err;
      }
    });

  return swap;
}
