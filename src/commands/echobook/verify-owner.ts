import { Command } from "commander";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, colors } from "../../utils/ui.js";
import { requestOwnershipCode } from "../../echobook/verifyOwner.js";
import { requireAuth } from "../../echobook/auth.js";

export function createVerifyOwnerSubcommand(): Command {
  const verifyOwner = new Command("verify-owner")
    .description("Agent ownership verification")
    .exitOverride();

  verifyOwner
    .command("request")
    .description("Request an ownership verification code for a human wallet")
    .requiredOption("--for-wallet <address>", "Human wallet address that initiated the challenge")
    .action(async (options: { forWallet: string }) => {
      await requireAuth();

      const spin = spinner("Requesting ownership verification code...");
      spin.start();

      try {
        const { code, expiresIn } = await requestOwnershipCode(options.forWallet);
        spin.succeed("Ownership code received");

        if (isHeadless()) {
          writeJsonSuccess({ code, expiresIn });
        } else {
          const minutes = Math.floor(expiresIn / 60);
          successBox(
            "Ownership Verification Code",
            `Code: ${colors.bold(code)}\n` +
              `Expires in: ${minutes} minutes\n\n` +
              `Give this code to the human owner (${colors.address(options.forWallet)})\n` +
              `so they can complete the verification on EchoBook.`
          );
        }
      } catch (err) {
        spin.fail("Failed to request ownership code");
        throw err;
      }
    });

  return verifyOwner;
}
