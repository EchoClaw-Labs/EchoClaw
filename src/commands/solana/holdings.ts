/**
 * Ultra holdings + shield commands — token balances and security warnings.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { jupiterHoldings, jupiterShield } from "../../chains/solana/jupiter-client.js";
import { resolveTokens } from "../../chains/solana/token-registry.js";
import { lamportsToSol, shortenSolanaAddress } from "../../chains/solana/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, infoBox, colors } from "../../utils/ui.js";

export function createHoldingsSubcommand(): Command {
  return new Command("holdings")
    .description("Detailed token holdings with account info (Ultra API)")
    .exitOverride()
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading holdings...");
      spin.start();

      try {
        const h = await jupiterHoldings(wallet.address);
        const mints = Object.keys(h.tokens);
        const resolved = mints.length > 0 ? await resolveTokens(mints) : new Map();

        spin.succeed(`SOL + ${mints.length} token(s)`);

        if (isHeadless()) {
          writeJsonSuccess({
            address: wallet.address,
            solBalance: lamportsToSol(BigInt(h.amount)),
            tokens: mints.flatMap((mint) =>
              h.tokens[mint].map((a) => ({
                mint,
                symbol: resolved.get(mint)?.symbol ?? null,
                account: a.account,
                balance: a.uiAmount,
                frozen: a.isFrozen,
                isAta: a.isAssociatedTokenAccount,
              })),
            ),
          });
          return;
        }

        const rows = [
          ["SOL", "native", "-", lamportsToSol(BigInt(h.amount)).toFixed(6), "-"],
          ...mints.flatMap((mint) =>
            h.tokens[mint].map((a) => [
              resolved.get(mint)?.symbol ?? shortenSolanaAddress(mint),
              shortenSolanaAddress(mint),
              shortenSolanaAddress(a.account),
              a.uiAmount.toFixed(6),
              a.isFrozen ? colors.warn("FROZEN") : a.isAssociatedTokenAccount ? "ATA" : "other",
            ]),
          ),
        ];

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Mint", width: 12 },
            { header: "Account", width: 12 },
            { header: "Balance", width: 16 },
            { header: "Type", width: 8 },
          ],
          rows,
        );
      } catch (err) { spin.fail("Failed"); throw err; }
    });
}

export function createShieldSubcommand(): Command {
  return new Command("shield")
    .description("Token security warnings (Ultra Shield API)")
    .argument("<mints...>", "Token mint addresses to check")
    .exitOverride()
    .action(async (mints: string[]) => {
      const spin = spinner(`Checking ${mints.length} token(s)...`);
      spin.start();

      try {
        const warnings = await jupiterShield(mints);
        const totalWarnings = Object.values(warnings).reduce((sum, w) => sum + w.length, 0);
        spin.succeed(`${totalWarnings} warning(s) across ${mints.length} token(s)`);

        if (isHeadless()) {
          writeJsonSuccess({ warnings });
          return;
        }

        for (const [mint, warns] of Object.entries(warnings)) {
          if (warns.length === 0) {
            process.stderr.write(`  ${colors.muted(shortenSolanaAddress(mint))}: No warnings\n`);
            continue;
          }
          process.stderr.write(`\n  ${colors.address(shortenSolanaAddress(mint))}:\n`);
          for (const w of warns) {
            const icon = w.severity === "critical" ? colors.warn("!") : w.severity === "warning" ? colors.warn("?") : colors.muted("i");
            process.stderr.write(`    ${icon} [${w.severity}] ${w.type}: ${w.message}\n`);
          }
        }
      } catch (err) { spin.fail("Shield check failed"); throw err; }
    });
}
