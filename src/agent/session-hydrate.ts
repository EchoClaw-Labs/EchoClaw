/**
 * Session hydration — shared helper for chat and approval handlers.
 *
 * Loads a session from DB, rebuilds loadedKnowledge from message history,
 * seeds hybrid compaction snapshot, and rejects compacted sessions.
 *
 * Consolidates duplicate logic from:
 *   - handlers/chat.ts getOrCreateSession()
 *   - handlers/approve.ts loadSessionFromDB()
 */

import { createSession } from "./engine.js";
import type { ConversationSession } from "./types.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as knowledgeRepo from "./db/repos/knowledge.js";
import * as skillsRepo from "./db/repos/skills.js";

/**
 * Hydrate a session from DB by ID.
 *
 * Returns null if:
 * - sessionId not provided
 * - session not found in DB
 * - session is compacted (client should start a new one)
 * - engine not initialized (no inference config)
 */
export async function hydrateSession(sessionId?: string): Promise<ConversationSession | null> {
  if (!sessionId) return null;

  const session = createSession();
  if (!session) return null;

  const existing = await sessionsRepo.getSession(sessionId);
  if (!existing) return null;

  // Compacted sessions cannot be resumed — force new session
  if (existing.compacted) return null;

  session.id = sessionId;
  session.messages = await messagesRepo.getSessionMessages(sessionId);

  // Seed hybrid compaction snapshot from DB (same as approve.ts:29)
  if (existing.token_count > 0) {
    session.lastPromptTokens = existing.token_count;
    session.messageCountAtSnapshot = session.messages.length;
  }

  // Rebuild loadedKnowledge from file_read tool calls in message history
  await rebuildLoadedKnowledge(session);

  return session;
}

/**
 * Scan message history for file_read tool calls and reload their content
 * from the knowledge DB. Restores context that was loaded in previous turns.
 */
async function rebuildLoadedKnowledge(session: ConversationSession): Promise<void> {
  for (const msg of session.messages) {
    if (!msg.toolCalls) continue;
    for (const tc of msg.toolCalls) {
      if (tc.command === "file_read" && tc.args.path) {
        const path = String(tc.args.path);
        if (session.loadedKnowledge.has(path)) continue;
        const content = await knowledgeRepo.getFile(path) ?? await skillsRepo.getSkillReference(path);
        if (content) session.loadedKnowledge.set(path, content);
      }
    }
  }
}
