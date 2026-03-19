import { Command } from "commander";
import { existsSync } from "node:fs";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors } from "../../utils/ui.js";
import { getStorageClientConfig } from "../../0g-storage/client.js";
import { uploadFile, downloadFile, getFileInfo } from "../../0g-storage/files.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";

export function createFileCommand(): Command {
  const file = new Command("file")
    .description("Raw 0G Storage file operations");

  // ── file upload ───────────────────────────────────────────
  file
    .command("upload")
    .description("Upload a file to 0G Storage")
    .requiredOption("--file <path>", "Local file path to upload")
    .option("--tags <hex>", "Optional hex-encoded tags")
    .option("--json", "JSON output")
    .action(async (opts: { file: string; tags?: string }) => {
      if (!existsSync(opts.file)) {
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND,
          `File not found: ${opts.file}`,
        );
      }

      const s = spinner("Uploading to 0G Storage...");
      s.start();

      const config = getStorageClientConfig();
      const result = await uploadFile(config, opts.file, opts.tags);

      s.succeed("Upload complete");

      respond({
        data: {
          root: result.root,
          txHash: result.txHash,
          sizeBytes: result.sizeBytes,
          checksum: result.checksum,
          uploadedAt: result.uploadedAt,
          cost: result.cost,
        },
        ui: {
          type: "success",
          title: "File Uploaded",
          body:
            `Root: ${colors.info(result.root)}\n` +
            `TX: ${colors.info(result.txHash)}\n` +
            `Size: ${result.sizeBytes} bytes\n` +
            `Cost: ${formatCostDisplay(result.cost)}`,
        },
      });
    });

  // ── file download ─────────────────────────────────────────
  file
    .command("download")
    .description("Download a file from 0G Storage by root hash")
    .requiredOption("--root <hash>", "Root hash (0x...)")
    .requiredOption("--out <path>", "Output file path")
    .option("--proof", "Include Merkle proof")
    .option("--json", "JSON output")
    .action(async (opts: { root: string; out: string; proof?: boolean }) => {
      const s = spinner("Downloading from 0G Storage...");
      s.start();

      const config = getStorageClientConfig();
      const result = await downloadFile(config, opts.root, opts.out, opts.proof);

      s.succeed("Download complete");

      respond({
        data: {
          root: result.root,
          out: result.out,
          sizeBytes: result.sizeBytes,
        },
        ui: {
          type: "success",
          title: "File Downloaded",
          body:
            `Root: ${colors.info(result.root)}\n` +
            `Path: ${result.out}\n` +
            `Size: ${result.sizeBytes} bytes`,
        },
      });
    });

  // ── file info ─────────────────────────────────────────────
  file
    .command("info")
    .description("Query file info from storage nodes")
    .option("--root <hash>", "Root hash (0x...)")
    .option("--txseq <n>", "Transaction sequence number")
    .option("--json", "JSON output")
    .action(async (opts: { root?: string; txseq?: string }) => {
      if (!opts.root && !opts.txseq) {
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND,
          "Either --root or --txseq is required.",
        );
      }

      const s = spinner("Querying file info...");
      s.start();

      const config = getStorageClientConfig();
      const info = await getFileInfo(config, {
        root: opts.root,
        txSeq: opts.txseq ? parseInt(opts.txseq, 10) : undefined,
      });

      s.succeed("File info retrieved");

      respond({
        data: {
          root: info.root,
          txSeq: info.txSeq,
          size: info.size,
          finalized: info.finalized,
          pruned: info.pruned,
          uploadedSegNum: info.uploadedSegNum,
          isCached: info.isCached,
        },
        ui: {
          type: "info",
          title: "File Info",
          body:
            `Root: ${colors.info(info.root)}\n` +
            `txSeq: ${info.txSeq}\n` +
            `Size: ${info.size} bytes\n` +
            `Finalized: ${info.finalized}\n` +
            `Pruned: ${info.pruned}\n` +
            `Cached: ${info.isCached}`,
        },
      });
    });

  return file;
}
