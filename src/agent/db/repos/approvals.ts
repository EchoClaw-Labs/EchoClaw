import { query, queryOne, execute } from "../client.js";
import type { ApprovalItem, ToolCall } from "../../types.js";

export async function enqueue(
  id: string, toolCall: ToolCall, reasoning: string, sessionId: string, toolCallId?: string,
): Promise<void> {
  const pendingContext = toolCallId ? JSON.stringify({ toolCallId }) : null;
  await execute(
    `INSERT INTO approval_queue (id, tool_call, reasoning, status, session_id, pending_context) VALUES ($1, $2, $3, 'pending', $4, $5)`,
    [id, JSON.stringify(toolCall), reasoning, sessionId, pendingContext],
  );
}

export async function approve(id: string): Promise<(ApprovalItem & { toolCallId?: string; sessionId?: string }) | null> {
  // Atomic transition: only returns the row if it was actually pending → approved.
  // Prevents double-execution on duplicate clicks or replayed requests.
  const row = await queryOne<Record<string, unknown>>(
    "UPDATE approval_queue SET status = 'approved', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id],
  );
  if (!row) return null;
  const item = rowToItem(row);
  const ctx = row.pending_context as Record<string, unknown> | null;
  return { ...item, toolCallId: ctx?.toolCallId as string | undefined, sessionId: row.session_id as string | undefined };
}

export async function reject(id: string): Promise<ApprovalItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    "UPDATE approval_queue SET status = 'rejected', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id],
  );
  if (!row) return null;
  return rowToItem(row);
}

export async function getPending(): Promise<ApprovalItem[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at");
  return rows.map(rowToItem);
}

export async function getPendingCount(): Promise<number> {
  const r = await queryOne<{ c: string }>("SELECT COUNT(*) AS c FROM approval_queue WHERE status = 'pending'");
  return parseInt(r?.c ?? "0", 10);
}

async function getItem(id: string): Promise<ApprovalItem | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM approval_queue WHERE id = $1", [id]);
  return row ? rowToItem(row) : null;
}

function rowToItem(r: Record<string, unknown>): ApprovalItem {
  return {
    id: r.id as string, toolCall: r.tool_call as ToolCall, reasoning: r.reasoning as string,
    estimatedCost: r.estimated_cost as string | null, status: r.status as ApprovalItem["status"],
    createdAt: r.created_at as string, resolvedAt: r.resolved_at as string | null,
  };
}
