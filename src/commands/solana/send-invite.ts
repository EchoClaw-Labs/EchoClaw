/**
 * Jupiter Send commands — send tokens via invite code, list pending, clawback.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { craftSend, craftClawback, getPendingInvites } from "../../chains/solana/send-service.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createSendInviteSubcommand(): Command {
  return new Command("send-invite")
    .description("Send tokens via Jupiter invite (recipients claim via Jupiter Mobile)")
    .requiredOption("--amount <n>", "Amount to send (SOL by default)")
    .option("--token <mint>", "Token mint (default: SOL)")
    .option("--yes", "Skip confirmation")
    .exitOverride()
    .action(async (options: { amount: string; token?: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const amount = Number(options.amount);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Send ${colors.info(`${amount} ${options.token ?? "SOL"}`)} via invite\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Creating send invite...");
      spin.start();

      try {
        const result = await craftSend(wallet.secretKey, amount, options.token);
        spin.succeed("Invite created");

        if (isHeadless()) {
          writeJsonSuccess({ action: "send-invite", ...result });
        } else {
          successBox("Invite Sent",
            `Amount: ${colors.info(`${amount} ${options.token ?? "SOL"}`)}\n` +
            `Invite Code: ${colors.info(result.inviteCode)}\n` +
            `Share this code with the recipient.\n` +
            `Signature: ${colors.muted(result.signature)}`);
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });
}

export function createInvitesSubcommand(): Command {
  return new Command("invites")
    .description("List pending send invites")
    .exitOverride()
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading invites...");
      spin.start();

      const invites = await getPendingInvites(wallet.address);
      spin.succeed(`${invites.length} pending invite(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ invites });
        return;
      }

      if (invites.length === 0) {
        infoBox("Invites", "No pending invites.");
        return;
      }

      printTable(
        [
          { header: "PDA", width: 14 },
          { header: "Amount", width: 14 },
          { header: "Token", width: 14 },
          { header: "Created", width: 20 },
        ],
        invites.map((i) => [
          `${i.invitePDA.slice(0, 4)}...${i.invitePDA.slice(-4)}`,
          i.amount,
          `${i.mint.slice(0, 4)}...${i.mint.slice(-4)}`,
          i.createdAt,
        ]),
      );
    });
}

export function createClawbackSubcommand(): Command {
  return new Command("clawback")
    .description("Recover unclaimed invite tokens")
    .argument("<invite-code>", "The invite code to clawback")
    .option("--yes", "Skip confirmation")
    .exitOverride()
    .action(async (inviteCode: string, options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Clawback invite: ${colors.muted(inviteCode)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Recovering tokens...");
      spin.start();

      try {
        const result = await craftClawback(wallet.secretKey, inviteCode);
        spin.succeed("Tokens recovered");

        if (isHeadless()) {
          writeJsonSuccess({ action: "clawback", ...result });
        } else {
          successBox("Clawback Complete", `Signature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Clawback failed"); throw err; }
    });
}
