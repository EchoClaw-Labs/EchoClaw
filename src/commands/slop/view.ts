import { Command } from "commander";
import { isAddress, getAddress, formatUnits } from "viem";
import { getPublicClient } from "../../wallet/client.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { infoBox, colors } from "../../utils/ui.js";
import { SLOP_TOKEN_ABI } from "../../slop/abi/token.js";
import { calculateGraduationProgress } from "../../slop/quote.js";
import { validateOfficialToken, getTokenState } from "./helpers.js";

export function createPriceSubcommand(): Command {
  return new Command("price")
    .argument("<token>", "Token address")
    .description("Get current token price")
    .exitOverride()
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const client = getPublicClient();

      const [[price, priceSource], symbol] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      ]);

      const sourceStr = priceSource === 0 ? "bonding" : "pool";

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          price: price.toString(),
          priceFormatted: formatUnits(price, 18),
          source: sourceStr,
        });
      } else {
        infoBox(
          `${symbol} Price`,
          `${colors.value(formatUnits(price, 18))} 0G per token\n` +
            `Source: ${sourceStr}`
        );
      }
    });
}

export function createCurveSubcommand(): Command {
  return new Command("curve")
    .argument("<token>", "Token address")
    .description("Show bonding curve state and graduation progress")
    .exitOverride()
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const client = getPublicClient();
      const state = await getTokenState(tokenAddr);

      const symbol = await client.readContract({
        address: tokenAddr,
        abi: SLOP_TOKEN_ABI,
        functionName: "symbol",
      });

      const graduationProgress = calculateGraduationProgress(
        state.tokenReserves,
        state.virtualTokenReserves,
        state.curveSupply
      );

      // Clamp to >= 0 for defensive safety (matches on-chain getRealOgReserves behavior)
      const realOg = state.ogReserves > state.virtualOgReserves
        ? state.ogReserves - state.virtualOgReserves
        : 0n;
      const tokensSold = state.virtualTokenReserves > state.tokenReserves
        ? state.virtualTokenReserves - state.tokenReserves
        : 0n;

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          isGraduated: state.isGraduated,
          reserves: {
            og: state.ogReserves.toString(),
            token: state.tokenReserves.toString(),
            virtualOg: state.virtualOgReserves.toString(),
            virtualToken: state.virtualTokenReserves.toString(),
            realOg: realOg.toString(),
            k: state.k.toString(),
          },
          curveSupply: state.curveSupply.toString(),
          tokensSold: tokensSold.toString(),
          graduationProgressBps: graduationProgress.toString(),
          graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
          graduationThresholdBps: "8000",
        });
      } else {
        const progressBar = (pct: number) => {
          const filled = Math.round(pct / 5);
          const empty = 20 - filled;
          return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${pct.toFixed(2)}%`;
        };

        const progressPct = Number(graduationProgress) / 100;

        infoBox(
          `${symbol} Bonding Curve`,
          `Status: ${state.isGraduated ? colors.success("Graduated") : colors.info("Active")}\n` +
            `\nReserves:\n` +
            `  0G: ${colors.value(formatUnits(state.ogReserves, 18))} (real: ${formatUnits(realOg, 18)})\n` +
            `  Token: ${colors.value(formatUnits(state.tokenReserves, 18))}\n` +
            `  K: ${state.k.toString()}\n` +
            `\nProgress to Graduation (80%):\n` +
            `  ${progressBar(progressPct)}\n` +
            `  Tokens sold: ${colors.value(formatUnits(tokensSold, 18))} / ${formatUnits(state.curveSupply, 18)}`
        );
      }
    });
}
