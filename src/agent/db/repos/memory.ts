import { query, execute } from "../client.js";

interface MemoryRow { id: number; content: string; category: string | null; source: string | null; created_at: string }

export async function appendMemory(content: string, category?: string, source = "agent"): Promise<void> {
  await execute(
    "INSERT INTO memory_entries (content, category, source) VALUES ($1, $2, $3)",
    [content, category ?? null, source],
  );
}

export async function getMemoryEntries(limit = 200): Promise<MemoryRow[]> {
  return query<MemoryRow>(
    "SELECT id, content, category, source, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
}

/** Concatenate all memory entries into a single text block (replaces memory.md). */
export async function getMemoryAsText(): Promise<string> {
  const entries = await getMemoryEntries(500);
  if (entries.length === 0) return "";
  return entries.map(e => e.content).join("\n\n");
}

export async function getMemorySize(): Promise<number> {
  const text = await getMemoryAsText();
  return Buffer.byteLength(text, "utf-8");
}
