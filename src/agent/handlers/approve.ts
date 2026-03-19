/**
 * Approval queue handlers (DB-backed, session reconstructed from DB).
 *
 * After restart, pending approvals can still be executed because
 * session is loaded from DB messages, not from in-memory state.
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as approvalsRepo from "../db/repos/approvals.js";
import { resumeAfterApproval, createSession } from "../engine.js";
import { hydrateSession } from "../session-hydrate.js";
import { parseApproveRequest, RequestValidationError } from "../validation.js";
import type { AgentEvent } from "../types.js";
import logger from "../../utils/logger.js";

export function registerApproveRoutes(): void {
  registerRoute("GET", "/api/agent/queue", async (_req, res) => {
    const items = await approvalsRepo.getPending();
    jsonResponse(res, 200, { items, count: items.length });
  });

  registerRoute("POST", "/api/agent/approve/:id", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseApproveRequest>;
    try {
      parsed = parseApproveRequest(params.body, params.pathParams);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { id, action } = parsed;

    if (action === "reject") {
      const item = await approvalsRepo.reject(id);
      if (!item) { errorResponse(res, 404, "NOT_FOUND", `No pending approval: ${id}`); return; }
      jsonResponse(res, 200, { id, status: "rejected" });
      return;
    }

    const item = await approvalsRepo.approve(id);
    if (!item) { errorResponse(res, 404, "NOT_FOUND", `No pending approval: ${id}`); return; }

    // Reconstruct session from DB (works after restart)
    const sessionId = (item as unknown as { sessionId?: string }).sessionId;
    const session = (sessionId ? await hydrateSession(sessionId) : null) ?? createSession();

    if (!session) {
      errorResponse(res, 503, "NOT_READY", "Agent not initialized");
      return;
    }

    // SSE resume
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });

    let aborted = false;
    _req.on("close", () => { aborted = true; });

    const emit = (event: AgentEvent) => {
      if (!aborted && !res.writableEnded) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    };

    try {
      await resumeAfterApproval(session, item.toolCall, emit, "restricted", item.toolCallId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[agent] resume error: ${msg}`);
      if (!aborted && !res.writableEnded) { emit({ type: "error", data: { message: msg } }); emit({ type: "done", data: {} }); }
    }

    if (!res.writableEnded) res.end();
  });
}
