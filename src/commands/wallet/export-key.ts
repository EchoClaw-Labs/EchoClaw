import { writeFileSync } from "node:fs";
import { platform } from "node:os";
import { Command } from "commander";
import { decryptPrivateKey, loadKeystore } from "../../wallet/keystore.js";
import { encodeSolanaSecretKey, loadSolanaKeystore, decryptSolanaSecretKey } from "../../wallet/solana-keystore.js";
import { normalizeWalletChain } from "../../wallet/family.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { requireKeystorePassword } from "../../utils/env.js";
import {
  successBox,
  warnBox,
} from "../../utils/ui.js";
import { writeStdout, isHeadless, isStdoutTTY } from "../../utils/output.js";

export function createExportKeySubcommand(): Command {
  return new Command("export-key")
    .description("Export decrypted private key (manual-only, blocked in headless)")
    .option("--chain <chain>", "Wallet family: eip155 | solana", "eip155")
    .option("--to-file <path>", "Write private key to file (chmod 600)")
    .option("--stdout", "Print to stdout")
    .option("--i-understand", "Acknowledge risk of printing to stdout")
    .action(async (opts: { chain?: string; toFile?: string; stdout?: boolean; iUnderstand?: boolean }) => {
      // Guardrail: block in headless mode
      if (isHeadless()) {
        throw new EchoError(
          ErrorCodes.EXPORT_BLOCKED_HEADLESS,
          "export-key is disabled in headless/agent mode.",
          "This command is for manual use only. Run it in a terminal."
        );
      }

      // Must specify mode
      if (!opts.toFile && !opts.stdout) {
        throw new EchoError(
          ErrorCodes.EXPORT_REQUIRES_ACKNOWLEDGE,
          "Specify --to-file <path> or --stdout --i-understand.",
          "Example: echoclaw wallet export-key --to-file ./my-key.txt"
        );
      }

      // --stdout requires --i-understand and TTY
      if (opts.stdout) {
        if (!opts.iUnderstand) {
          throw new EchoError(
            ErrorCodes.EXPORT_REQUIRES_ACKNOWLEDGE,
            "--stdout requires --i-understand flag.",
            "Add --i-understand to confirm you want the key printed to terminal."
          );
        }
        if (!isStdoutTTY()) {
          throw new EchoError(
            ErrorCodes.EXPORT_BLOCKED_HEADLESS,
            "--stdout is only available in TTY mode.",
            "Use --to-file instead."
          );
        }
      }

      // Decrypt
      const chain = normalizeWalletChain(opts.chain);
      const password = requireKeystorePassword();
      const keystore = chain === "solana" ? loadSolanaKeystore() : loadKeystore();
      if (!keystore) {
        throw new EchoError(
          chain === "solana" ? ErrorCodes.KHALANI_SOLANA_KEYSTORE_NOT_FOUND : ErrorCodes.KEYSTORE_NOT_FOUND,
          `${chain === "solana" ? "Solana keystore" : "Keystore"} not found.`,
          `Run: echoclaw wallet create${chain === "solana" ? " --chain solana" : " --json"}`,
        );
      }
      const exportedKey = chain === "solana"
        ? encodeSolanaSecretKey(decryptSolanaSecretKey(keystore, password))
        : decryptPrivateKey(keystore, password);

      if (opts.toFile) {
        const fd = opts.toFile;
        writeFileSync(fd, exportedKey, { encoding: "utf-8", mode: platform() !== "win32" ? 0o600 : undefined });
        successBox("Key Exported", `Written to: ${fd}\n${platform() !== "win32" ? "File permissions set to 600." : "Ensure this file is not accessible to other users."}`);
      } else if (opts.stdout) {
        writeStdout(exportedKey);
        warnBox("Key Printed", "Private key was printed to stdout. Clear your terminal history.");
      }
    });
}
