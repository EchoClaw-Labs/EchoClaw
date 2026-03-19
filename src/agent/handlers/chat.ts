/**
 * Chat handler — POST /api/agent/chat -> SSE stream.
 *
 * Session-per-request: client sends sessionId (or gets a new one).
 * No global activeSession — each request loads/creates its own.
 */

import { registerRoute, errorResponse } from "../routes.js";
import { processMessage, createSession } from "../engine.js";
import { hydrateSession } from "../session-hydrate.js";
import { parseChatRequest, RequestValidationError } from "../validation.js";
import type { AgentEvent } from "../types.js";
import logger from "../../utils/logger.js";

function sseEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function registerChatRoutes(): void {
  registerRoute("POST", "/api/agent/chat", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseChatRequest>;
    try {
      parsed = parseChatRequest(params.body);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { message, loopMode, sessionId: requestSessionId } = parsed;
    const session = await hydrateSession(requestSessionId) ?? createSession();
    if (!session) {
      errorResponse(res, 503, "NOT_READY", "Agent not initialized — compute not configured");
      return;
    }

    // SSE stream
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let aborted = false;
    _req.on("close", () => { aborted = true; });

    const emit = (event: AgentEvent) => {
      if (!aborted && !res.writableEnded) res.write(sseEvent(event));
    };

    // Emit sessionId so client can reuse it
    emit({ type: "status", data: { type: "session", sessionId: session.id } });

    try {
      await processMessage(session, message, emit, loopMode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[agent] chat error: ${msg}`);
      if (!aborted && !res.writableEnded) {
        emit({ type: "error", data: { message: msg } });
        emit({ type: "done", data: {} });
      }
    }

    if (!res.writableEnded) res.end();
  });
}
