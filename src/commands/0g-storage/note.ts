import { Command } from "commander";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
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
  driveLs,
  driveMkdir,
} from "../../0g-storage/drive-index.js";

export function createNoteCommand(): Command {
  const note = new Command("note")
    .description("Durable agent notepad stored on 0G Storage");

  // ── note put ──────────────────────────────────────────────
  note
    .command("put")
    .description("Create or update a note")
    .requiredOption("--title <t>", "Note title")
    .requiredOption("--body <text>", "Note body (text or markdown)")
    .option("--json", "JSON output")
    .action(async (opts: { title: string; body: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);

      // Ensure /notes/ dir exists
      driveMkdir(index, "/notes");

      const noteId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
      const vpath = `/notes/${noteId}.md`;

      const s = spinner("Uploading note...");
      s.start();

      const content = `# ${opts.title}\n\n${opts.body}\n`;

      const tmpDir = mkdtempSync(join(tmpdir(), "echo-note-"));
      const tmpFile = join(tmpDir, `${noteId}.md`);

      try {
        writeFileSync(tmpFile, content, "utf-8");
        const config = getStorageClientConfig();
        const result = await uploadFile(config, tmpFile);

        drivePut(index, vpath, {
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

        s.succeed("Note saved");

        respond({
          data: { noteId, title: opts.title, createdAt: result.uploadedAt, cost: result.cost },
          ui: {
            type: "success",
            title: "Note Saved",
            body: `ID: ${noteId}\nTitle: ${opts.title}\nCost: ${formatCostDisplay(result.cost)}`,
          },
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  // ── note get ──────────────────────────────────────────────
  note
    .command("get")
    .description("Retrieve a note by ID")
    .requiredOption("--id <id>", "Note ID")
    .option("--json", "JSON output")
    .action(async (opts: { id: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const vpath = `/notes/${opts.id}.md`;
      const entry = driveGet(index, vpath);

      if (entry.type !== "file") {
        throw new EchoError(ErrorCodes.ZG_STORAGE_INDEX_NOT_FOUND, `Note not found: ${opts.id}`);
      }

      const s = spinner("Downloading note...");
      s.start();

      const tmpDir = mkdtempSync(join(tmpdir(), "echo-note-get-"));
      const tmpFile = join(tmpDir, `${opts.id}.md`);

      try {
        const config = getStorageClientConfig();
        await downloadFile(config, entry.root, tmpFile);
        const body = readFileSync(tmpFile, "utf-8");

        // Extract title from first # line
        const firstLine = body.split("\n")[0] ?? "";
        const title = firstLine.startsWith("# ") ? firstLine.slice(2).trim() : opts.id;

        s.succeed("Note retrieved");

        respond({
          data: { noteId: opts.id, title, body, createdAt: entry.uploadedAt },
          ui: {
            type: "info",
            title: `Note: ${title}`,
            body,
          },
        });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  // ── note list ─────────────────────────────────────────────
  note
    .command("list")
    .description("List all notes")
    .option("--limit <n>", "Max notes to show", "50")
    .option("--json", "JSON output")
    .action((opts: { limit: string }) => {
      const wallet = requireWallet();
      const index = loadDriveIndex(wallet);
      const entries = driveLs(index, "/notes", false);
      const limit = parseInt(opts.limit, 10) || 50;

      const notes = entries
        .filter((e) => e.type === "file" && e.name.endsWith(".md"))
        .slice(0, limit)
        .map((e) => {
          const vpath = `/notes/${e.name}`;
          const entry = index.entries[vpath];
          const uploadedAt = entry && entry.type === "file" ? entry.uploadedAt : undefined;
          return {
            noteId: e.name.replace(/\.md$/, ""),
            name: e.name,
            size: e.size,
            uploadedAt,
          };
        });

      respond({
        data: { notes, count: notes.length },
        ui: {
          type: "info",
          title: "Notes",
          body: notes.length === 0
            ? "No notes found. Create one with: echoclaw 0g-storage note put --title <t> --body <text>"
            : notes.map((n) => `  ${n.noteId}${n.size ? ` (${n.size} bytes)` : ""}`).join("\n"),
        },
      });
    });

  return note;
}
