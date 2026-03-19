import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "../../config/store.js";
import { CONFIG_DIR, BACKUPS_DIR, SOLANA_KEYSTORE_FILE } from "../../config/paths.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { assertWalletMutationAllowed } from "../../guardrails/wallet-mutation.js";
import {
  successBox,
  infoBox,
  colors,
  printTable,
} from "../../utils/ui.js";
import { writeStderr, isHeadless, writeJsonSuccess } from "../../utils/output.js";
import logger from "../../utils/logger.js";

const MAX_BACKUPS = 20;

interface BackupManifest {
  version: 1;
  cliVersion: string;
  createdAt: string;
  walletAddress: string | null;
  solanaWalletAddress: string | null;
  chainId: number;
  files: string[];
}

function getCLIVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Create a backup of keystore.json and/or config.json.
 * Returns backup path, or null if nothing to back up.
 * Throws EchoError(AUTO_BACKUP_FAILED) on write failure.
 */
export async function autoBackup(): Promise<string | null> {
  const keystorePath = join(CONFIG_DIR, "keystore.json");
  const solanaKeystorePath = SOLANA_KEYSTORE_FILE;
  const configPath = join(CONFIG_DIR, "config.json");

  const hasKeystore = existsSync(keystorePath);
  const hasSolanaKeystore = existsSync(solanaKeystorePath);
  const hasConfig = existsSync(configPath);

  if (!hasKeystore && !hasSolanaKeystore && !hasConfig) {
    return null;
  }

  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
    const backupDir = join(BACKUPS_DIR, timestamp);
    mkdirSync(backupDir, { recursive: true });

    const files: string[] = [];

    if (hasKeystore) {
      cpSync(keystorePath, join(backupDir, "keystore.json"));
      files.push("keystore.json");
    }
    if (hasSolanaKeystore) {
      cpSync(solanaKeystorePath, join(backupDir, "solana-keystore.json"));
      files.push("solana-keystore.json");
    }
    if (hasConfig) {
      cpSync(configPath, join(backupDir, "config.json"));
      files.push("config.json");
    }

    const cfg = loadConfig();
    const manifest: BackupManifest = {
      version: 1,
      cliVersion: getCLIVersion(),
      createdAt: new Date().toISOString(),
      walletAddress: cfg.wallet.address ?? null,
      solanaWalletAddress: cfg.wallet.solanaAddress ?? null,
      chainId: cfg.chain.chainId,
      files,
    };
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    // Enforce retention: remove oldest if over MAX_BACKUPS
    enforceBackupRetention();

    logger.debug(`Auto-backup created at ${backupDir}`);
    return backupDir;
  } catch (err) {
    throw new EchoError(
      ErrorCodes.AUTO_BACKUP_FAILED,
      `Failed to create auto-backup: ${err instanceof Error ? err.message : String(err)}`,
      "Check permissions on the config directory."
    );
  }
}

export function enforceBackupRetention(): void {
  if (!existsSync(BACKUPS_DIR)) return;
  try {
    const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    while (entries.length > MAX_BACKUPS) {
      const oldest = entries.shift()!;
      rmSync(join(BACKUPS_DIR, oldest), { recursive: true, force: true });
      logger.debug(`Removed old backup: ${oldest}`);
    }
  } catch {
    // best-effort
  }
}

export function listBackups(): Array<{ dir: string; manifest: BackupManifest }> {
  if (!existsSync(BACKUPS_DIR)) return [];
  try {
    return readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const manifestPath = join(BACKUPS_DIR, d.name, "manifest.json");
        if (!existsSync(manifestPath)) return null;
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as BackupManifest;
          return { dir: join(BACKUPS_DIR, d.name), manifest };
        } catch {
          return null;
        }
      })
      .filter((b): b is { dir: string; manifest: BackupManifest } => b !== null)
      .sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt));
  } catch {
    return [];
  }
}

export function createBackupSubcommand(): Command {
  const backupCmd = new Command("backup").description("Backup wallet keystore and config");

  backupCmd
    .action(async () => {
      const backupPath = await autoBackup();
      if (!backupPath) {
        if (isHeadless()) {
          writeJsonSuccess({ status: "nothing_to_backup", hint: "No keystore or config files found." });
        } else {
          infoBox("Nothing to Backup", "No keystore.json, solana-keystore.json, or config.json found.");
        }
        return;
      }

      if (isHeadless()) {
        writeJsonSuccess({ status: "created", path: backupPath });
      } else {
        successBox("Backup Created", `Path: ${colors.info(backupPath)}`);
      }
    });

  // echoclaw wallet backup list
  backupCmd
    .command("list")
    .description("List all backups")
    .action(async () => {
      const backups = listBackups();

      if (isHeadless()) {
        writeJsonSuccess({
          backups: backups.map((b) => ({
            path: b.dir,
            createdAt: b.manifest.createdAt,
            walletAddress: b.manifest.walletAddress,
            solanaWalletAddress: b.manifest.solanaWalletAddress ?? null,
            files: b.manifest.files,
          })),
          count: backups.length,
        });
        return;
      }

      if (backups.length === 0) {
        infoBox("No Backups", "No backups found. Run: echoclaw wallet backup");
        return;
      }

      writeStderr("");
      infoBox("Wallet Backups", `${backups.length} backup(s) found`);
      const rows = backups.map((b, i) => [
        colors.muted((i + 1).toString()),
        colors.info(b.manifest.createdAt),
        colors.address(b.manifest.walletAddress ?? "n/a"),
        colors.muted(b.manifest.files.join(", ")),
      ]);
      printTable(
        [
          { header: "#", width: 4 },
          { header: "Created", width: 28 },
          { header: "Address", width: 46 },
          { header: "Files", width: 26 },
        ],
        rows
      );
    });

  return backupCmd;
}

export function createRestoreSubcommand(): Command {
  return new Command("restore <backupDir>")
    .description("Restore wallet from a backup directory")
    .option("--force", "Required: confirm restore (overwrites current files)")
    .action(async (backupDir: string, opts: { force?: boolean }) => {
      assertWalletMutationAllowed("wallet restore");

      // Must have --force
      if (!opts.force) {
        throw new EchoError(
          ErrorCodes.CONFIRMATION_REQUIRED,
          "Restore requires --force flag.",
          "This will overwrite current keystore and config. Use --force to confirm."
        );
      }

      // Validate backup dir
      const manifestPath = join(backupDir, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new EchoError(
          ErrorCodes.BACKUP_NOT_FOUND,
          `No manifest.json found in ${backupDir}.`,
          "Provide a valid backup directory (e.g. from echoclaw wallet backup list)."
        );
      }

      let manifest: BackupManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        throw new EchoError(ErrorCodes.BACKUP_NOT_FOUND, "Failed to parse backup manifest.", "Backup may be corrupted.");
      }

      // Validate manifest.files
      if (!Array.isArray(manifest.files) || !manifest.files.every((f: unknown) => typeof f === "string")) {
        throw new EchoError(ErrorCodes.BACKUP_NOT_FOUND, "Invalid manifest: files must be an array of strings.", "Backup may be corrupted.");
      }

      const ALLOWED_RESTORE_FILES = new Set(["keystore.json", "config.json"]);
      ALLOWED_RESTORE_FILES.add("solana-keystore.json");

      // Auto-backup current state before restore
      await autoBackup();

      // Ensure config directory exists
      mkdirSync(CONFIG_DIR, { recursive: true });

      // Copy files from backup to CONFIG_DIR
      for (const file of manifest.files) {
        // Reject path traversal and non-allowlisted files
        if (file.includes("/") || file.includes("\\") || file.includes("..")) {
          throw new EchoError(ErrorCodes.BACKUP_NOT_FOUND, `Invalid file path in manifest: ${file}`, "Backup may be malicious.");
        }
        if (!ALLOWED_RESTORE_FILES.has(file)) {
          throw new EchoError(ErrorCodes.BACKUP_NOT_FOUND, `Unexpected file in backup manifest: ${file}`, "Only keystore.json and config.json can be restored.");
        }

        const src = join(backupDir, file);
        const dst = join(CONFIG_DIR, file);
        if (!existsSync(src)) {
          throw new EchoError(ErrorCodes.BACKUP_NOT_FOUND, `Missing file in backup: ${file}`, "Backup may be corrupted or incomplete.");
        }
        cpSync(src, dst);
      }

      const cfg = loadConfig();
      const result = {
        status: "restored",
        address: cfg.wallet.address ?? null,
        chainId: cfg.chain.chainId,
        restoredFiles: manifest.files,
        backupDir,
      };

      if (isHeadless()) {
        writeJsonSuccess(result);
      } else {
        successBox(
          "Wallet Restored",
          `Address: ${colors.address(cfg.wallet.address ?? "unknown")}\n` +
            `Files: ${manifest.files.join(", ")}\n` +
            `From: ${colors.info(backupDir)}\n\n` +
            colors.muted("Current state was auto-backed up before restore.")
        );
      }
    });
}
