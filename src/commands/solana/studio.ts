/**
 * Jupiter Studio commands — create tokens with Dynamic Bonding Curves.
 */

import { Command } from "commander";
import { existsSync } from "node:fs";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { studioCreateToken, studioGetFees, studioClaimFees } from "../../chains/solana/studio-service.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createStudioSubcommand(): Command {
  const studio = new Command("studio")
    .description("Jupiter Studio — create tokens with Dynamic Bonding Curves")
    .exitOverride();

  studio
    .command("create")
    .description("Create a new token on Jupiter Studio")
    .requiredOption("--name <name>", "Token name")
    .requiredOption("--symbol <symbol>", "Token symbol")
    .requiredOption("--image <path>", "Path to token image (PNG)")
    .requiredOption("--initial-mcap <usd>", "Initial market cap in USD")
    .requiredOption("--migration-mcap <usd>", "Migration market cap in USD")
    .option("--description <desc>", "Token description")
    .option("--fee-bps <bps>", "Trading fee in bps", "100")
    .option("--lock-lp", "Lock LP permanently", true)
    .option("--twitter <url>", "Twitter URL")
    .option("--telegram <url>", "Telegram URL")
    .option("--website <url>", "Website URL")
    .option("--yes", "Skip confirmation")
    .action(async (options) => {
      const wallet = requireSolanaWallet();

      if (!existsSync(options.image)) {
        throw new EchoError(ErrorCodes.SOLANA_STUDIO_CREATE_FAILED, `Image not found: ${options.image}`);
      }

      if (!options.yes && !isHeadless()) {
        process.stderr.write(
          `\n  Create token: ${colors.info(options.name)} (${options.symbol})\n` +
          `  Initial MC: $${options.initialMcap} | Migration MC: $${options.migrationMcap}\n` +
          `  Fee: ${options.feeBps} bps | LP locked: ${options.lockLp}\n` +
          `  Use ${colors.muted("--yes")} to execute.\n\n`,
        );
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Creating ${options.symbol} on Jupiter Studio...`);
      spin.start();

      try {
        const result = await studioCreateToken(wallet.secretKey, {
          tokenName: options.name,
          tokenSymbol: options.symbol,
          imagePath: options.image,
          description: options.description,
          initialMarketCap: Number(options.initialMcap),
          migrationMarketCap: Number(options.migrationMcap),
          feeBps: Number(options.feeBps),
          isLpLocked: options.lockLp,
          twitter: options.twitter,
          telegram: options.telegram,
          website: options.website,
        });
        spin.succeed("Token created");

        if (isHeadless()) {
          writeJsonSuccess({ action: "studio-create", ...result, name: options.name, symbol: options.symbol });
        } else {
          successBox("Token Created",
            `Name: ${colors.info(options.name)} (${options.symbol})\n` +
            `Mint: ${colors.address(result.mint)}\n` +
            (result.signature ? `Signature: ${colors.muted(result.signature)}\n` : "") +
            (result.explorerUrl ? `Explorer: ${colors.muted(result.explorerUrl)}` : ""));
        }
      } catch (err) { spin.fail("Creation failed"); throw err; }
    });

  studio
    .command("fees <mint>")
    .description("Show unclaimed DBC fees for a token")
    .action(async (mint: string) => {
      const spin = spinner("Loading fee info...");
      spin.start();

      try {
        const fees = await studioGetFees(mint);
        spin.succeed("Fee info loaded");

        if (isHeadless()) {
          writeJsonSuccess({ ...fees });
        } else {
          infoBox("Studio Fees",
            `Pool: ${colors.muted(fees.poolAddress)}\n` +
            `Total Fees: ${fees.totalFees}\n` +
            `Unclaimed: ${colors.info(fees.unclaimedFees)}`);
        }
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  studio
    .command("claim-fees <pool>")
    .description("Claim DBC trading fees")
    .option("--max <amount>", "Maximum amount to claim")
    .option("--yes", "Skip confirmation")
    .action(async (pool: string, options: { max?: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Claim fees from pool ${colors.muted(pool.slice(0, 8))}...\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner("Claiming fees...");
      spin.start();

      try {
        const result = await studioClaimFees(wallet.secretKey, pool, options.max);
        spin.succeed("Fees claimed");

        if (isHeadless()) {
          writeJsonSuccess({ action: "studio-claim", ...result });
        } else {
          successBox("Fees Claimed", `Signature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Claim failed"); throw err; }
    });

  return studio;
}
