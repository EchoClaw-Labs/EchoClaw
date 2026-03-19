/**
 * Token burn and account close commands.
 * Recovers rent from empty SPL token accounts (~0.002 SOL each).
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { burnSplToken, closeEmptyAccounts } from "../../chains/solana/account-service.js";
import { resolveToken } from "../../chains/solana/token-registry.js";
import { parseSplAmount, shortenSolanaAddress } from "../../chains/solana/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, spinner, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createBurnSubcommand(): Command {
  const burn = new Command("burn")
    .description("Burn SPL tokens")
    .argument("<token>", "Token symbol or mint address")
    .argument("[amount]", "Amount to burn (default: all)")
    .option("--yes", "Skip confirmation")
    .exitOverride()
    .action(async (token: string, amount: string | undefined, options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      const tokenMeta = await resolveToken(token);
      if (!tokenMeta) {
        throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${token}`);
      }

      const burnAmount = amount ? parseSplAmount(amount, tokenMeta.decimals).atomic : undefined;

      if (!options.yes && !isHeadless()) {
        const label = amount ? `${amount} ${tokenMeta.symbol}` : `all ${tokenMeta.symbol}`;
        process.stderr.write(`\n  Burn ${colors.info(label)}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Burning ${tokenMeta.symbol}...`);
      spin.start();

      try {
        const result = await burnSplToken(wallet.secretKey, tokenMeta.address, burnAmount);
        spin.succeed("Tokens burned");

        if (isHeadless()) {
          writeJsonSuccess({ action: "burn", token: tokenMeta.symbol, mint: tokenMeta.address, ...result });
        } else {
          successBox("Burned", `Token: ${colors.info(tokenMeta.symbol)}\nSignature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Burn failed"); throw err; }
    });

  return burn;
}

export function createCloseAccountsSubcommand(): Command {
  return new Command("close-accounts")
    .description("Close empty SPL token accounts and reclaim rent (~0.002 SOL each)")
    .option("--yes", "Skip confirmation")
    .exitOverride()
    .action(async (options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Close all empty token accounts and reclaim rent SOL.\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Scanning empty token accounts...");
      spin.start();

      try {
        const result = await closeEmptyAccounts(wallet.secretKey);

        if (result.closed === 0) {
          spin.succeed("No empty accounts found");
          if (isHeadless()) {
            writeJsonSuccess({ closed: 0, failed: 0, rentReclaimedSol: 0 });
          }
          return;
        }

        spin.succeed(`Closed ${result.closed} account(s)${result.failed > 0 ? `, ${result.failed} failed` : ""}`);

        if (isHeadless()) {
          writeJsonSuccess(result);
        } else {
          successBox(
            "Accounts Closed",
            `Closed: ${colors.info(String(result.closed))} account(s)\n` +
            (result.failed > 0 ? `Failed: ${result.failed}\n` : "") +
            `Rent reclaimed: ${colors.info(`~${result.rentReclaimedSol.toFixed(4)} SOL`)}`,
          );
        }
      } catch (err) { spin.fail("Close failed"); throw err; }
    });
}
