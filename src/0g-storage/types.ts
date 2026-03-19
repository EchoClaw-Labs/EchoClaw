/**
 * Types for the 0G Storage module.
 * Framework-agnostic — no dependency on any specific agent runtime.
 */

// ── Drive Index ─────────────────────────────────────────────────────

export interface CostInfo {
  totalWei: string;
  total0G: string;
}

export interface DriveFileEntry {
  type: "file";
  root: string;
  txHash: string;
  txSeq: number | null;
  sizeBytes: number;
  checksum: string | null;
  uploadedAt: string;
  cost: CostInfo;
}

export interface DriveDirEntry {
  type: "dir";
  createdAt: string;
}

export type DriveEntry = DriveFileEntry | DriveDirEntry;

export interface DriveSnapshot {
  root: string;
  createdAt: string;
  entryCount: number;
}

export interface DriveIndex {
  version: 1;
  wallet: string;
  entries: Record<string, DriveEntry>;
  snapshots: DriveSnapshot[];
}

// ── File Operations ─────────────────────────────────────────────────

export interface UploadResult {
  root: string;
  txHash: string;
  sizeBytes: number;
  checksum: string;
  uploadedAt: string;
  cost: CostInfo;
}

export interface DownloadResult {
  root: string;
  out: string;
  sizeBytes: number;
}

export interface FileInfo {
  root: string;
  txSeq: number;
  size: number;
  finalized: boolean;
  pruned: boolean;
  uploadedSegNum: number;
  isCached: boolean;
}

// ── Storage Client Config ───────────────────────────────────────────

export interface StorageEndpoints {
  evmRpcUrl: string;
  indexerRpcUrl: string;
  flowContract: string;
}
