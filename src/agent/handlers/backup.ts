/**
 * Backup / restore handlers — 0G Storage integration.
 *
 * POST /api/agent/backup  — export DB → temp files → 0g-storage drive put → snapshot → root hash
 * POST /api/agent/restore — snapshot restore → re-import DB
 * GET  /api/agent/backups  — list backup history
 */

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as soulRepo from "../db/repos/soul.js";
import * as memoryRepo from "../db/repos/memory.js";
import * as knowledgeRepo from "../db/repos/knowledge.js";
import * as tradesRepo from "../db/repos/trades.js";
import * as backupRepo from "../db/repos/backup.js";
import type { TradeEntry } from "../types.js";
import logger from "../../utils/logger.js";

/** Run echoclaw CLI command, return parsed JSON output. */
function runCli(args: string[], timeoutMs = 120_000): Promise<{ success: boolean; output: unknown; error?: string }> {
  return new Promise((resolve) => {
    execFile("echoclaw", [...args, "--json"], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, output: null, error: stderr.trim() || err.message });
        return;
      }
      try {
        resolve({ success: true, output: JSON.parse(stdout.trim()) });
      } catch {
        resolve({ success: true, output: stdout.trim().slice(0, 2000) });
      }
    });
  });
}

interface ExportedFile {
  path: string;
  virtualPath: string;
  sizeBytes: number;
}

/** Export agent DB data to temp directory. */
async function exportToFiles(dir: string): Promise<ExportedFile[]> {
  const files: ExportedFile[] = [];

  // Soul
  const soul = await soulRepo.getSoul();
  if (soul) {
    const p = join(dir, "soul.md");
    writeFileSync(p, soul.content, "utf-8");
    files.push({ path: p, virtualPath: "/agent/soul.md", sizeBytes: Buffer.byteLength(soul.content) });
  }

  // Memory
  const memory = await memoryRepo.getMemoryAsText();
  if (memory) {
    const p = join(dir, "memory.md");
    writeFileSync(p, memory, "utf-8");
    files.push({ path: p, virtualPath: "/agent/memory.md", sizeBytes: Buffer.byteLength(memory) });
  }

  // Knowledge files
  const knowledgeList = await knowledgeRepo.listFiles("");
  const knowledgeExport: Array<{ path: string; content: string }> = [];
  for (const entry of knowledgeList) {
    if (entry.type === "file") {
      const content = await knowledgeRepo.getFile(entry.path);
      if (content) knowledgeExport.push({ path: entry.path, content });
    }
  }
  if (knowledgeExport.length > 0) {
    const json = JSON.stringify(knowledgeExport, null, 2);
    const p = join(dir, "knowledge.json");
    writeFileSync(p, json, "utf-8");
    files.push({ path: p, virtualPath: "/agent/knowledge.json", sizeBytes: Buffer.byteLength(json) });
  }

  // Trades
  const { trades } = await tradesRepo.getTrades(undefined, 10000, 0);
  if (trades.length > 0) {
    const json = JSON.stringify(trades, null, 2);
    const p = join(dir, "trades.json");
    writeFileSync(p, json, "utf-8");
    files.push({ path: p, virtualPath: "/agent/trades.json", sizeBytes: Buffer.byteLength(json) });
  }

  // Memory entries (raw, for full restore)
  const memoryEntries = await memoryRepo.getMemoryEntries(10000);
  if (memoryEntries.length > 0) {
    const json = JSON.stringify(memoryEntries, null, 2);
    const p = join(dir, "memory-entries.json");
    writeFileSync(p, json, "utf-8");
    files.push({ path: p, virtualPath: "/agent/memory-entries.json", sizeBytes: Buffer.byteLength(json) });
  }

  return files;
}

export function registerBackupRoutes(): void {
  // ── POST /api/agent/backup ────────────────────────────────────────
  registerRoute("POST", "/api/agent/backup", async (_req, res) => {
    const triggerType = "manual";
    const dir = join(tmpdir(), `echo-agent-backup-${Date.now()}`);

    try {
      mkdirSync(dir, { recursive: true });

      // 1. Export DB data to temp files
      const files = await exportToFiles(dir);
      if (files.length === 0) {
        errorResponse(res, 400, "NOTHING_TO_BACKUP", "No agent data to backup");
        return;
      }

      // 2. Upload each file to 0g-storage drive
      const uploadResults: Array<{ virtualPath: string; success: boolean }> = [];
      for (const f of files) {
        const result = await runCli(["0g-storage", "drive", "put", "--file", f.path, "--path", f.virtualPath, "--force"]);
        uploadResults.push({ virtualPath: f.virtualPath, success: result.success });
        if (!result.success) {
          logger.warn("backup.upload.failed", { virtualPath: f.virtualPath, error: result.error });
        }
      }

      const successCount = uploadResults.filter(r => r.success).length;
      if (successCount === 0) {
        errorResponse(res, 500, "UPLOAD_FAILED", "All file uploads to 0G Storage failed");
        return;
      }

      // 3. Create drive snapshot → root hash
      const snapshotResult = await runCli(["0g-storage", "drive", "snapshot"], 180_000);
      if (!snapshotResult.success) {
        errorResponse(res, 500, "SNAPSHOT_FAILED", `Drive snapshot failed: ${snapshotResult.error}`);
        return;
      }

      const snapshotData = snapshotResult.output as Record<string, unknown>;
      const rootHash = (snapshotData.root ?? snapshotData.rootHash ?? "") as string;

      if (!rootHash) {
        errorResponse(res, 500, "NO_ROOT_HASH", "Snapshot succeeded but no root hash returned");
        return;
      }

      // 4. Record in backup_log
      const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
      const entry = await backupRepo.recordBackup(rootHash, files.length, totalSize, triggerType);

      logger.info("backup.completed", { rootHash: rootHash.slice(0, 16), fileCount: files.length, totalSizeBytes: totalSize });

      jsonResponse(res, 200, {
        success: true,
        backup: entry,
        files: uploadResults,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("backup.failed", { error: msg });
      errorResponse(res, 500, "BACKUP_ERROR", msg);
    } finally {
      // Cleanup temp dir
      if (existsSync(dir)) {
        try { rmSync(dir, { recursive: true }); } catch { /* */ }
      }
    }
  });

  // ── POST /api/agent/restore ───────────────────────────────────────
  registerRoute("POST", "/api/agent/restore", async (_req, res, params) => {
    const rootHash = params.body?.root as string | undefined;
    if (!rootHash || typeof rootHash !== "string" || !rootHash.startsWith("0x")) {
      errorResponse(res, 400, "INVALID_ROOT", "root is required (0x-prefixed hash)");
      return;
    }

    const dir = join(tmpdir(), `echo-agent-restore-${Date.now()}`);

    try {
      mkdirSync(dir, { recursive: true });

      // 1. Restore drive index from snapshot
      const snapshotResult = await runCli(["0g-storage", "drive", "snapshot", "restore", "--root", rootHash, "--force"], 180_000);
      if (!snapshotResult.success) {
        errorResponse(res, 500, "RESTORE_FAILED", `Snapshot restore failed: ${snapshotResult.error}`);
        return;
      }

      // 2. Download agent files from drive
      const agentFiles = [
        { vpath: "/agent/soul.md", local: "soul.md" },
        { vpath: "/agent/memory-entries.json", local: "memory-entries.json" },
        { vpath: "/agent/knowledge.json", local: "knowledge.json" },
        { vpath: "/agent/trades.json", local: "trades.json" },
      ];

      const restored: string[] = [];

      for (const f of agentFiles) {
        const outPath = join(dir, f.local);
        const result = await runCli(["0g-storage", "drive", "get", "--path", f.vpath, "--out", outPath]);
        if (!result.success) {
          logger.warn("backup.restore.download_failed", { virtualPath: f.vpath, error: result.error });
          continue;
        }
        if (!existsSync(outPath)) continue;

        // 3. Re-import to DB
        try {
          const content = readFileSync(outPath, "utf-8");

          if (f.local === "soul.md" && content.trim()) {
            await soulRepo.upsertSoul(content);
            restored.push("soul");
          } else if (f.local === "memory-entries.json") {
            const entries = JSON.parse(content) as Array<{ content: string; category?: string; source?: string }>;
            for (const e of entries) {
              await memoryRepo.appendMemory(e.content, e.category, e.source ?? "restore");
            }
            restored.push(`memory (${entries.length} entries)`);
          } else if (f.local === "knowledge.json") {
            const files = JSON.parse(content) as Array<{ path: string; content: string }>;
            for (const kf of files) {
              await knowledgeRepo.upsertFile(kf.path, kf.content);
            }
            restored.push(`knowledge (${files.length} files)`);
          } else if (f.local === "trades.json") {
            const trades = JSON.parse(content) as TradeEntry[];
            for (const t of trades) {
              await tradesRepo.addTrade(t);
            }
            restored.push(`trades (${trades.length} entries)`);
          }
        } catch (parseErr) {
          logger.warn("backup.restore.import_failed", { file: f.local, error: parseErr instanceof Error ? parseErr.message : String(parseErr) });
        }
      }

      logger.info("backup.restore.completed", { rootHash: rootHash.slice(0, 16), restored });

      jsonResponse(res, 200, {
        success: true,
        root: rootHash,
        restored,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("backup.restore.failed", { error: msg });
      errorResponse(res, 500, "RESTORE_ERROR", msg);
    } finally {
      if (existsSync(dir)) {
        try { rmSync(dir, { recursive: true }); } catch { /* */ }
      }
    }
  });

  // ── GET /api/agent/backups ────────────────────────────────────────
  registerRoute("GET", "/api/agent/backups", async (_req, res) => {
    const backups = await backupRepo.listBackups(50);
    jsonResponse(res, 200, { backups, count: backups.length });
  });
}
