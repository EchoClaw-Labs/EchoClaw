/**
 * Solana staking commands — delegate, list, withdraw, claim MEV.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import {
  getStakeAccounts,
  createAndDelegateStake,
  withdrawStake,
  claimMev,
} from "../../chains/solana/stake-service.js";
import { validateSolanaAddress, shortenSolanaAddress } from "../../chains/solana/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createStakeSubcommand(): Command {
  const stake = new Command("stake")
    .description("SOL staking — delegate, withdraw, claim MEV tips")
    .exitOverride();

  // echoclaw solana stake list
  stake
    .command("list")
    .description("List stake accounts with balances and MEV tips")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading stake accounts...");
      spin.start();

      const accounts = await getStakeAccounts(wallet.address);
      spin.succeed(`Found ${accounts.length} stake account(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ wallet: wallet.address, stakeAccounts: accounts });
        return;
      }

      if (accounts.length === 0) {
        infoBox("Staking", "No stake accounts found.\nStake SOL: echoclaw solana stake delegate --amount 10 --yes");
        return;
      }

      const totalMev = accounts.reduce((sum, a) => sum + a.claimableMevSol, 0);

      printTable(
        [
          { header: "Account", width: 14 },
          { header: "Balance", width: 14 },
          { header: "Status", width: 14 },
          { header: "Validator", width: 14 },
          { header: "MEV", width: 14 },
        ],
        accounts.map((a) => [
          shortenSolanaAddress(a.address),
          `${a.balanceSol.toFixed(4)} SOL`,
          a.status,
          a.validator ? shortenSolanaAddress(a.validator) : "-",
          a.claimableMevSol > 0.000001 ? `${a.claimableMevSol.toFixed(6)} SOL` : "-",
        ]),
      );

      if (totalMev > 0.000001) {
        process.stderr.write(
          `\n  ${colors.info(`${totalMev.toFixed(6)} SOL`)} claimable MEV. Run: ${colors.muted("echoclaw solana stake claim-mev --yes")}\n`,
        );
      }
    });

  // echoclaw solana stake delegate --amount <SOL>
  stake
    .command("delegate")
    .description("Stake SOL with a validator")
    .requiredOption("--amount <sol>", "Amount of SOL to stake")
    .option("--validator <vote>", "Validator vote address (default: Solana Compass)")
    .option("--yes", "Skip confirmation")
    .action(async (options: { amount: string; validator?: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const amountSol = Number(options.amount);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(
          `\n  Stake ${colors.info(`${amountSol} SOL`)} with ${options.validator ? shortenSolanaAddress(options.validator) : "Solana Compass (default)"}\n` +
          `  Use ${colors.muted("--yes")} to execute.\n\n`,
        );
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Staking ${amountSol} SOL...`);
      spin.start();

      try {
        const result = await createAndDelegateStake(wallet.secretKey, amountSol, options.validator);
        spin.succeed("SOL staked");

        if (isHeadless()) {
          writeJsonSuccess(result);
        } else {
          successBox("Staked",
            `Amount: ${colors.info(`${amountSol} SOL`)}\n` +
            `Stake Account: ${colors.address(result.stakeAccount)}\n` +
            `Signature: ${colors.muted(result.signature)}\n` +
            `Explorer: ${colors.muted(result.explorerUrl)}`,
          );
        }
      } catch (err) { spin.fail("Staking failed"); throw err; }
    });

  // echoclaw solana stake withdraw <account>
  stake
    .command("withdraw <account>")
    .description("Withdraw SOL from a stake account")
    .option("--amount <sol>", "Amount to withdraw (default: all)")
    .option("--yes", "Skip confirmation")
    .action(async (account: string, options: { amount?: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      validateSolanaAddress(account);

      if (!options.yes && !isHeadless()) {
        const label = options.amount ? `${options.amount} SOL` : "all";
        process.stderr.write(`\n  Withdraw ${colors.info(label)} from ${colors.address(shortenSolanaAddress(account))}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Withdrawing stake...");
      spin.start();

      try {
        const result = await withdrawStake(wallet.secretKey, account, options.amount ? Number(options.amount) : undefined);
        spin.succeed("Stake withdrawn");

        if (isHeadless()) {
          writeJsonSuccess(result);
        } else {
          successBox("Withdrawn", `Signature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Withdrawal failed"); throw err; }
    });

  // echoclaw solana stake claim-mev
  stake
    .command("claim-mev")
    .description("Claim MEV tips from stake accounts")
    .argument("[account]", "Specific stake account (default: all)")
    .option("--yes", "Skip confirmation")
    .action(async (account: string | undefined, options: { yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Claim MEV tips${account ? ` from ${shortenSolanaAddress(account)}` : " from all accounts"}\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Claiming MEV tips...");
      spin.start();

      try {
        const results = await claimMev(wallet.secretKey, account);
        const totalClaimed = results.reduce((s, r) => s + r.claimedSol, 0);
        spin.succeed(`Claimed ${totalClaimed.toFixed(6)} SOL from ${results.length} account(s)`);

        if (isHeadless()) {
          writeJsonSuccess({ claimed: results, totalSol: totalClaimed });
        } else {
          successBox("MEV Claimed", `Total: ${colors.info(`${totalClaimed.toFixed(6)} SOL`)}\nAccounts: ${results.length}`);
        }
      } catch (err) { spin.fail("MEV claim failed"); throw err; }
    });

  return stake;
}
