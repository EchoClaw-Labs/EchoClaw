import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (referenced in vi.mock factories) ─────────────────

const {
  respondCalls,
  mockUploadFile,
  mockDownloadFile,
  mockLoadDriveIndex,
  mockSaveDriveIndex,
} = vi.hoisted(() => ({
  respondCalls: [] as Array<{ data: Record<string, unknown> }>,
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockLoadDriveIndex: vi.fn(),
  mockSaveDriveIndex: vi.fn(),
}));

// ── Mock utilities ──────────────────────────────────────────────────

vi.mock("../utils/respond.js", () => ({
  respond: vi.fn((result: { data: Record<string, unknown> }) => {
    respondCalls.push(result);
  }),
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: vi.fn(() => true),
  writeJsonSuccess: vi.fn(),
}));

vi.mock("../utils/ui.js", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), text: "" })),
  colors: {
    info: (s: string) => s,
    address: (s: string) => s,
    success: (s: string) => s,
    muted: (s: string) => s,
    bold: (s: string) => s,
  },
  successBox: vi.fn(),
  infoBox: vi.fn(),
  warnBox: vi.fn(),
}));

// ── Mock domain modules ─────────────────────────────────────────────

vi.mock("../0g-storage/files.js", () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  getFileInfo: vi.fn(),
}));

vi.mock("../0g-storage/client.js", () => ({
  getStorageClientConfig: vi.fn(() => ({
    endpoints: { evmRpcUrl: "http://rpc", indexerRpcUrl: "http://idx", flowContract: "0xflow" },
    privateKey: "0xkey",
    address: "0xaddr",
  })),
  getStorageEndpoints: vi.fn(() => ({
    evmRpcUrl: "http://rpc",
    indexerRpcUrl: "http://idx",
    flowContract: "0xflow",
  })),
}));

vi.mock("../0g-storage/cost.js", () => ({
  formatCost: vi.fn(() => ({ totalWei: "0", total0G: "0.000000" })),
  formatCostDisplay: vi.fn(() => "0.000000 0G"),
}));

vi.mock("../0g-storage/drive-index.js", () => ({
  loadDriveIndex: (...args: unknown[]) => mockLoadDriveIndex(...args),
  saveDriveIndex: (...args: unknown[]) => mockSaveDriveIndex(...args),
  drivePut: vi.fn(),
  driveGet: vi.fn(),
  driveLs: vi.fn(() => []),
  driveMkdir: vi.fn(),
  driveTree: vi.fn(() => "(empty)"),
  driveRm: vi.fn(),
  driveMv: vi.fn(),
  driveFind: vi.fn(() => []),
  driveDu: vi.fn(() => ({ path: "/", totalBytes: 0, fileCount: 0 })),
  addSnapshot: vi.fn(),
  serializeIndex: vi.fn(() => "{}"),
  deserializeIndex: vi.fn(() => ({ version: 1, wallet: "0xtest", entries: {}, snapshots: [] })),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: vi.fn(() => ({
    wallet: { address: "0xtest" },
    chain: { chainId: 16661, rpcUrl: "http://rpc", explorerUrl: "http://exp" },
    services: {
      backendApiUrl: "http://api",
      proxyApiUrl: "http://proxy",
      chatWsUrl: "ws://chat",
      storageIndexerRpcUrl: "http://idx",
      storageEvmRpcUrl: "http://rpc",
      storageFlowContract: "0xflow",
    },
  })),
}));

vi.mock("../wallet/auth.js", () => ({
  requireWalletAndKeystore: vi.fn(() => ({ address: "0xtest", privateKey: "0xkey" })),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 100, isDirectory: () => false })),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{"version":1,"wallet":"0xtest","entries":{},"snapshots":[]}'),
    mkdtempSync: vi.fn(() => "/tmp/test-dir"),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: "/tmp/echo-test",
  CONFIG_FILE: "/tmp/echo-test/config.json",
  KEYSTORE_FILE: "/tmp/echo-test/keystore.json",
  BACKUPS_DIR: "/tmp/echo-test/backups",
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { createFileCommand } from "../commands/0g-storage/file.js";
import { createNoteCommand } from "../commands/0g-storage/note.js";
import { EchoError, ErrorCodes } from "../errors.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeUploadResult(overrides?: Record<string, unknown>) {
  return {
    root: "0xroot123",
    txHash: "0xtxhash456",
    sizeBytes: 256,
    checksum: "sha256:abc123def456",
    uploadedAt: "2026-01-01T00:00:00Z",
    cost: { totalWei: "1000", total0G: "0.000001" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  respondCalls.length = 0;
});

// ── file upload JSON contract ───────────────────────────────────────

describe("file upload command", () => {
  it("JSON contract has root, txHash, sizeBytes, checksum, cost — no txSeq", async () => {
    mockUploadFile.mockResolvedValue(makeUploadResult());

    const cmd = createFileCommand();
    await cmd.parseAsync(["node", "file", "upload", "--file", "/tmp/test.txt", "--json"]);

    expect(respondCalls.length).toBe(1);
    const data = respondCalls[0].data;

    expect(data).toHaveProperty("root", "0xroot123");
    expect(data).toHaveProperty("txHash", "0xtxhash456");
    expect(data).toHaveProperty("sizeBytes", 256);
    expect(data).toHaveProperty("checksum", "sha256:abc123def456");
    expect(data).toHaveProperty("cost");

    // txSeq must NOT be in the output
    expect(data).not.toHaveProperty("txSeq");
  });

  it("throws ZG_STORAGE_FILE_NOT_FOUND for missing file", async () => {
    const { existsSync } = await import("node:fs");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const cmd = createFileCommand();
    await expect(
      cmd.parseAsync(["node", "file", "upload", "--file", "/nonexistent", "--json"])
    ).rejects.toThrow(/File not found/);
  });
});

// ── note list JSON contract ─────────────────────────────────────────

describe("note list command", () => {
  it("returns noteId, name, size, uploadedAt", async () => {
    const { driveLs } = await import("../0g-storage/drive-index.js");
    (driveLs as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { name: "1234-abcd.md", type: "file", size: 100 },
    ]);

    mockLoadDriveIndex.mockReturnValue({
      version: 1,
      wallet: "0xtest",
      entries: {
        "/notes/1234-abcd.md": {
          type: "file",
          root: "0xr",
          txHash: "0xt",
          txSeq: null,
          sizeBytes: 100,
          checksum: "sha256:abc",
          uploadedAt: "2026-01-01T00:00:00Z",
          cost: { totalWei: "0", total0G: "0" },
        },
      },
      snapshots: [],
    });

    const cmd = createNoteCommand();
    await cmd.parseAsync(["node", "note", "list", "--json"]);

    expect(respondCalls.length).toBe(1);
    const data = respondCalls[0].data;
    expect(data).toHaveProperty("notes");
    expect(data).toHaveProperty("count", 1);

    const notes = data.notes as Array<Record<string, unknown>>;
    expect(notes[0]).toHaveProperty("noteId", "1234-abcd");
    expect(notes[0]).toHaveProperty("name", "1234-abcd.md");
    expect(notes[0]).toHaveProperty("size", 100);
    expect(notes[0]).toHaveProperty("uploadedAt", "2026-01-01T00:00:00Z");
  });

  it("returns empty list", async () => {
    const { driveLs } = await import("../0g-storage/drive-index.js");
    (driveLs as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

    mockLoadDriveIndex.mockReturnValue({
      version: 1, wallet: "0xtest", entries: {}, snapshots: [],
    });

    const cmd = createNoteCommand();
    await cmd.parseAsync(["node", "note", "list", "--json"]);

    expect(respondCalls.length).toBe(1);
    expect(respondCalls[0].data).toHaveProperty("count", 0);
  });
});

// ── backup push — missing source ────────────────────────────────────

describe("backup push command", () => {
  it("throws for missing source file", async () => {
    const { existsSync } = await import("node:fs");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const { createStorageBackupCommand } = await import("../commands/0g-storage/backup.js");
    const cmd = createStorageBackupCommand();

    await expect(
      cmd.parseAsync(["node", "backup", "push", "--source", "/nonexistent", "--json"])
    ).rejects.toThrow(/File not found/);
  });

  it("rejects directory source", async () => {
    const { existsSync, statSync } = await import("node:fs");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      size: 0,
      isDirectory: () => true,
    });

    const { createStorageBackupCommand } = await import("../commands/0g-storage/backup.js");
    const cmd = createStorageBackupCommand();

    await expect(
      cmd.parseAsync(["node", "backup", "push", "--source", "/some/dir", "--json"])
    ).rejects.toThrow(/Directory upload not supported/);
  });
});

// ── drive snapshot restore ──────────────────────────────────────────

describe("drive snapshot restore", () => {
  it("throws CONFIRMATION_REQUIRED without --force in headless mode", async () => {
    const { createDriveCommand } = await import("../commands/0g-storage/drive.js");
    const cmd = createDriveCommand();

    try {
      await cmd.parseAsync(["node", "drive", "snapshot", "restore", "--root", "0xsnap", "--json"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EchoError);
      expect((err as EchoError).code).toBe(ErrorCodes.CONFIRMATION_REQUIRED);
    }
  });

  it("succeeds with --force and outputs backedUp", async () => {
    mockLoadDriveIndex.mockReturnValue({
      version: 1, wallet: "0xtest",
      entries: { "/old.txt": { type: "file", root: "0xold", txHash: "0x", txSeq: null, sizeBytes: 10, checksum: null, uploadedAt: "2026-01-01T00:00:00Z", cost: { totalWei: "0", total0G: "0" } } },
      snapshots: [],
    });

    mockUploadFile.mockResolvedValue(makeUploadResult({ root: "0xbackup" }));
    mockDownloadFile.mockResolvedValue({ root: "0xsnap", out: "/tmp/test-dir/drive-index.json", sizeBytes: 50 });

    const { createDriveCommand } = await import("../commands/0g-storage/drive.js");
    const cmd = createDriveCommand();

    await cmd.parseAsync(["node", "drive", "snapshot", "restore", "--root", "0xsnap", "--force", "--json"]);

    expect(respondCalls.length).toBe(1);
    const data = respondCalls[0].data;
    expect(data).toHaveProperty("root", "0xsnap");
    expect(data).toHaveProperty("entryCount");
    expect(data).toHaveProperty("backedUp");
  });
});
