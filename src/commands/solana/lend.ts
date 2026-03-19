/**
 * Jupiter Lend Earn commands — deposit, withdraw, view rates and positions.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { getLendRates, getLendPositions, lendDeposit, lendWithdraw } from "../../chains/solana/lend-service.js";
import { resolveToken } from "../../chains/solana/token-registry.js";
import { uiToTokenAmount } from "../../chains/solana/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createLendSubcommand(): Command {
  const lend = new Command("lend")
    .description("Jupiter Lend — earn yield by depositing tokens")
    .exitOverride();

  // echoclaw solana lend rates [token]
  lend
    .command("rates")
    .description("Compare lending rates across Jupiter pools")
    .argument("[token]", "Filter by token symbol")
    .action(async (token?: string) => {
      const spin = spinner("Fetching lending rates...");
      spin.start();

      try {
        let rates = await getLendRates();
        if (token) {
          const lower = token.toLowerCase();
          rates = rates.filter((r) => r.symbol.toLowerCase().includes(lower));
        }
        spin.succeed(`${rates.length} lending pool(s)`);

        if (isHeadless()) {
          writeJsonSuccess({ rates });
          return;
        }

        if (rates.length === 0) {
          infoBox("Lend Rates", "No pools found.");
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Supply APY", width: 12 },
            { header: "Total APY", width: 12 },
            { header: "Total Supply", width: 18 },
          ],
          rates.map((r) => [
            r.symbol,
            `${(r.supplyRate * 100).toFixed(2)}%`,
            `${(r.totalRate * 100).toFixed(2)}%`,
            r.totalAssets,
          ]),
        );
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // echoclaw solana lend positions
  lend
    .command("positions")
    .description("Your lending positions")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading positions...");
      spin.start();

      try {
        const positions = await getLendPositions(wallet.address);
        spin.succeed(`${positions.length} position(s)`);

        if (isHeadless()) {
          writeJsonSuccess({ positions });
          return;
        }

        if (positions.length === 0) {
          infoBox("Lend Positions", "No lending positions. Deposit: echoclaw solana lend deposit <token> --amount <n> --yes");
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Shares", width: 16 },
            { header: "Assets", width: 16 },
            { header: "Balance", width: 16 },
          ],
          positions.map((p) => [
            p.tokenSymbol,
            p.shares,
            p.underlyingAssets,
            p.underlyingBalance,
          ]),
        );
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // echoclaw solana lend deposit <token> --amount <n> --yes
  lend
    .command("deposit <token>")
    .description("Deposit tokens to earn yield")
    .requiredOption("--amount <n>", "Amount to deposit")
    .option("--yes", "Skip confirmation")
    .action(async (token: string, options: { amount: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const tokenMeta = await resolveToken(token);
      if (!tokenMeta) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${token}`);

      const atomicAmount = uiToTokenAmount(Number(options.amount), tokenMeta.decimals);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Deposit ${colors.info(`${options.amount} ${tokenMeta.symbol}`)} to Jupiter Lend\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Depositing ${options.amount} ${tokenMeta.symbol}...`);
      spin.start();

      try {
        const result = await lendDeposit(wallet.secretKey, tokenMeta.address, atomicAmount.toString());
        spin.succeed("Deposited");

        if (isHeadless()) {
          writeJsonSuccess({ action: "deposit", token: tokenMeta.symbol, amount: options.amount, ...result });
        } else {
          successBox("Deposit Complete", `${colors.info(`${options.amount} ${tokenMeta.symbol}`)} deposited\nSignature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Deposit failed"); throw err; }
    });

  // echoclaw solana lend withdraw <token> --amount <n> --yes
  lend
    .command("withdraw <token>")
    .description("Withdraw from lending pool")
    .requiredOption("--amount <n>", "Amount to withdraw")
    .option("--yes", "Skip confirmation")
    .action(async (token: string, options: { amount: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const tokenMeta = await resolveToken(token);
      if (!tokenMeta) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${token}`);

      const atomicAmount = uiToTokenAmount(Number(options.amount), tokenMeta.decimals);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Withdraw ${colors.info(`${options.amount} ${tokenMeta.symbol}`)} from Jupiter Lend\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Withdrawing ${options.amount} ${tokenMeta.symbol}...`);
      spin.start();

      try {
        const result = await lendWithdraw(wallet.secretKey, tokenMeta.address, atomicAmount.toString());
        spin.succeed("Withdrawn");

        if (isHeadless()) {
          writeJsonSuccess({ action: "withdraw", token: tokenMeta.symbol, amount: options.amount, ...result });
        } else {
          successBox("Withdrawal Complete", `${colors.info(`${options.amount} ${tokenMeta.symbol}`)} withdrawn\nSignature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Withdrawal failed"); throw err; }
    });

  return lend;
}
