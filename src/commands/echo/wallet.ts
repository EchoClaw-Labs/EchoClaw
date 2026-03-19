import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { Command } from "commander";
import inquirer from "inquirer";
import { CONFIG_DIR } from "../../config/paths.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { assertWalletMutationAllowed } from "../../guardrails/wallet-mutation.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { createWallet } from "../../wallet/create.js";
import { importWallet } from "../../wallet/import.js";
import { createSolanaWallet } from "../../wallet/solana-create.js";
import { importSolanaWallet } from "../../wallet/solana-import.js";
import { decryptPrivateKey, loadKeystore } from "../../wallet/keystore.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { infoBox, printTable, successBox, warnBox, colors } from "../../utils/ui.js";
import { isHeadless } from "../../utils/output.js";
import { autoBackup, listBackups } from "../wallet/backup.js";
import { buildEchoSnapshot } from "./state.js";
import { writeEchoWorkflow } from "./protocol.js";

async function setPasswordInteractive(): Promise<void> {
  const answers = await inquirer.prompt([
    { type: "password", name: "pw", message: "New keystore password:", mask: "*" },
    { type: "password", name: "confirm", message: "Confirm password:", mask: "*" },
  ]);
  if (answers.pw !== answers.confirm) {
    throw new EchoError(ErrorCodes.PASSWORD_MISMATCH, "Passwords do not match.");
  }
  if (!answers.pw || answers.pw.length < 8) {
    throw new EchoError(ErrorCodes.PASSWORD_TOO_SHORT, "Password must be at least 8 characters.");
  }
  writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", answers.pw);
  process.env.ECHO_KEYSTORE_PASSWORD = answers.pw;
  successBox("Password Saved", "Stored ECHO_KEYSTORE_PASSWORD in ~/.config/echoclaw/.env");
}

async function restoreBackupInteractive(): Promise<void> {
  assertWalletMutationAllowed("wallet restore");
  const backups = listBackups();
  if (backups.length === 0) {
    warnBox("Wallet Restore", "No backups found.");
    return;
  }

  const { backupDir } = await inquirer.prompt([{
    type: "list",
    name: "backupDir",
    message: "Select a backup to restore:",
    choices: backups.map((backup) => ({
      name: `${backup.manifest.createdAt} — ${backup.manifest.walletAddress ?? "unknown wallet"}`,
      value: backup.dir,
    })),
  }]);

  const manifestPath = join(backupDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { files: string[] };

  await autoBackup();
  mkdirSync(CONFIG_DIR, { recursive: true });
  for (const file of manifest.files) {
    cpSync(join(backupDir, file), join(CONFIG_DIR, file));
  }
  successBox("Wallet Restored", `Restored files from ${backupDir}`);
}

async function exportKeyToFileInteractive(): Promise<void> {
  const keystore = loadKeystore();
  if (!keystore) {
    throw new EchoError(ErrorCodes.KEYSTORE_NOT_FOUND, "No keystore found.");
  }
  const password = requireKeystorePassword();
  const pk = decryptPrivateKey(keystore, password);

  const { outputPath } = await inquirer.prompt([{
    type: "input",
    name: "outputPath",
    message: "Where should the private key be written?",
    default: join(process.cwd(), "echoclaw-private-key.txt"),
  }]);

  writeFileSync(outputPath, pk, {
    encoding: "utf-8",
    mode: platform() !== "win32" ? 0o600 : undefined,
  });
  warnBox("Private Key Exported", `Written to ${outputPath}. Keep this file secure.`);
}

export async function runInteractiveWallet(): Promise<void> {
  while (true) {
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "Wallet & Keys",
      choices: [
        { name: "Show wallet status", value: "status" },
        { name: "Set keystore password", value: "password" },
        { name: "Create wallet (EVM)", value: "create" },
        { name: "Import private key (EVM)", value: "import" },
        { name: "Create Solana wallet", value: "create-solana" },
        { name: "Import Solana key", value: "import-solana" },
        { name: "Create backup", value: "backup" },
        { name: "List backups", value: "list" },
        { name: "Restore from backup", value: "restore" },
        { name: "Export private key to file", value: "export" },
        { name: "Back", value: "back" },
      ],
    }]);

    if (action === "back") return;
    if (action === "password") {
      await setPasswordInteractive();
      continue;
    }
    if (action === "create") {
      assertWalletMutationAllowed("wallet create");
      const result = await createWallet();
      successBox("Wallet Created", `Address: ${result.address}`);
      continue;
    }
    if (action === "import") {
      assertWalletMutationAllowed("wallet import");
      const { rawKey } = await inquirer.prompt([{ type: "password", name: "rawKey", message: "Paste the private key (0x-prefixed or raw hex):", mask: "*" }]);
      const result = await importWallet(rawKey, {});
      successBox("Wallet Imported", `Address: ${result.address}`);
      continue;
    }
    if (action === "create-solana") {
      assertWalletMutationAllowed("wallet create solana");
      const result = await createSolanaWallet();
      successBox("Solana Wallet Created", `Address: ${result.address}`);
      continue;
    }
    if (action === "import-solana") {
      assertWalletMutationAllowed("wallet import solana");
      const { rawKey } = await inquirer.prompt([{ type: "password", name: "rawKey", message: "Paste the Solana secret key (base58 or JSON byte array):", mask: "*" }]);
      const result = await importSolanaWallet(rawKey, {});
      successBox("Solana Wallet Imported", `Address: ${result.address}`);
      continue;
    }
    if (action === "backup") {
      const backupDir = await autoBackup();
      backupDir ? successBox("Wallet Backup", `Created ${backupDir}`) : warnBox("Wallet Backup", "Nothing to back up.");
      continue;
    }
    if (action === "list") {
      const backups = listBackups();
      if (backups.length === 0) {
        warnBox("Wallet Backups", "No backups found.");
      } else {
        const rows = backups.map((backup, idx) => [String(idx + 1), backup.manifest.createdAt, backup.manifest.walletAddress ?? "n/a", backup.dir]);
        printTable([
          { header: "#", width: 4 },
          { header: "Created", width: 28 },
          { header: "Wallet", width: 46 },
          { header: "Path", width: 60 },
        ], rows);
      }
      continue;
    }
    if (action === "restore") {
      await restoreBackupInteractive();
      continue;
    }
    if (action === "export") {
      await exportKeyToFileInteractive();
      continue;
    }

    const snapshot = await buildEchoSnapshot({ includeReadiness: false });
    infoBox("Wallet Status", [
      `EVM address:    ${snapshot.wallet.evmAddress ?? colors.muted("not configured")}`,
      `EVM keystore:   ${snapshot.wallet.evmKeystorePresent ? colors.success("present") : colors.warn("missing")}`,
      `Solana address: ${snapshot.wallet.solanaAddress ?? colors.muted("not configured")}`,
      `Solana keystore:${snapshot.wallet.solanaKeystorePresent ? colors.success("present") : colors.warn("missing")}`,
      `Password: ${snapshot.wallet.password.status} (${snapshot.wallet.password.source})`,
    ].join("\n"));
  }
}

export function createWalletHubSubcommand(): Command {
  const wallet = new Command("wallet")
    .description("Wallet status through the Echo launcher");

  wallet
    .command("status")
    .description("Show wallet state")
    .option("--json", "JSON output")
    .action(async (options: { json?: boolean }) => {
      const snapshot = await buildEchoSnapshot({ includeReadiness: false });
      if (options.json || isHeadless()) {
        writeEchoWorkflow({
          phase: "wallet",
          status: "ready",
          summary: "Current wallet status.",
          wallet: snapshot.wallet,
        });
      } else {
        infoBox("Wallet Status", JSON.stringify(snapshot.wallet, null, 2));
      }
    });

  return wallet;
}
