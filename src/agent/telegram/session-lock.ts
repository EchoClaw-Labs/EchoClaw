/**
 * Shared per-session mutex for Telegram message handling and approval resume.
 *
 * Kept in a standalone module to avoid circular dependencies between bridge
 * and approval-handler while still serializing work per session.
 */

const sessionLocks = new Map<string, Promise<void>>();

/** Serialize concurrent operations on the same session. */
export async function withSessionLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(sessionId, next);
  try {
    await next;
  } finally {
    if (sessionLocks.get(sessionId) === next) {
      sessionLocks.delete(sessionId);
    }
  }
}
