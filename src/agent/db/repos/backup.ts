import { query, queryOne, execute } from "../client.js";

export interface BackupEntry {
  id: number;
  rootHash: string;
  fileCount: number;
  sizeBytes: number;
  trigger: string;
  createdAt: string;
}

interface BackupRow {
  id: number;
  root_hash: string;
  file_count: number;
  size_bytes: string;
  trigger: string;
  created_at: string;
}

function rowToEntry(r: BackupRow): BackupEntry {
  return {
    id: r.id,
    rootHash: r.root_hash,
    fileCount: r.file_count,
    sizeBytes: parseInt(String(r.size_bytes), 10),
    trigger: r.trigger,
    createdAt: r.created_at,
  };
}

export async function recordBackup(rootHash: string, fileCount: number, sizeBytes: number, trigger: string): Promise<BackupEntry> {
  const row = await queryOne<BackupRow>(
    "INSERT INTO backup_log (root_hash, file_count, size_bytes, trigger) VALUES ($1, $2, $3, $4) RETURNING *",
    [rootHash, fileCount, sizeBytes, trigger],
  );
  return rowToEntry(row!);
}

export async function getLastBackup(): Promise<BackupEntry | null> {
  const row = await queryOne<BackupRow>("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 1");
  return row ? rowToEntry(row) : null;
}

export async function listBackups(limit = 20): Promise<BackupEntry[]> {
  const rows = await query<BackupRow>("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(rowToEntry);
}

export async function getBackupByRoot(rootHash: string): Promise<BackupEntry | null> {
  const row = await queryOne<BackupRow>("SELECT * FROM backup_log WHERE root_hash = $1", [rootHash]);
  return row ? rowToEntry(row) : null;
}
