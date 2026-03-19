import { Command } from "commander";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { spinner, colors } from "../../utils/ui.js";
import { isHeadless } from "../../utils/output.js";
import { getStorageClientConfig } from "../../0g-storage/client.js";
import { uploadFile, downloadFile } from "../../0g-storage/files.js";
import { formatCostDisplay } from "../../0g-storage/cost.js";
import { requireWallet } from "./shared.js";
import {
  loadDriveIndex,
  saveDriveIndex,
  addSnapshot,
  serializeIndex,
  deserializeIndex,
} from "../../0g-storage/drive-index.js";

export function addDriveSnapshotCommands(drive: Command): void {
  const snapshot = new Command("snapshot")
    .description("Upload the drive index to 0G Storage as a snapshot")
    .option("--json", "JSON output")
    .action(async () => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entryCount = Object.keys(index.entries).length;

      const s = spinner("Uploading drive snapshot...");
      s.start();

      const tmpDir = mkdtempSync(join(tmpdir(), "echo-drive-snapshot-"));
      const tmpFile = join(tmpDir, "drive-index.json");

      try {
        writeFileSync(tmpFile, serializeIndex(index), "utf-8");

        const config = getStorageClientConfig();
        const result = await uploadFile(config, tmpFile);

        addSnapshot(index, result.root);
        saveDriveIndex(index);

        s.succeed("Snapshot uploaded");

        respond({
          data: { root: result.root, entryCount, cost: result.cost },
          ui: {
            type: "success",
            title: "Drive Snapshot",
            body: `Root: ${colors.info(result.root)}\nEntries: ${entryCount}\nCost: ${formatCostDisplay(result.cost)}`,
          },
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  // ── drive snapshot list ───────────────────────────────────
  snapshot
    .command("list")
    .description("List all snapshots")
    .option("--json", "JSON output")
    .action(() => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);

      respond({
        data: { snapshots: index.snapshots },
        ui: {
          type: "info",
          title: "Drive Snapshots",
          body: index.snapshots.length === 0
            ? "No snapshots found."
            : index.snapshots
                .map((s, i) => `  ${i + 1}. ${s.root.slice(0, 20)}... (${s.entryCount} entries, ${s.createdAt})`)
                .join("\n"),
        },
      });
    });

  // ── drive snapshot restore ────────────────────────────────
  snapshot
    .command("restore")
    .description("Restore the drive index from a snapshot")
    .requiredOption("--root <hash>", "Snapshot root hash")
    .option("--force", "Required: confirm restore (overwrites current index)")
    .option("--json", "JSON output")
    .action(async (opts: { root: string; force?: boolean }) => {
      if (!opts.force) {
        if (isHeadless()) {
          throw new EchoError(
            ErrorCodes.CONFIRMATION_REQUIRED,
            "Snapshot restore requires --force flag in headless mode.",
            "This will overwrite the current drive index."
          );
        }
        throw new EchoError(
          ErrorCodes.CONFIRMATION_REQUIRED,
          "Snapshot restore requires --force flag.",
          "This will overwrite the current drive index. Use --force to confirm."
        );
      }

      const wallet = requireWallet();
      const currentIndex = loadDriveIndex(wallet);

      // Backup current index as snapshot before overwrite
      const s = spinner("Backing up current index...");
      s.start();

      let backedUpRoot: string | undefined;
      const currentEntryCount = Object.keys(currentIndex.entries).length;

      if (currentEntryCount > 0) {
        const tmpDir = mkdtempSync(join(tmpdir(), "echo-drive-backup-"));
        const tmpFile = join(tmpDir, "drive-index.json");

        try {
          writeFileSync(tmpFile, serializeIndex(currentIndex), "utf-8");
          const config = getStorageClientConfig();
          const backupResult = await uploadFile(config, tmpFile);
          backedUpRoot = backupResult.root;
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }

      s.text = "Downloading snapshot...";
      const tmpDir2 = mkdtempSync(join(tmpdir(), "echo-drive-restore-"));
      const tmpFile2 = join(tmpDir2, "drive-index.json");

      try {
        const config = getStorageClientConfig();
        await downloadFile(config, opts.root, tmpFile2);

        const raw = readFileSync(tmpFile2, "utf-8");
        const restored = deserializeIndex(raw);

        // Preserve snapshots from current index + add backup, deduplicate by root
        if (backedUpRoot) {
          addSnapshot(currentIndex, backedUpRoot);
          const seen = new Set<string>();
          restored.snapshots = [...restored.snapshots, ...currentIndex.snapshots]
            .filter(s => { if (seen.has(s.root)) return false; seen.add(s.root); return true; });
        }

        restored.wallet = wallet;
        saveDriveIndex(restored);

        s.succeed("Index restored");

        const restoredEntryCount = Object.keys(restored.entries).length;
        respond({
          data: { root: opts.root, entryCount: restoredEntryCount, backedUp: backedUpRoot },
          ui: {
            type: "success",
            title: "Drive Restored",
            body:
              `Snapshot: ${colors.info(opts.root)}\n` +
              `Entries: ${restoredEntryCount}\n` +
              (backedUpRoot ? `Previous index backed up: ${colors.info(backedUpRoot)}` : ""),
          },
        });
      } finally {
        rmSync(tmpDir2, { recursive: true, force: true });
      }
    });

  drive.addCommand(snapshot);
}
