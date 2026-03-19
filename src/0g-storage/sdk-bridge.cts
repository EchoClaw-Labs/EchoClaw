/**
 * CJS bridge module — ethers resolves to lib.commonjs here, matching SDK types.
 * This eliminates the #private nominal type mismatch between ESM and CJS Wallet.
 *
 * All parameters are plain strings/primitives — no ethers types cross the ESM/CJS boundary.
 */

import { Wallet, JsonRpcProvider } from "ethers";
import { Indexer, ZgFile, type FileInfo } from "@0gfoundation/0g-ts-sdk";

// ── Upload ──────────────────────────────────────────────────────────

export interface StorageUploadResult {
  root: string;
  txHash: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
}

export async function storageUpload(
  indexerUrl: string,
  evmRpcUrl: string,
  privateKey: string,
  filePath: string,
  tags?: string
): Promise<StorageUploadResult> {
  const provider = new JsonRpcProvider(evmRpcUrl);
  const signer = new Wallet(privateKey, provider);
  const indexer = new Indexer(indexerUrl);

  const balanceBefore = await provider.getBalance(signer.address);

  const zgFile = await ZgFile.fromFilePath(filePath);
  try {
    const [result, err] = await indexer.upload(
      zgFile,
      evmRpcUrl,
      signer,
      tags ? { tags } : undefined,
    );

    if (err) throw err;

    const balanceAfter = await provider.getBalance(signer.address);

    let root: string;
    let txHash: string;
    if ("rootHash" in result) {
      root = result.rootHash;
      txHash = result.txHash;
    } else {
      root = result.rootHashes[0];
      txHash = result.txHashes[0];
    }

    return { root, txHash, balanceBefore, balanceAfter };
  } finally {
    await zgFile.close();
  }
}

// ── Download ────────────────────────────────────────────────────────

export async function storageDownload(
  indexerUrl: string,
  rootHash: string,
  outPath: string,
  proof: boolean
): Promise<Error | null> {
  const indexer = new Indexer(indexerUrl);
  return indexer.download(rootHash, outPath, proof);
}

// ── File Info ────────────────────────────────────────────────────────

export interface StorageFileInfo {
  root: string;
  txSeq: number;
  size: number;
  finalized: boolean;
  uploadedSegNum: number;
  isCached: boolean;
}

export async function storageGetFileInfo(
  indexerUrl: string,
  root: string | undefined,
  txSeq: number | undefined
): Promise<StorageFileInfo | null> {
  const indexer = new Indexer(indexerUrl);
  const [nodes, nodesErr] = await indexer.selectNodes(1);

  if (nodesErr || !nodes || nodes.length === 0) {
    return null;
  }

  let info: FileInfo | null = null;

  for (const node of nodes) {
    // Prefer getFileInfoByTxSeq (reliable) over getFileInfo (buggy on some nodes)
    if (txSeq != null) {
      try {
        info = await node.getFileInfoByTxSeq(txSeq);
        if (info) break;
      } catch {
        // try next strategy
      }
    }

    if (root) {
      try {
        info = await node.getFileInfo(root, false);
        if (info) break;
      } catch {
        // try next node
      }
    }
  }

  if (!info) return null;

  return {
    root: info.tx.dataMerkleRoot ?? root ?? "",
    txSeq: info.tx.seq != null ? Number(info.tx.seq) : (txSeq ?? 0),
    size: info.tx.size != null ? Number(info.tx.size) : 0,
    finalized: info.finalized,
    uploadedSegNum: info.uploadedSegNum != null ? Number(info.uploadedSegNum) : 0,
    isCached: info.isCached,
  };
}

// ── Connectivity Check ──────────────────────────────────────────────

export interface ConnectivityResult {
  rpc: boolean;
  indexer: boolean;
  rpcDetail?: string;
  indexerDetail?: string;
}

export async function storageCheckConnectivity(
  evmRpcUrl: string,
  indexerUrl: string
): Promise<ConnectivityResult> {
  const result: ConnectivityResult = { rpc: false, indexer: false };

  // Check RPC
  try {
    const provider = new JsonRpcProvider(evmRpcUrl);
    const network = await provider.getNetwork();
    if (Number(network.chainId) === 16661) {
      result.rpc = true;
    } else {
      result.rpcDetail = `Unexpected chainId: ${network.chainId} (expected 16661)`;
    }
  } catch (err) {
    result.rpcDetail = err instanceof Error ? err.message : String(err);
  }

  // Check Indexer
  try {
    const indexer = new Indexer(indexerUrl);
    const [nodes, nodesErr] = await indexer.selectNodes(1);
    if (nodesErr) {
      result.indexerDetail = String(nodesErr);
    } else if (!nodes || nodes.length === 0) {
      result.indexerDetail = "No storage nodes available";
    } else {
      result.indexer = true;
    }
  } catch (err) {
    result.indexerDetail = err instanceof Error ? err.message : String(err);
  }

  return result;
}
