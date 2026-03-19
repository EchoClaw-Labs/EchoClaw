/**
 * Scheduled tasks handlers.
 *
 * GET /api/agent/tasks — list all tasks
 * POST /api/agent/tasks/:id/toggle — enable/disable
 * DELETE /api/agent/tasks/:id — remove task
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as tasksRepo from "../db/repos/tasks.js";
import { toggleTask, removeTask } from "../scheduler.js";
import { parseToggleTaskRequest, RequestValidationError } from "../validation.js";

export function registerTasksRoutes(): void {
  registerRoute("GET", "/api/agent/tasks", async (_req, res) => {
    const tasks = await tasksRepo.listTasks();
    jsonResponse(res, 200, { tasks, count: tasks.length });
  });

  registerRoute("POST", "/api/agent/tasks/:id/toggle", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseToggleTaskRequest>;
    try {
      parsed = parseToggleTaskRequest(params.body, params.pathParams);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { id, enabled } = parsed;
    const ok = await toggleTask(id, enabled);
    if (!ok) { errorResponse(res, 404, "NOT_FOUND", `Task not found: ${id}`); return; }
    jsonResponse(res, 200, { id, enabled });
  });

  registerRoute("DELETE", "/api/agent/tasks/:id", async (_req, res, params) => {
    const id = params.pathParams.id;
    if (id === "builtin-portfolio-snapshot") {
      errorResponse(res, 400, "BUILTIN_TASK", "Cannot delete built-in portfolio snapshot task. Disable it instead.");
      return;
    }
    const ok = await removeTask(id);
    if (!ok) { errorResponse(res, 404, "NOT_FOUND", `Task not found: ${id}`); return; }
    jsonResponse(res, 200, { id, deleted: true });
  });
}
