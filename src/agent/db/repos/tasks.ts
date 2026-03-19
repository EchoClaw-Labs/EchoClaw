/**
 * Scheduled tasks repo — cron jobs created by agent.
 */

import { query, queryOne, execute } from "../client.js";

export interface ScheduledTask {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  taskType: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  loopMode: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastResult: Record<string, unknown> | null;
  createdAt: string;
}

export async function createTask(task: {
  id: string; name: string; description?: string; cronExpression: string;
  taskType: string; payload: Record<string, unknown>; loopMode?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO scheduled_tasks (id, name, description, cron_expression, task_type, payload, loop_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [task.id, task.name, task.description ?? null, task.cronExpression, task.taskType, JSON.stringify(task.payload), task.loopMode ?? "restricted"],
  );
}

export async function listTasks(): Promise<ScheduledTask[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM scheduled_tasks ORDER BY created_at");
  return rows.map(rowToTask);
}

export async function getEnabledTasks(): Promise<ScheduledTask[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM scheduled_tasks WHERE enabled = TRUE ORDER BY created_at");
  return rows.map(rowToTask);
}

export async function toggleTask(id: string, enabled: boolean): Promise<boolean> {
  const n = await execute("UPDATE scheduled_tasks SET enabled = $2 WHERE id = $1", [id, enabled]);
  return n > 0;
}

export async function deleteTask(id: string): Promise<boolean> {
  const n = await execute("DELETE FROM scheduled_tasks WHERE id = $1", [id]);
  return n > 0;
}

export async function recordRun(id: string, result: Record<string, unknown>): Promise<void> {
  await execute(
    "UPDATE scheduled_tasks SET last_run_at = NOW(), run_count = run_count + 1, last_result = $2 WHERE id = $1",
    [id, JSON.stringify(result)],
  );
}

function rowToTask(r: Record<string, unknown>): ScheduledTask {
  return {
    id: r.id as string, name: r.name as string, description: r.description as string | null,
    cronExpression: r.cron_expression as string, taskType: r.task_type as string,
    payload: r.payload as Record<string, unknown>, enabled: r.enabled as boolean,
    loopMode: r.loop_mode as string, lastRunAt: r.last_run_at as string | null,
    nextRunAt: r.next_run_at as string | null, runCount: r.run_count as number,
    lastResult: r.last_result as Record<string, unknown> | null, createdAt: r.created_at as string,
  };
}
