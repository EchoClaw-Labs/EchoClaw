/**
 * Solana portfolio command — uses Ultra holdings API (works on lite-api).
 * For cross-chain portfolio, use: echoclaw wallet balances --wallet solana
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../wallet/multi-auth.js";
import { jupiterHoldings } from "../../chains/solana/jupiter-client.js";
import { resolveTokens } from "../../chains/solana/token-registry.js";
import { lamportsToSol } from "../../chains/solana/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, printTable, infoBox, colors } from "../../utils/ui.js";

export function createPortfolioSubcommand(): Command {
  return new Command("portfolio")
    .description("Solana token holdings (Ultra API)")
    .exitOverride()
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading holdings...");
      spin.start();

      try {
        const holdings = await jupiterHoldings(wallet.address);
        const solBalance = lamportsToSol(BigInt(holdings.amount));

        const tokenMints = Object.keys(holdings.tokens);
        const resolved = tokenMints.length > 0 ? await resolveTokens(tokenMints) : new Map();

        const tokenRows = tokenMints.flatMap((mint) => {
          const accounts = holdings.tokens[mint];
          const meta = resolved.get(mint);
          return accounts.map((a) => ({
            symbol: meta?.symbol ?? mint.slice(0, 8),
            mint,
            balance: a.uiAmount,
            frozen: a.isFrozen,
          }));
        });

        spin.succeed(`${tokenRows.length + 1} asset(s)`);

        if (isHeadless()) {
          writeJsonSuccess({
            address: wallet.address,
            solBalance,
            tokens: tokenRows,
          });
          return;
        }

        if (tokenRows.length === 0 && solBalance === 0) {
          infoBox("Portfolio", "No holdings found.\nFor cross-chain view: echoclaw wallet balances --wallet solana");
          return;
        }

        const rows = [
          ["SOL", "native", solBalance.toFixed(6), "-"],
          ...tokenRows.map((t) => [
            t.symbol,
            `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
            t.balance.toFixed(6),
            t.frozen ? "FROZEN" : "-",
          ]),
        ];

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Mint", width: 14 },
            { header: "Balance", width: 18 },
            { header: "Status", width: 8 },
          ],
          rows,
        );

        process.stderr.write(`\n  ${colors.muted("Cross-chain view: echoclaw wallet balances --wallet solana")}\n`);
      } catch (err) {
        spin.fail("Portfolio failed");
        throw err;
      }
    });
}
