import { Command } from "commander";
import { isAddress, getAddress, formatUnits } from "viem";
import { loadConfig } from "../../config/store.js";
import { getPublicClient } from "../../wallet/client.js";
import { requireWalletAndKeystore } from "../../wallet/auth.js";
import { getSigningClient } from "../../wallet/signingClient.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";
import { SLOP_TOKEN_ABI } from "../../slop/abi/token.js";
import { SLOP_FEE_COLLECTOR_ABI } from "../../slop/abi/feeCollector.js";
import { validateOfficialToken } from "./helpers.js";

export function createFeesSubcommand(): Command {
  const fees = new Command("fees")
    .description("Fee management")
    .exitOverride();

  fees
    .command("stats <token>")
    .description("Show fee statistics for a token")
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const cfg = loadConfig();
      const client = getPublicClient();

      const [feeStats, symbol] = await Promise.all([
        client.readContract({
          address: cfg.slop.feeCollector,
          abi: SLOP_FEE_COLLECTOR_ABI,
          functionName: "getTokenFeeStats",
          args: [tokenAddr],
        }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      ]);

      const [totalCreator, totalPlatform, pendingCreator, pendingPlatform, volume] = feeStats;

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          totalCreatorFees: totalCreator.toString(),
          totalPlatformFees: totalPlatform.toString(),
          pendingCreatorFees: pendingCreator.toString(),
          pendingPlatformFees: pendingPlatform.toString(),
          totalVolume: volume.toString(),
          formatted: {
            totalCreatorFees: formatUnits(totalCreator, 18),
            totalPlatformFees: formatUnits(totalPlatform, 18),
            pendingCreatorFees: formatUnits(pendingCreator, 18),
            pendingPlatformFees: formatUnits(pendingPlatform, 18),
            totalVolume: formatUnits(volume, 18),
          },
        });
      } else {
        infoBox(
          `${symbol} Fee Stats`,
          `Total Volume: ${colors.value(formatUnits(volume, 18))} 0G\n` +
            `\nCreator Fees:\n` +
            `  Total: ${colors.value(formatUnits(totalCreator, 18))} 0G\n` +
            `  Pending: ${colors.value(formatUnits(pendingCreator, 18))} 0G\n` +
            `\nPlatform Fees:\n` +
            `  Total: ${colors.value(formatUnits(totalPlatform, 18))} 0G`
        );
      }
    });

  fees
    .command("claim-creator <token>")
    .description("Withdraw pending creator fees")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (tokenArg: string, options: { yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const { privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const spin = spinner("Withdrawing creator fees...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: cfg.slop.feeCollector,
          abi: SLOP_FEE_COLLECTOR_ABI,
          functionName: "withdrawCreatorFees",
          args: [tokenAddr],
        });

        spin.succeed("Creator fees withdrawn");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({ txHash, explorerUrl, token: tokenAddr });
        } else {
          successBox(
            "Creator Fees Withdrawn",
            `Token: ${colors.address(tokenAddr)}\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Withdrawal failed");
        throw new EchoError(
          ErrorCodes.SLOP_TX_FAILED,
          `Withdrawal failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  const lpFees = new Command("lp")
    .description("LP fees (post-graduation)")
    .exitOverride();

  lpFees
    .command("pending <token>")
    .description("Show pending LP fees")
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const client = getPublicClient();

      const [isGraduated, symbol] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      ]);

      if (!isGraduated) {
        if (isHeadless()) {
          writeJsonSuccess({
            token: tokenAddr,
            symbol,
            isGraduated: false,
            pendingW0G: "0",
            pendingToken: "0",
            note: "Token not graduated - no LP fees yet",
          });
        } else {
          infoBox(`${symbol} LP Fees`, "Token not graduated - no LP fees yet");
        }
        return;
      }

      const [pendingW0G, pendingToken] = await client.readContract({
        address: tokenAddr,
        abi: SLOP_TOKEN_ABI,
        functionName: "getPendingLPFees",
      });

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          isGraduated: true,
          pendingW0G: pendingW0G.toString(),
          pendingToken: pendingToken.toString(),
          formatted: {
            pendingW0G: formatUnits(pendingW0G, 18),
            pendingToken: formatUnits(pendingToken, 18),
          },
        });
      } else {
        infoBox(
          `${symbol} LP Fees`,
          `Pending W0G: ${colors.value(formatUnits(pendingW0G, 18))}\n` +
            `Pending ${symbol}: ${colors.value(formatUnits(pendingToken, 18))}`
        );
      }
    });

  lpFees
    .command("collect <token>")
    .description("Collect LP fees (creator only)")
    .option("--recipient <address>", "Recipient address (default: wallet)")
    .requiredOption("--yes", "Confirm the transaction")
    .action(async (tokenArg: string, options: { recipient?: string; yes: boolean }) => {
      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm");
      }

      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const { address, privateKey } = requireWalletAndKeystore();
      const cfg = loadConfig();

      const recipient = options.recipient ? getAddress(options.recipient) : address;

      const spin = spinner("Collecting LP fees...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: SLOP_TOKEN_ABI,
          functionName: "collectLPFees",
          args: [recipient],
        });

        spin.succeed("LP fees collected");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({ txHash, explorerUrl, token: tokenAddr, recipient });
        } else {
          successBox(
            "LP Fees Collected",
            `Token: ${colors.address(tokenAddr)}\n` +
              `Recipient: ${colors.address(recipient)}\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Collection failed");
        throw new EchoError(
          ErrorCodes.SLOP_TX_FAILED,
          `LP fee collection failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  fees.addCommand(lpFees);

  return fees;
}
