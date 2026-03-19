import { query, queryOne, execute } from "../client.js";

interface SessionRow { id: string; started_at: string; ended_at: string | null; summary: string | null; compacted: boolean; message_count: number; token_count: number }

export async function createSession(id: string): Promise<void> {
  await execute("INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
}

export async function listSessions(limit = 50): Promise<SessionRow[]> {
  return query<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1", [limit]);
}

export async function updateSessionTokenCount(id: string, tokenCount: number): Promise<void> {
  await execute("UPDATE sessions SET token_count = $2 WHERE id = $1", [id, tokenCount]);
}

export async function compactSession(id: string, summary: string): Promise<void> {
  await execute("UPDATE sessions SET compacted = TRUE, summary = $2, ended_at = NOW() WHERE id = $1", [id, summary]);
}
