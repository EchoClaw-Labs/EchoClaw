import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors } from "../../utils/ui.js";
import { BACKUPS_DIR } from "../../config/paths.js";
import { getStorageClientConfig } from "../../0g-storage/client.js";
import { uploadFile } from "../../0g-storage/files.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";
import { requireWallet } from "./shared.js";
import {
  loadDriveIndex,
  saveDriveIndex,
  drivePut,
  driveMkdir,
} from "../../0g-storage/drive-index.js";
import type { CostInfo } from "../../0g-storage/types.js";

export function createStorageBackupCommand(): Command {
  const backup = new Command("backup")
    .description("Push local files or wallet backups to 0G Storage");

  // ── backup push ───────────────────────────────────────────
  backup
    .command("push")
    .description("Upload a file or wallet backup to 0G Storage")
    .requiredOption("--source <path>", 'Local file path, or "wallet-latest" for last wallet backup')
    .option("--json", "JSON output")
    .action(async (opts: { source: string }) => {
      const wallet = requireWallet();

      if (opts.source === "wallet-latest") {
        await pushWalletLatest(wallet);
        return;
      }

      // Generic file backup
      if (!existsSync(opts.source)) {
        throw new EchoError(ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND, `File not found: ${opts.source}`);
      }

      const isDir = statSync(opts.source).isDirectory();
      if (isDir) {
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_INVALID_PATH,
          "Directory upload not supported in MVP.",
          "Upload individual files instead."
        );
      }

      const s = spinner("Uploading backup...");
      s.start();

      const config = getStorageClientConfig();
      const result = await uploadFile(config, opts.source);

      const index = loadDriveIndex(wallet);
      const backupId = `${Date.now()}`;
      const vpath = `/backups/${backupId}/${opts.source.split("/").pop() ?? "file"}`;
      driveMkdir(index, `/backups/${backupId}`);
      drivePut(index, vpath, {
        type: "file",
        root: result.root,
        txHash: result.txHash,
        txSeq: null,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        uploadedAt: result.uploadedAt,
        cost: result.cost,
      });
      saveDriveIndex(index);

      s.succeed("Backup uploaded");

      respond({
        data: {
          backupId,
          root: result.root,
          source: opts.source,
          sizeBytes: result.sizeBytes,
          cost: result.cost,
        },
        ui: {
          type: "success",
          title: "Backup Pushed",
          body:
            `ID: ${backupId}\n` +
            `Root: ${colors.info(result.root)}\n` +
            `Source: ${opts.source}\n` +
            `Size: ${result.sizeBytes} bytes\n` +
            `Cost: ${formatCostDisplay(result.cost)}`,
        },
      });
    });

  return backup;
}

async function pushWalletLatest(wallet: string): Promise<void> {
  // Find the latest wallet backup
  if (!existsSync(BACKUPS_DIR)) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND,
      "No wallet backups found.",
      "Run `echoclaw wallet backup` first."
    );
  }

  const dirs = readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (dirs.length === 0) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND,
      "No wallet backups found.",
      "Run `echoclaw wallet backup` first."
    );
  }

  const latestDir = join(BACKUPS_DIR, dirs[dirs.length - 1]);
  const manifestPath = join(latestDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    throw new EchoError(ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND, "Latest backup has no manifest.", "Run `echoclaw wallet backup` to create a fresh backup.");
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const files: string[] = manifest.files ?? [];

  if (files.length === 0) {
    throw new EchoError(ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND, "Backup manifest has no files.");
  }

  const s = spinner("Uploading wallet backup to 0G Storage...");
  s.start();

  const config = getStorageClientConfig();
  const index = loadDriveIndex(wallet);
  const timestamp = dirs[dirs.length - 1];
  const backupId = `wallet-${timestamp}`;
  driveMkdir(index, `/backups/${backupId}`);

  const uploadedFiles: Array<{ name: string; root: string; sizeBytes: number }> = [];
  let totalCostWei = 0n;

  for (const fileName of files) {
    const filePath = join(latestDir, fileName);
    if (!existsSync(filePath)) continue;

    s.text = `Uploading ${fileName}...`;
    const result = await uploadFile(config, filePath);

    const vpath = `/backups/${backupId}/${fileName}`;
    drivePut(index, vpath, {
      type: "file",
      root: result.root,
      txHash: result.txHash,
      txSeq: null,
      sizeBytes: result.sizeBytes,
      checksum: result.checksum,
      uploadedAt: result.uploadedAt,
      cost: result.cost,
    });

    uploadedFiles.push({ name: fileName, root: result.root, sizeBytes: result.sizeBytes });
    totalCostWei += BigInt(result.cost.totalWei);
  }

  // Also upload manifest
  s.text = "Uploading manifest...";
  const manifestResult = await uploadFile(config, manifestPath);
  const manifestVpath = `/backups/${backupId}/manifest.json`;
  drivePut(index, manifestVpath, {
    type: "file",
    root: manifestResult.root,
    txHash: manifestResult.txHash,
    txSeq: null,
    sizeBytes: manifestResult.sizeBytes,
    checksum: manifestResult.checksum,
    uploadedAt: manifestResult.uploadedAt,
    cost: manifestResult.cost,
  });
  totalCostWei += BigInt(manifestResult.cost.totalWei);

  saveDriveIndex(index);
  s.succeed("Wallet backup uploaded");

  const { formatCost } = await import("../../0g-storage/cost.js");
  const totalCost = formatCost(totalCostWei);

  respond({
    data: {
      backupId,
      source: "wallet-latest",
      files: uploadedFiles,
      cost: totalCost,
    },
    ui: {
      type: "success",
      title: "Wallet Backup Pushed",
      body:
        `ID: ${backupId}\n` +
        `Files: ${uploadedFiles.map((f) => f.name).join(", ")}\n` +
        `Cost: ${formatCostDisplay(totalCost)}`,
    },
  });
}
