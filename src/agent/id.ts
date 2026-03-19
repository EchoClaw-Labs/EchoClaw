/**
 * Unified ID generator for Echo Agent.
 *
 * All identifiers (sessions, tool calls, approvals, tasks, trades)
 * use one shared strategy: prefixed UUIDs.
 */

import { randomUUID } from "node:crypto";

/** Generate a unique ID with a descriptive prefix. */
export function generateId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
