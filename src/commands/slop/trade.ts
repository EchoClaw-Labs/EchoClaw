import { Command } from "commander";
import { isAddress, getAddress, formatUnits } from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { SLOP_TOKEN_ABI } from "../../slop/abi/token.js";
import {
  calculateOgOut,
  calculatePartialFill,
  applySlippage,
} from "../../slop/quote.js";
import {
  parseUnitsSafe,
  validateOfficialToken,
  checkNotGraduated,
  checkTradingEnabled,
  getTokenState,
} from "./helpers.js";

export function createTradeSubcommand(): Command {
  const trade = new Command("trade")
    .description("Trade on bonding curve (pre-graduation)")
    .exitOverride();

  trade
    .command("buy <token>")
    .description("Buy tokens with 0G")
    .requiredOption("--amount-og <amount>", "Amount of 0G to spend")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .action(async (tokenArg: string, options: {
      amountOg: string;
      slippageBps: string;
      dryRun?: boolean;
      yes?: boolean;
    }) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);
      await checkNotGraduated(tokenAddr);
      await checkTradingEnabled(tokenAddr);

      const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));
      const ogAmountWei = parseUnitsSafe(options.amountOg, 18, "amount-og");

      if (ogAmountWei <= 0n) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be > 0");
      }

      const client = getPublicClient();
      const state = await getTokenState(tokenAddr);

      // Calculate quote with partial fill logic
      let quote: ReturnType<typeof calculatePartialFill>;
      try {
        quote = calculatePartialFill(
          state.ogReserves,
          state.tokenReserves,
          state.virtualTokenReserves,
          state.curveSupply,
          ogAmountWei,
          state.buyFeeBps
        );
      } catch (err) {
        throw new EchoError(
          ErrorCodes.SLOP_QUOTE_FAILED,
          `Quote failed: ${err instanceof Error ? err.message : err}`
        );
      }

      const minTokensOut = applySlippage(quote.tokensOut, BigInt(slippageBps));

      // Fetch token symbol for display
      const symbol = await client.readContract({
        address: tokenAddr,
        abi: SLOP_TOKEN_ABI,
        functionName: "symbol",
      });

      // Dry run output
      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true,
            token: tokenAddr,
            symbol,
            amountOgWei: ogAmountWei.toString(),
            tokensOut: quote.tokensOut.toString(),
            minTokensOut: minTokensOut.toString(),
            ogUsed: quote.ogUsed.toString(),
            feeUsed: quote.feeUsed.toString(),
            refund: quote.refund.toString(),
            hitCap: quote.hitCap,
            slippageBps,
            formatted: {
              amountOg: options.amountOg,
              tokensOut: formatUnits(quote.tokensOut, 18),
              minTokensOut: formatUnits(minTokensOut, 18),
              refund: formatUnits(quote.refund, 18),
            },
          });
        } else {
          infoBox(
            "Buy Quote (Dry Run)",
            `Spend: ${colors.value(options.amountOg)} 0G\n` +
              `Receive: ~${colors.value(formatUnits(quote.tokensOut, 18))} ${symbol}\n` +
              `Min receive: ${colors.value(formatUnits(minTokensOut, 18))} ${symbol}\n` +
              `Fee: ${colors.muted(formatUnits(quote.feeUsed, 18))} 0G\n` +
              (quote.hitCap ? `${colors.warn("Partial fill")} - refund: ${formatUnits(quote.refund, 18)} 0G\n` : "") +
              `Slippage: ${(slippageBps / 100).toFixed(2)}%`
          );
        }
        return;
      }

      // Require --yes for execution
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      const { privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const spin = spinner("Executing buy...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: SLOP_TOKEN_ABI,
          functionName: "buyWithSlippage",
          args: [minTokensOut],
          value: ogAmountWei,
        });

        spin.succeed("Buy executed");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({
            txHash,
            explorerUrl,
            token: tokenAddr,
            symbol,
            quote: {
              tokensOut: quote.tokensOut.toString(),
              minTokensOut: minTokensOut.toString(),
              ogUsed: quote.ogUsed.toString(),
              feeUsed: quote.feeUsed.toString(),
              refund: quote.refund.toString(),
              hitCap: quote.hitCap,
            },
          });
        } else {
          successBox(
            "Buy Executed",
            `Spent: ${colors.value(options.amountOg)} 0G\n` +
              `Expected: ~${colors.value(formatUnits(quote.tokensOut, 18))} ${symbol}\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Buy failed");
        throw new EchoError(
          ErrorCodes.SLOP_TX_FAILED,
          `Buy failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  trade
    .command("sell <token>")
    .description("Sell tokens for 0G")
    .requiredOption("--amount-tokens <amount>", "Amount of tokens to sell")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .action(async (tokenArg: string, options: {
      amountTokens: string;
      slippageBps: string;
      dryRun?: boolean;
      yes?: boolean;
    }) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);
      await checkNotGraduated(tokenAddr);
      await checkTradingEnabled(tokenAddr);

      const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));
      const tokenAmountWei = parseUnitsSafe(options.amountTokens, 18, "amount-tokens");

      if (tokenAmountWei <= 0n) {
        throw new EchoError(ErrorCodes.INVALID_AMOUNT, "Amount must be > 0");
      }

      const client = getPublicClient();
      const cfg = loadConfig();
      const state = await getTokenState(tokenAddr);

      // Calculate quote
      let ogOutGross: bigint;
      try {
        ogOutGross = calculateOgOut(
          state.k,
          state.ogReserves,
          state.tokenReserves,
          tokenAmountWei
        );
      } catch (err) {
        throw new EchoError(
          ErrorCodes.SLOP_QUOTE_FAILED,
          `Quote failed: ${err instanceof Error ? err.message : err}`
        );
      }

      const fee = (ogOutGross * state.sellFeeBps) / 10000n;
      const ogOutNet = ogOutGross - fee;
      const minOgOut = applySlippage(ogOutNet, BigInt(slippageBps));

      // Fetch token symbol for display
      const symbol = await client.readContract({
        address: tokenAddr,
        abi: SLOP_TOKEN_ABI,
        functionName: "symbol",
      });

      // Dry run output
      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true,
            token: tokenAddr,
            symbol,
            tokenAmountWei: tokenAmountWei.toString(),
            ogOutGross: ogOutGross.toString(),
            ogOutNet: ogOutNet.toString(),
            minOgOut: minOgOut.toString(),
            fee: fee.toString(),
            slippageBps,
            formatted: {
              amountTokens: options.amountTokens,
              ogOutNet: formatUnits(ogOutNet, 18),
              minOgOut: formatUnits(minOgOut, 18),
              fee: formatUnits(fee, 18),
            },
          });
        } else {
          infoBox(
            "Sell Quote (Dry Run)",
            `Sell: ${colors.value(options.amountTokens)} ${symbol}\n` +
              `Receive: ~${colors.value(formatUnits(ogOutNet, 18))} 0G\n` +
              `Min receive: ${colors.value(formatUnits(minOgOut, 18))} 0G\n` +
              `Fee: ${colors.muted(formatUnits(fee, 18))} 0G\n` +
              `Slippage: ${(slippageBps / 100).toFixed(2)}%`
          );
        }
        return;
      }

      // Require --yes for execution
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      // Check balance
      const { address, privateKey } = requireWalletAndKeystore();

      const balance = await client.readContract({
        address: tokenAddr,
        abi: SLOP_TOKEN_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      if (balance < tokenAmountWei) {
        throw new EchoError(
          ErrorCodes.SLOP_INSUFFICIENT_BALANCE,
          `Insufficient balance: ${formatUnits(balance, 18)} ${symbol}`,
          `You need ${options.amountTokens} ${symbol}`
        );
      }

      const spin = spinner("Executing sell...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: SLOP_TOKEN_ABI,
          functionName: "sellWithSlippage",
          args: [tokenAmountWei, minOgOut],
        });

        spin.succeed("Sell executed");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({
            txHash,
            explorerUrl,
            token: tokenAddr,
            symbol,
            quote: {
              tokensSold: tokenAmountWei.toString(),
              ogOutNet: ogOutNet.toString(),
              minOgOut: minOgOut.toString(),
              fee: fee.toString(),
            },
          });
        } else {
          successBox(
            "Sell Executed",
            `Sold: ${colors.value(options.amountTokens)} ${symbol}\n` +
              `Expected: ~${colors.value(formatUnits(ogOutNet, 18))} 0G\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Sell failed");
        throw new EchoError(
          ErrorCodes.SLOP_TX_FAILED,
          `Sell failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  return trade;
}
