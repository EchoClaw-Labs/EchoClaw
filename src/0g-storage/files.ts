/**
 * 0G Storage file operations: upload, download, info.
 * Delegates to sdk-bridge.cjs for ethers/SDK interaction (CJS bridge pattern).
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { storageUpload, storageDownload, storageGetFileInfo } from "./sdk-bridge.cjs";
import { withSuppressedConsole } from "../0g-compute/bridge.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { formatCost } from "./cost.js";
import type { StorageClientConfig } from "./client.js";
import type { UploadResult, DownloadResult, FileInfo } from "./types.js";

function sha256File(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function uploadFile(
  config: StorageClientConfig,
  filePath: string,
  tags?: string
): Promise<UploadResult> {
  const sizeBytes = statSync(filePath).size;

  try {
    const result = await withSuppressedConsole(() =>
      storageUpload(
        config.endpoints.indexerRpcUrl,
        config.endpoints.evmRpcUrl,
        config.privateKey,
        filePath,
        tags,
      )
    );

    const cost = formatCost(result.balanceBefore - result.balanceAfter);

    return {
      root: result.root,
      txHash: result.txHash,
      sizeBytes,
      checksum: `sha256:${sha256File(filePath)}`,
      uploadedAt: new Date().toISOString(),
      cost,
    };
  } catch (err) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_UPLOAD_FAILED,
      `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      "Check wallet balance and network connectivity."
    );
  }
}

export async function downloadFile(
  config: StorageClientConfig,
  root: string,
  outPath: string,
  withProof = false
): Promise<DownloadResult> {
  const err = await withSuppressedConsole(() =>
    storageDownload(config.endpoints.indexerRpcUrl, root, outPath, withProof)
  );

  if (err) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_DOWNLOAD_FAILED,
      `Download failed: ${err}`,
      "Check that the root hash is correct and the file exists on the network."
    );
  }

  const sizeBytes = statSync(outPath).size;
  return { root, out: outPath, sizeBytes };
}

export async function getFileInfo(
  config: StorageClientConfig,
  opts: { root?: string; txSeq?: number }
): Promise<FileInfo> {
  const info = await withSuppressedConsole(() =>
    storageGetFileInfo(config.endpoints.indexerRpcUrl, opts.root, opts.txSeq)
  );

  if (!info) {
    throw new EchoError(
      ErrorCodes.ZG_STORAGE_FILE_NOT_FOUND,
      "File info not found on any storage node.",
      opts.root
        ? `Root: ${opts.root}. The file may not be fully propagated yet.`
        : `txSeq: ${opts.txSeq}. The file may not be fully propagated yet.`
    );
  }

  return {
    root: info.root,
    txSeq: info.txSeq,
    size: info.size,
    finalized: info.finalized,
    pruned: false,
    uploadedSegNum: info.uploadedSegNum,
    isCached: info.isCached,
  };
}
