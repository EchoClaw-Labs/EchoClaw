import { query, execute } from "../client.js";
import type { Message } from "../../types.js";

interface MessageRow { id: number; session_id: string; role: string; content: string; tool_call_id: string | null; tool_calls: unknown; created_at: string }

export async function addMessage(sessionId: string, msg: Message): Promise<void> {
  await execute(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, msg.role, msg.content, msg.toolCallId ?? null, msg.toolCalls ? JSON.stringify(msg.toolCalls) : null, msg.timestamp],
  );
  // Increment session message count
  await execute("UPDATE sessions SET message_count = message_count + 1 WHERE id = $1", [sessionId]);
}

export async function getSessionMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: r.created_at,
  }));
}

export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const rows = await query<{ count: string }>("SELECT COUNT(*) AS count FROM messages WHERE session_id = $1", [sessionId]);
  return parseInt(rows[0]?.count ?? "0", 10);
}
