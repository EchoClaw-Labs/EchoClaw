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
import { validateOfficialToken } from "./helpers.js";

export function createRewardSubcommand(): Command {
  const reward = new Command("reward")
    .description("Creator graduation reward")
    .exitOverride();

  reward
    .command("pending <token>")
    .description("Show pending creator graduation reward")
    .action(async (tokenArg: string) => {
      if (!isAddress(tokenArg)) {
        throw new EchoError(ErrorCodes.INVALID_ADDRESS, `Invalid address: ${tokenArg}`);
      }
      const tokenAddr = getAddress(tokenArg);

      await validateOfficialToken(tokenAddr);

      const client = getPublicClient();

      const [pendingReward, totalReward, symbol, isGraduated] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "pendingCreatorReward" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "CREATOR_GRADUATION_REWARD" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
        client.readContract({ address: tokenAddr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
      ]);

      if (isHeadless()) {
        writeJsonSuccess({
          token: tokenAddr,
          symbol,
          isGraduated,
          pendingReward: pendingReward.toString(),
          totalReward: totalReward.toString(),
          formatted: {
            pendingReward: formatUnits(pendingReward, 18),
            totalReward: formatUnits(totalReward, 18),
          },
        });
      } else {
        const statusNote = isGraduated
          ? pendingReward > 0n
            ? colors.success("Claimable")
            : colors.muted("Already claimed")
          : colors.muted("Not graduated yet");

        infoBox(
          `${symbol} Creator Reward`,
          `Status: ${statusNote}\n` +
            `Pending: ${colors.value(formatUnits(pendingReward, 18))} 0G\n` +
            `Total Reward: ${formatUnits(totalReward, 18)} 0G`
        );
      }
    });

  reward
    .command("claim <token>")
    .description("Claim creator graduation reward")
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

      const spin = spinner("Claiming creator reward...");
      spin.start();

      const walletClient = getSigningClient(privateKey);

      try {
        const txHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: SLOP_TOKEN_ABI,
          functionName: "claimCreatorReward",
        });

        spin.succeed("Creator reward claimed");

        const explorerUrl = `${cfg.chain.explorerUrl}/tx/${txHash}`;

        if (isHeadless()) {
          writeJsonSuccess({ txHash, explorerUrl, token: tokenAddr });
        } else {
          successBox(
            "Creator Reward Claimed",
            `Token: ${colors.address(tokenAddr)}\n` +
              `Tx: ${colors.info(txHash)}\n` +
              `Explorer: ${colors.muted(explorerUrl)}`
          );
        }
      } catch (err) {
        spin.fail("Claim failed");
        throw new EchoError(
          ErrorCodes.SLOP_TX_FAILED,
          `Reward claim failed: ${err instanceof Error ? err.message : err}`
        );
      }
    });

  return reward;
}
