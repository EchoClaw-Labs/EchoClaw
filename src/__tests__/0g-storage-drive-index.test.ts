import { describe, it, expect } from "vitest";
import {
  normalizePath,
  validatePath,
  drivePut,
  driveGet,
  driveMkdir,
  driveRm,
  driveMv,
  driveLs,
  driveTree,
  driveFind,
  driveDu,
  addSnapshot,
  serializeIndex,
  deserializeIndex,
} from "../0g-storage/drive-index.js";
import type { DriveIndex, DriveFileEntry } from "../0g-storage/types.js";

function emptyIndex(): DriveIndex {
  return { version: 1, wallet: "0xtest", entries: {}, snapshots: [] };
}

function fileEntry(overrides?: Partial<DriveFileEntry>): DriveFileEntry {
  return {
    type: "file",
    root: "0xabc",
    txHash: "0xdef",
    txSeq: null,
    sizeBytes: 100,
    checksum: "sha256:abc123",
    uploadedAt: "2026-01-01T00:00:00Z",
    cost: { totalWei: "1000", total0G: "0.000001" },
    ...overrides,
  };
}

// ── normalizePath ──────────────────────────────────────────────────

describe("normalizePath", () => {
  it("adds leading slash", () => {
    expect(normalizePath("docs/file.txt")).toBe("/docs/file.txt");
  });

  it("preserves existing leading slash", () => {
    expect(normalizePath("/docs/file.txt")).toBe("/docs/file.txt");
  });

  it("collapses double slashes", () => {
    expect(normalizePath("/docs//file.txt")).toBe("/docs/file.txt");
    expect(normalizePath("///a///b///")).toBe("/a/b/");
  });

  it("trims whitespace", () => {
    expect(normalizePath("  /docs/file.txt  ")).toBe("/docs/file.txt");
  });
});

// ── validatePath ───────────────────────────────────────────────────

describe("validatePath", () => {
  it("accepts valid paths", () => {
    expect(() => validatePath("/docs/file.txt")).not.toThrow();
    expect(() => validatePath("/a/b/c/d")).not.toThrow();
    expect(() => validatePath("/notes/")).not.toThrow();
  });

  it("rejects . segments", () => {
    expect(() => validatePath("/./file")).toThrow();
  });

  it("rejects .. segments", () => {
    expect(() => validatePath("/docs/../file")).toThrow();
  });

  it("rejects invalid characters", () => {
    expect(() => validatePath("/docs/file name.txt")).toThrow();
    expect(() => validatePath("/docs/file@name")).toThrow();
  });

  it("rejects path > 512 chars", () => {
    const longPath = "/" + "a".repeat(512);
    expect(() => validatePath(longPath)).toThrow();
  });

  it("rejects segment > 255 chars", () => {
    const longSeg = "/" + "a".repeat(256);
    expect(() => validatePath(longSeg)).toThrow();
  });
});

// ── drivePut ───────────────────────────────────────────────────────

describe("drivePut", () => {
  it("adds a file entry", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/readme.md", fileEntry());
    expect(idx.entries["/docs/readme.md"]).toBeDefined();
    expect(idx.entries["/docs/readme.md"].type).toBe("file");
  });

  it("creates implicit parent dirs", () => {
    const idx = emptyIndex();
    drivePut(idx, "/a/b/c.txt", fileEntry());
    expect(idx.entries["/a/"]).toBeDefined();
    expect(idx.entries["/a/"].type).toBe("dir");
    expect(idx.entries["/a/b/"]).toBeDefined();
    expect(idx.entries["/a/b/"].type).toBe("dir");
  });

  it("rejects trailing slash for file path", () => {
    const idx = emptyIndex();
    expect(() => drivePut(idx, "/docs/", fileEntry())).toThrow();
  });

  it("normalizes path before storing", () => {
    const idx = emptyIndex();
    drivePut(idx, "docs//file.txt", fileEntry());
    expect(idx.entries["/docs/file.txt"]).toBeDefined();
  });
});

// ── driveMkdir ─────────────────────────────────────────────────────

describe("driveMkdir", () => {
  it("creates a directory", () => {
    const idx = emptyIndex();
    driveMkdir(idx, "/docs");
    expect(idx.entries["/docs/"]).toBeDefined();
    expect(idx.entries["/docs/"].type).toBe("dir");
  });

  it("creates parent dirs", () => {
    const idx = emptyIndex();
    driveMkdir(idx, "/a/b/c");
    expect(idx.entries["/a/"]).toBeDefined();
    expect(idx.entries["/a/b/"]).toBeDefined();
    expect(idx.entries["/a/b/c/"]).toBeDefined();
  });

  it("is idempotent", () => {
    const idx = emptyIndex();
    driveMkdir(idx, "/docs");
    const created = idx.entries["/docs/"];
    driveMkdir(idx, "/docs");
    expect(idx.entries["/docs/"]).toBe(created);
  });
});

// ── driveGet ───────────────────────────────────────────────────────

describe("driveGet", () => {
  it("returns existing entry", () => {
    const idx = emptyIndex();
    drivePut(idx, "/file.txt", fileEntry({ root: "0x123" }));
    const entry = driveGet(idx, "/file.txt");
    expect(entry.type).toBe("file");
    if (entry.type === "file") {
      expect(entry.root).toBe("0x123");
    }
  });

  it("throws on missing path", () => {
    const idx = emptyIndex();
    expect(() => driveGet(idx, "/nonexistent")).toThrow();
  });
});

// ── driveRm ────────────────────────────────────────────────────────

describe("driveRm", () => {
  it("removes a file", () => {
    const idx = emptyIndex();
    drivePut(idx, "/file.txt", fileEntry());
    driveRm(idx, "/file.txt");
    expect(idx.entries["/file.txt"]).toBeUndefined();
  });

  it("removes a directory and its children", () => {
    const idx = emptyIndex();
    driveMkdir(idx, "/docs");
    drivePut(idx, "/docs/a.txt", fileEntry());
    drivePut(idx, "/docs/b.txt", fileEntry());
    driveRm(idx, "/docs/");
    expect(idx.entries["/docs/"]).toBeUndefined();
    expect(idx.entries["/docs/a.txt"]).toBeUndefined();
    expect(idx.entries["/docs/b.txt"]).toBeUndefined();
  });

  it("throws on missing path", () => {
    const idx = emptyIndex();
    expect(() => driveRm(idx, "/nonexistent")).toThrow();
  });
});

// ── driveMv ────────────────────────────────────────────────────────

describe("driveMv", () => {
  it("moves a file", () => {
    const idx = emptyIndex();
    drivePut(idx, "/old.txt", fileEntry({ root: "0xmoved" }));
    driveMv(idx, "/old.txt", "/new.txt");
    expect(idx.entries["/old.txt"]).toBeUndefined();
    const entry = idx.entries["/new.txt"];
    expect(entry).toBeDefined();
    expect(entry.type).toBe("file");
    if (entry.type === "file") expect(entry.root).toBe("0xmoved");
  });

  it("moves a directory and its children", () => {
    const idx = emptyIndex();
    driveMkdir(idx, "/src");
    drivePut(idx, "/src/file.txt", fileEntry());
    driveMv(idx, "/src/", "/dest/");
    expect(idx.entries["/src/"]).toBeUndefined();
    expect(idx.entries["/src/file.txt"]).toBeUndefined();
    expect(idx.entries["/dest/"]).toBeDefined();
    expect(idx.entries["/dest/file.txt"]).toBeDefined();
  });

  it("throws on conflict", () => {
    const idx = emptyIndex();
    drivePut(idx, "/a.txt", fileEntry());
    drivePut(idx, "/b.txt", fileEntry());
    expect(() => driveMv(idx, "/a.txt", "/b.txt")).toThrow();
  });
});

// ── driveLs ────────────────────────────────────────────────────────

describe("driveLs", () => {
  it("lists root directory", () => {
    const idx = emptyIndex();
    drivePut(idx, "/a.txt", fileEntry());
    driveMkdir(idx, "/docs");
    const entries = driveLs(idx, "/");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const names = entries.map(e => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("docs");
  });

  it("lists subdirectory non-recursively", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/a.txt", fileEntry());
    drivePut(idx, "/docs/sub/b.txt", fileEntry());
    const entries = driveLs(idx, "/docs", false);
    const names = entries.map(e => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("sub");
    expect(names).not.toContain("sub/b.txt");
  });

  it("lists recursively", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/a.txt", fileEntry());
    drivePut(idx, "/docs/sub/b.txt", fileEntry());
    const entries = driveLs(idx, "/docs", true);
    const names = entries.map(e => e.name);
    expect(names).toContain("a.txt");
    expect(names.some(n => n.includes("b.txt"))).toBe(true);
  });

  it("deduplicates intermediate dirs in non-recursive mode", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/sub/a.txt", fileEntry());
    drivePut(idx, "/docs/sub/b.txt", fileEntry());
    const entries = driveLs(idx, "/docs", false);
    const dirEntries = entries.filter(e => e.type === "dir" && e.name === "sub");
    expect(dirEntries.length).toBe(1);
  });
});

// ── driveFind ──────────────────────────────────────────────────────

describe("driveFind", () => {
  it("finds by filename glob", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/readme.md", fileEntry());
    drivePut(idx, "/docs/notes.txt", fileEntry());
    const results = driveFind(idx, "*.md");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("/docs/readme.md");
  });

  it("finds by path glob", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/readme.md", fileEntry());
    drivePut(idx, "/src/main.ts", fileEntry());
    const results = driveFind(idx, "/docs/*");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ── driveDu ────────────────────────────────────────────────────────

describe("driveDu", () => {
  it("calculates correct totals", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/a.txt", fileEntry({ sizeBytes: 100 }));
    drivePut(idx, "/docs/b.txt", fileEntry({ sizeBytes: 200 }));
    const result = driveDu(idx, "/docs");
    expect(result.totalBytes).toBe(300);
    expect(result.fileCount).toBe(2);
  });

  it("calculates from root", () => {
    const idx = emptyIndex();
    drivePut(idx, "/a.txt", fileEntry({ sizeBytes: 50 }));
    drivePut(idx, "/docs/b.txt", fileEntry({ sizeBytes: 150 }));
    const result = driveDu(idx, "/");
    expect(result.totalBytes).toBe(200);
    expect(result.fileCount).toBe(2);
  });
});

// ── driveTree ──────────────────────────────────────────────────────

describe("driveTree", () => {
  it("returns (empty) for empty index", () => {
    const idx = emptyIndex();
    expect(driveTree(idx, "/")).toBe("(empty)");
  });

  it("returns tree string with entries", () => {
    const idx = emptyIndex();
    drivePut(idx, "/docs/readme.md", fileEntry({ sizeBytes: 100 }));
    const tree = driveTree(idx, "/");
    expect(tree).toContain("readme.md");
  });
});

// ── Snapshot helpers ───────────────────────────────────────────────

describe("snapshot helpers", () => {
  it("addSnapshot appends to snapshots array", () => {
    const idx = emptyIndex();
    drivePut(idx, "/file.txt", fileEntry());
    addSnapshot(idx, "0xsnap1");
    expect(idx.snapshots.length).toBe(1);
    expect(idx.snapshots[0].root).toBe("0xsnap1");
    expect(idx.snapshots[0].entryCount).toBeGreaterThan(0);
  });

  it("serializeIndex / deserializeIndex round-trip", () => {
    const idx = emptyIndex();
    drivePut(idx, "/file.txt", fileEntry());
    addSnapshot(idx, "0xsnap1");

    const serialized = serializeIndex(idx);
    const restored = deserializeIndex(serialized);

    expect(restored.version).toBe(1);
    expect(restored.entries["/file.txt"]).toBeDefined();
    expect(restored.snapshots.length).toBe(1);
  });

  it("deserializeIndex rejects invalid version", () => {
    const bad = JSON.stringify({ version: 2, wallet: "0x", entries: {}, snapshots: [] });
    expect(() => deserializeIndex(bad)).toThrow();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────

describe("edge cases", () => {
  it("empty index operations", () => {
    const idx = emptyIndex();
    expect(driveLs(idx, "/")).toEqual([]);
    expect(driveTree(idx, "/")).toBe("(empty)");
    expect(driveDu(idx, "/")).toEqual({ path: "/", totalBytes: 0, fileCount: 0 });
    expect(driveFind(idx, "*")).toEqual([]);
  });

  it("root path / listing", () => {
    const idx = emptyIndex();
    drivePut(idx, "/top.txt", fileEntry());
    const entries = driveLs(idx, "/");
    expect(entries.map(e => e.name)).toContain("top.txt");
  });
});
