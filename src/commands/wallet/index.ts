import { Command } from "commander";
import type { Address } from "viem";
import { loadConfig } from "../../config/store.js";
import { createWallet } from "../../wallet/create.js";
import { createSolanaWallet } from "../../wallet/solana-create.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { successBox, spinner, colors } from "../../utils/ui.js";
import { writeStdout, isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { assertWalletMutationAllowed } from "../../guardrails/wallet-mutation.js";
import { formatWalletChain, normalizeWalletChain } from "../../wallet/family.js";

// Re-exports consumed by cli.ts, wallet/import.ts, wallet/create.ts
export { importPrivateKeyAction } from "./import-action.js";
export { autoBackup } from "./backup.js";

import { createBalanceSubcommand } from "./balance.js";
import { createBalancesSubcommand } from "./balances.js";
import { createEnsureSubcommand } from "./ensure.js";
import { createExportKeySubcommand } from "./export-key.js";
import { createBackupSubcommand, createRestoreSubcommand } from "./backup.js";
import { importPrivateKeyAction } from "./import-action.js";

export function requireWallet(): Address {
  const cfg = loadConfig();
  if (!cfg.wallet.address) {
    throw new EchoError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No wallet configured.",
      "Run: echoclaw wallet ensure --json  (to check status and get instructions)"
    );
  }
  return cfg.wallet.address;
}

export function createWalletCommand(): Command {
  const wallet = new Command("wallet")
    .description("Wallet operations")
    .exitOverride();

  // echoclaw wallet create
  wallet
    .command("create")
    .description("Generate new wallet and save encrypted keystore")
    .option("--chain <chain>", "Wallet family: eip155 | solana", "eip155")
    .option("--force", "Overwrite existing keystore")
    .action(async (options: { chain?: string; force?: boolean }) => {
      assertWalletMutationAllowed("wallet create");
      const chain = normalizeWalletChain(options.chain);

      const spin = spinner("Encrypting and saving keystore...");
      spin.start();

      if (chain === "solana") {
        const result = await createSolanaWallet({ force: options.force });

        spin.succeed("Wallet created");

        if (isHeadless()) {
          writeJsonSuccess({ address: result.address, chain });
        } else {
          successBox(
            "Wallet Created",
            `Address: ${colors.address(result.address)}\n` +
              `Chain: ${colors.info(formatWalletChain(chain))}\n\n` +
              colors.warn("⚠ Private key encrypted and stored locally.")
          );
        }
        return;
      }

      const result = await createWallet({ force: options.force });
      spin.succeed("Wallet created");

      if (isHeadless()) {
        writeJsonSuccess({ address: result.address, chain, chainId: result.chainId });
      } else {
        successBox(
          "Wallet Created",
          `Address: ${colors.address(result.address)}\n` +
            `Chain: ${colors.info(formatWalletChain(chain, result.chainId))}\n\n` +
            colors.warn("⚠ Private key encrypted and stored locally.")
        );
      }
    });

  // echoclaw wallet address
  wallet
    .command("address")
    .description("Display configured wallet address")
    .option("--chain <chain>", "Wallet family: eip155 | solana", "eip155")
    .action(async (options: { chain?: string }) => {
      const chain = normalizeWalletChain(options.chain);
      const cfg = loadConfig();
      const address = chain === "solana" ? cfg.wallet.solanaAddress : requireWallet();
      if (!address) {
        throw new EchoError(
          ErrorCodes.WALLET_NOT_CONFIGURED,
          `No ${chain === "solana" ? "Solana" : "EVM"} wallet configured.`,
          `Run: echoclaw wallet create${chain === "solana" ? " --chain solana" : ""}`,
        );
      }
      if (isHeadless()) {
        writeJsonSuccess({ address, chain });
      } else {
        writeStdout(address);
      }
    });

  // Subcommands from split files
  wallet.addCommand(createBalanceSubcommand());
  wallet.addCommand(createBalancesSubcommand());

  // echoclaw wallet import <privateKey>
  wallet
    .command("import")
    .description("Import private key into encrypted keystore (non-interactive)")
    .argument("[privateKey]", "Private key hex (0x-prefixed or raw)")
    .option("--chain <chain>", "Wallet family: eip155 | solana", "eip155")
    .option("--stdin", "Read private key from stdin")
    .option("--force", "Overwrite existing keystore (auto-backup first)")
    .action(importPrivateKeyAction);

  wallet.addCommand(createEnsureSubcommand());
  wallet.addCommand(createExportKeySubcommand());
  wallet.addCommand(createBackupSubcommand());
  wallet.addCommand(createRestoreSubcommand());

  return wallet;
}
