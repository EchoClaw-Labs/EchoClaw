import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules ────────────────────────────────────────────────────

const { mockUpload, mockDownload, mockGetFileInfo } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockDownload: vi.fn(),
  mockGetFileInfo: vi.fn(),
}));

vi.mock("../0g-compute/bridge.js", () => ({
  withSuppressedConsole: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../0g-storage/sdk-bridge.cjs", () => ({
  storageUpload: mockUpload,
  storageDownload: mockDownload,
  storageGetFileInfo: mockGetFileInfo,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn(() => ({ size: 256 })),
    readFileSync: vi.fn(() => Buffer.from("test-content")),
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────

import { uploadFile, downloadFile, getFileInfo } from "../0g-storage/files.js";
import type { StorageClientConfig } from "../0g-storage/client.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): StorageClientConfig {
  return {
    endpoints: {
      evmRpcUrl: "http://rpc.test",
      indexerRpcUrl: "http://indexer.test",
      flowContract: "0xflow",
    },
    privateKey: "0xprivkey",
    address: "0xaddr",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── uploadFile ──────────────────────────────────────────────────────

describe("uploadFile", () => {
  it("returns correct shape on success", async () => {
    mockUpload.mockResolvedValue({
      root: "0xroot123",
      txHash: "0xtxhash456",
      balanceBefore: 2000n,
      balanceAfter: 1000n,
    });

    const result = await uploadFile(makeConfig(), "/tmp/test.txt");

    expect(result.root).toBe("0xroot123");
    expect(result.txHash).toBe("0xtxhash456");
    expect(result.sizeBytes).toBe(256);
    expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.uploadedAt).toBeTruthy();
    expect(result.cost.totalWei).toBe("1000");
  });

  it("does NOT return txSeq", async () => {
    mockUpload.mockResolvedValue({
      root: "0xroot",
      txHash: "0xtx",
      balanceBefore: 100n,
      balanceAfter: 50n,
    });

    const result = await uploadFile(makeConfig(), "/tmp/test.txt");
    expect(result).not.toHaveProperty("txSeq");
  });

  it("throws ZG_STORAGE_UPLOAD_FAILED on SDK error", async () => {
    mockUpload.mockRejectedValue(new Error("network down"));

    await expect(uploadFile(makeConfig(), "/tmp/test.txt")).rejects.toThrow(
      /Upload failed.*network down/
    );
  });
});

// ── downloadFile ────────────────────────────────────────────────────

describe("downloadFile", () => {
  it("returns result on success", async () => {
    mockDownload.mockResolvedValue(null);

    const result = await downloadFile(makeConfig(), "0xroot", "/tmp/out.txt");

    expect(result.root).toBe("0xroot");
    expect(result.out).toBe("/tmp/out.txt");
    expect(result.sizeBytes).toBe(256);
  });

  it("throws ZG_STORAGE_DOWNLOAD_FAILED on SDK error", async () => {
    mockDownload.mockResolvedValue("timeout");

    await expect(
      downloadFile(makeConfig(), "0xroot", "/tmp/out.txt")
    ).rejects.toThrow(/Download failed.*timeout/);
  });
});

// ── getFileInfo ─────────────────────────────────────────────────────

describe("getFileInfo", () => {
  it("returns info by root", async () => {
    mockGetFileInfo.mockResolvedValue({
      root: "0xroot",
      txSeq: 42,
      size: 1024,
      finalized: true,
      uploadedSegNum: 10,
      isCached: false,
    });

    const info = await getFileInfo(makeConfig(), { root: "0xroot" });

    expect(info.root).toBe("0xroot");
    expect(info.txSeq).toBe(42);
    expect(info.size).toBe(1024);
    expect(info.finalized).toBe(true);
    expect(info.pruned).toBe(false);
  });

  it("returns info by txSeq", async () => {
    mockGetFileInfo.mockResolvedValue({
      root: "0xfound",
      txSeq: 99,
      size: 512,
      finalized: false,
      uploadedSegNum: 5,
      isCached: true,
    });

    const info = await getFileInfo(makeConfig(), { txSeq: 99 });
    expect(info.root).toBe("0xfound");
    expect(info.isCached).toBe(true);
  });

  it("throws ZG_STORAGE_FILE_NOT_FOUND when not found", async () => {
    mockGetFileInfo.mockResolvedValue(null);

    await expect(
      getFileInfo(makeConfig(), { root: "0xmissing" })
    ).rejects.toThrow(/File info not found/);
  });
});
