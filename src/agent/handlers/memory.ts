/**
 * Memory and file handlers (Postgres-backed).
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as soulRepo from "../db/repos/soul.js";
import * as memoryRepo from "../db/repos/memory.js";
import * as knowledgeRepo from "../db/repos/knowledge.js";
import * as sessionsRepo from "../db/repos/sessions.js";
import * as messagesRepo from "../db/repos/messages.js";
import * as skillsRepo from "../db/repos/skills.js";

export function registerMemoryRoutes(): void {
  registerRoute("GET", "/api/agent/memory/soul", async (_req, res) => {
    const soul = await soulRepo.getSoul();
    jsonResponse(res, 200, { content: soul?.content ?? null, exists: !!soul?.content });
  });

  registerRoute("PUT", "/api/agent/memory/soul", async (_req, res, params) => {
    const content = params.body?.content as string | undefined;
    if (!content || typeof content !== "string") {
      errorResponse(res, 400, "INVALID_CONTENT", "content is required (string)");
      return;
    }
    await soulRepo.upsertSoul(content);
    jsonResponse(res, 200, { updated: true });
  });

  registerRoute("GET", "/api/agent/memory/core", async (_req, res) => {
    const content = await memoryRepo.getMemoryAsText();
    jsonResponse(res, 200, { content });
  });

  registerRoute("GET", "/api/agent/files", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const path = url.searchParams.get("path") ?? "";
    const entries = await knowledgeRepo.listFiles(path);
    jsonResponse(res, 200, { path, entries });
  });

  registerRoute("GET", "/api/agent/file", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const path = url.searchParams.get("path");
    if (!path) { errorResponse(res, 400, "MISSING_PATH", "path query parameter required"); return; }
    const content = await knowledgeRepo.getFile(path);
    if (content === null) { errorResponse(res, 404, "FILE_NOT_FOUND", `File not found: ${path}`); return; }
    jsonResponse(res, 200, { path, content });
  });

  registerRoute("GET", "/api/agent/sessions", async (_req, res) => {
    const rawSessions = await sessionsRepo.listSessions();
    // Transform to camelCase DTO matching UI SessionListEntry type
    const sessions = rawSessions.map(s => ({
      id: s.id,
      startedAt: s.started_at,
      sizeBytes: (s.message_count ?? 0) * 200, // estimated bytes per message
    }));
    jsonResponse(res, 200, { sessions });
  });

  registerRoute("GET", "/api/agent/session/:id", async (_req, res, params) => {
    const id = params.pathParams.id;
    const messages = await messagesRepo.getSessionMessages(id);
    if (messages.length === 0) { errorResponse(res, 404, "SESSION_NOT_FOUND", `Session not found: ${id}`); return; }
    jsonResponse(res, 200, { id, messages });
  });

  // Packaged skill references (read-only, seeded from echoclaw package)
  registerRoute("GET", "/api/agent/skills", async (_req, res) => {
    const refs = await skillsRepo.listSkillReferences();
    jsonResponse(res, 200, { references: refs, count: refs.length });
  });

  registerRoute("GET", "/api/agent/skill", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const path = url.searchParams.get("path");
    if (!path) { errorResponse(res, 400, "MISSING_PATH", "path query parameter required"); return; }
    const content = await skillsRepo.getSkillReference(path);
    if (!content) { errorResponse(res, 404, "SKILL_NOT_FOUND", `Skill reference not found: ${path}`); return; }
    jsonResponse(res, 200, { path, content });
  });
}
