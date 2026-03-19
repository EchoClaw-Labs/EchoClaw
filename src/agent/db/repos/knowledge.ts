import { query, queryOne, execute } from "../client.js";

interface KnowledgeRow { path: string; content: string; size_bytes: number; updated_at: string }

export async function getFile(path: string): Promise<string | null> {
  const row = await queryOne<KnowledgeRow>("SELECT content FROM knowledge_files WHERE path = $1", [path]);
  return row?.content ?? null;
}

export async function upsertFile(path: string, content: string): Promise<void> {
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  await execute(
    `INSERT INTO knowledge_files (path, content, size_bytes) VALUES ($1, $2, $3)
     ON CONFLICT (path) DO UPDATE SET content = $2, size_bytes = $3, updated_at = NOW()`,
    [path, content, sizeBytes],
  );
}

export async function deleteFile(path: string): Promise<boolean> {
  const affected = await execute("DELETE FROM knowledge_files WHERE path = $1", [path]);
  return affected > 0;
}

export async function listFiles(prefix = ""): Promise<Array<{ name: string; type: "file" | "dir"; path: string; sizeBytes: number }>> {
  const likePattern = prefix ? `${prefix}%` : "%";
  const rows = await query<KnowledgeRow>("SELECT path, size_bytes, updated_at FROM knowledge_files WHERE path LIKE $1 ORDER BY path", [likePattern]);

  // Build flat file list (dirs derived from paths)
  const dirs = new Set<string>();
  const files: Array<{ name: string; type: "file" | "dir"; path: string; sizeBytes: number }> = [];

  for (const r of rows) {
    const rel = prefix ? r.path.slice(prefix.length).replace(/^\//, "") : r.path;
    const slashIdx = rel.indexOf("/");
    if (slashIdx > 0) {
      const dirName = rel.slice(0, slashIdx);
      if (!dirs.has(dirName)) {
        dirs.add(dirName);
        files.push({ name: dirName, type: "dir", path: prefix ? `${prefix}/${dirName}` : dirName, sizeBytes: 0 });
      }
    } else {
      files.push({ name: rel, type: "file", path: r.path, sizeBytes: r.size_bytes });
    }
  }
  return files;
}

export async function fileCount(): Promise<number> {
  const row = await queryOne<{ c: string }>("SELECT COUNT(*) AS c FROM knowledge_files");
  return parseInt(row?.c ?? "0", 10);
}
