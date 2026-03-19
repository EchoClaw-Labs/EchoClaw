import { Command } from "commander";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { colors } from "../../utils/ui.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";
import { requireWallet } from "./shared.js";
import {
  loadDriveIndex,
  saveDriveIndex,
  driveGet,
  driveLs,
  driveMkdir,
  driveTree,
  driveRm,
  driveMv,
  driveFind,
  driveDu,
  drivePut,
} from "../../0g-storage/drive-index.js";

export function addDriveLocalCommands(drive: Command): void {
  // ── drive ls ──────────────────────────────────────────────
  drive
    .command("ls")
    .description("List directory contents")
    .option("--path <dir>", "Directory path", "/")
    .option("--recursive", "List recursively")
    .option("--json", "JSON output")
    .action((opts: { path: string; recursive?: boolean }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entries = driveLs(index, opts.path, opts.recursive);

      respond({
        data: { path: opts.path, entries },
        ui: {
          type: "info",
          title: `Drive: ${opts.path}`,
          body: entries.length === 0
            ? "(empty)"
            : entries.map((e) => {
                const suffix = e.type === "dir" ? "/" : "";
                const size = e.size != null ? `  (${e.size} bytes)` : "";
                return `  ${e.name}${suffix}${size}`;
              }).join("\n"),
        },
      });
    });

  // ── drive mkdir ───────────────────────────────────────────
  drive
    .command("mkdir")
    .description("Create a directory")
    .requiredOption("--path <dir>", "Directory path")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      driveMkdir(index, opts.path);
      saveDriveIndex(index);

      respond({
        data: { path: opts.path },
        ui: { type: "success", title: "Directory Created", body: opts.path },
      });
    });

  // ── drive tree ────────────────────────────────────────────
  drive
    .command("tree")
    .description("Show directory tree")
    .option("--path <dir>", "Root directory", "/")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const tree = driveTree(index, opts.path);

      respond({
        data: { tree },
        ui: { type: "info", title: `Drive Tree: ${opts.path}`, body: tree },
      });
    });

  // ── drive rm ──────────────────────────────────────────────
  drive
    .command("rm")
    .description("Remove a file or directory from the drive index (data on 0G remains)")
    .requiredOption("--path <vpath>", "Path to remove")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const root = driveRm(index, opts.path);
      saveDriveIndex(index);

      respond({
        data: { path: opts.path, root: root || undefined },
        ui: {
          type: "success",
          title: "Removed",
          body: `${opts.path}${root ? `\nRoot: ${root}` : ""}\n\nNote: data on 0G Storage is immutable and remains accessible.`,
        },
      });
    });

  // ── drive mv ──────────────────────────────────────────────
  drive
    .command("mv")
    .description("Move/rename a file or directory in the drive index")
    .requiredOption("--from <path>", "Source path")
    .requiredOption("--to <path>", "Destination path")
    .option("--json", "JSON output")
    .action((opts: { from: string; to: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      driveMv(index, opts.from, opts.to);
      saveDriveIndex(index);

      respond({
        data: { from: opts.from, to: opts.to },
        ui: { type: "success", title: "Moved", body: `${opts.from} -> ${opts.to}` },
      });
    });

  // ── drive find ────────────────────────────────────────────
  drive
    .command("find")
    .description("Search for files by glob pattern")
    .requiredOption("--pattern <glob>", "Glob pattern (e.g. *.md, report*)")
    .option("--json", "JSON output")
    .action((opts: { pattern: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const matches = driveFind(index, opts.pattern);

      respond({
        data: { matches },
        ui: {
          type: "info",
          title: `Find: ${opts.pattern}`,
          body: matches.length === 0
            ? "No matches found."
            : matches.map((m) => `  ${m.path}${m.size != null ? ` (${m.size} bytes)` : ""}`).join("\n"),
        },
      });
    });

  // ── drive du ──────────────────────────────────────────────
  drive
    .command("du")
    .description("Show disk usage per directory")
    .option("--path <dir>", "Directory path", "/")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const result = driveDu(index, opts.path);

      respond({
        data: { path: result.path, totalBytes: result.totalBytes, fileCount: result.fileCount },
        ui: {
          type: "info",
          title: "Disk Usage",
          body: `Path: ${result.path}\nFiles: ${result.fileCount}\nTotal: ${result.totalBytes} bytes`,
        },
      });
    });

  // ── drive info ────────────────────────────────────────────
  drive
    .command("info")
    .description("Show detailed info for a file in the drive")
    .requiredOption("--path <vpath>", "Virtual path")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entry = driveGet(index, opts.path);

      if (entry.type === "dir") {
        respond({
          data: { path: opts.path, type: "dir", createdAt: entry.createdAt },
          ui: { type: "info", title: "Drive Info", body: `Path: ${opts.path}\nType: directory\nCreated: ${entry.createdAt}` },
        });
        return;
      }

      respond({
        data: {
          path: opts.path,
          type: "file",
          root: entry.root,
          txHash: entry.txHash,
          txSeq: entry.txSeq,
          sizeBytes: entry.sizeBytes,
          checksum: entry.checksum,
          uploadedAt: entry.uploadedAt,
          cost: entry.cost,
        },
        ui: {
          type: "info",
          title: "Drive Info",
          body:
            `Path: ${opts.path}\n` +
            `Root: ${colors.info(entry.root)}\n` +
            `TX: ${entry.txHash}\n` +
            `txSeq: ${entry.txSeq}\n` +
            `Size: ${entry.sizeBytes} bytes\n` +
            `Checksum: ${entry.checksum}\n` +
            `Uploaded: ${entry.uploadedAt}\n` +
            `Cost: ${formatCostDisplay(entry.cost)}`,
        },
      });
    });

  // ── drive share ───────────────────────────────────────────
  drive
    .command("share")
    .description("Get the root hash for sharing a file")
    .requiredOption("--path <vpath>", "Virtual path")
    .option("--json", "JSON output")
    .action((opts: { path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entry = driveGet(index, opts.path);

      if (entry.type !== "file") {
        throw new EchoError(ErrorCodes.ZG_STORAGE_INVALID_PATH, `Path is a directory: ${opts.path}`);
      }

      respond({
        data: { path: opts.path, root: entry.root, sizeBytes: entry.sizeBytes },
        ui: {
          type: "info",
          title: "Share",
          body: `Path: ${opts.path}\nRoot: ${colors.info(entry.root)}\nSize: ${entry.sizeBytes} bytes\n\nAnyone with this root hash can download the file.`,
        },
      });
    });

  // ── drive import ──────────────────────────────────────────
  drive
    .command("import")
    .description("Import an external file by root hash into the drive index")
    .requiredOption("--root <hash>", "Root hash of the file")
    .requiredOption("--path <vpath>", "Virtual path to assign")
    .option("--json", "JSON output")
    .action((opts: { root: string; path: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);

      if (index.entries[opts.path]) {
        throw new EchoError(
          ErrorCodes.ZG_STORAGE_INDEX_CONFLICT,
          `Path already exists: ${opts.path}`,
          "Use a different path or remove the existing entry first."
        );
      }

      drivePut(index, opts.path, {
        type: "file",
        root: opts.root,
        txHash: "",
        txSeq: null,
        sizeBytes: 0,
        checksum: null,
        uploadedAt: new Date().toISOString(),
        cost: { totalWei: "0", total0G: "0.000000" },
      });
      saveDriveIndex(index);

      respond({
        data: { path: opts.path, root: opts.root },
        ui: {
          type: "success",
          title: "Imported",
          body: `Path: ${opts.path}\nRoot: ${colors.info(opts.root)}`,
        },
      });
    });

  // ── drive export ──────────────────────────────────────────
  drive
    .command("export")
    .description("Export the drive index as JSON")
    .option("--json", "JSON output")
    .action(() => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entries = Object.entries(index.entries);

      respond({
        data: {
          entries: entries.map(([path, entry]) => ({ path, ...entry })),
          entryCount: entries.length,
        },
        ui: {
          type: "info",
          title: "Drive Export",
          body: `${entries.length} entries exported.`,
        },
      });
    });
}
