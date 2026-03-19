import { Command } from "commander";
import { existsSync } from "node:fs";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors } from "../../utils/ui.js";
import { getStorageClientConfig } from "../../0g-storage/client.js";
import { uploadFile, downloadFile } from "../../0g-storage/files.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";
import { requireWallet } from "./shared.js";
import {
  loadDriveIndex,
  saveDriveIndex,
  drivePut,
  driveGet,
} from "../../0g-storage/drive-index.js";

export function addDriveNetworkCommands(drive: Command): void {
  // ── drive put ─────────────────────────────────────────────
  drive
    .command("put")
    .description("Upload a file and register it in the drive index")
    .requiredOption("--file <path>", "Local file path")
    .requiredOption("--path <vpath>", "Virtual path in drive (e.g. /docs/readme.md)")
    .option("--force", "Overwrite existing entry")
    .option("--json", "JSON output")
    .action(async (opts: { file: string; path: string; force?: boolean }) => {
      if (!existsSync(opts.file)) {
        throw new EchoError(ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND, `File not found: ${opts.file}`);
      }

      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);

      // Check if path already exists
      if (index.entries[opts.path] && !opts.force) {
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_INDEX_CONFLICT,
          `Path already exists: ${opts.path}`,
          "Use --force to overwrite."
        );
      }

      const s = spinner(`Uploading ${opts.file} to drive...`);
      s.start();

      const config = getStorageClientConfig();
      const result = await uploadFile(config, opts.file);

      drivePut(index, opts.path, {
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

      s.succeed("Uploaded and indexed");

      respond({
        data: {
          path: opts.path,
          root: result.root,
          txHash: result.txHash,
          sizeBytes: result.sizeBytes,
          cost: result.cost,
        },
        ui: {
          type: "success",
          title: "Drive Put",
          body:
            `Path: ${opts.path}\n` +
            `Root: ${colors.info(result.root)}\n` +
            `Size: ${result.sizeBytes} bytes\n` +
            `Cost: ${formatCostDisplay(result.cost)}`,
        },
      });
    });

  // ── drive get ─────────────────────────────────────────────
  drive
    .command("get")
    .description("Download a file from drive by virtual path")
    .requiredOption("--path <vpath>", "Virtual path in drive")
    .requiredOption("--out <path>", "Output file path")
    .option("--json", "JSON output")
    .action(async (opts: { path: string; out: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entry = driveGet(index, opts.path);

      if (entry.type !== "file") {
        throw new EchoError(ErrorCodes.ZG_STORAGE_INVALID_PATH, `Path is a directory: ${opts.path}`);
      }

      const s = spinner("Downloading from 0G Storage...");
      s.start();

      const config = getStorageClientConfig();
      const result = await downloadFile(config, entry.root, opts.out);

      s.succeed("Downloaded");

      respond({
        data: { path: opts.path, root: entry.root, out: result.out, sizeBytes: result.sizeBytes },
        ui: {
          type: "success",
          title: "Drive Get",
          body: `Path: ${opts.path}\nSaved to: ${result.out}\nSize: ${result.sizeBytes} bytes`,
        },
      });
    });
}
