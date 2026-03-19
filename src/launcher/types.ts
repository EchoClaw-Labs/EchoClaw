/**
 * Launcher API types.
 *
 * Extends existing echo protocol types with launcher-specific
 * request/response shapes. Does NOT duplicate domain types —
 * import those from their source modules.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ── Route handling ───────────────────────────────────────────────

export type HttpMethod = "GET" | "POST";

export interface RouteHandler {
  (req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void>;
}

export interface RouteParams {
  /** Named path segments, e.g. { name: "proxy" } from /api/daemons/:name/start */
  segments: Record<string, string>;
  /** Parsed query string params */
  query: Record<string, string>;
  /** Parsed JSON body (POST only, null for GET) */
  body: Record<string, unknown> | null;
}

export interface RouteEntry {
  method: HttpMethod;
  /** Path pattern, e.g. "/api/snapshot" or "/api/daemons/:name/start" */
  pattern: string;
  handler: RouteHandler;
}

// ── API response helpers ─────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

// ── Routing decision ─────────────────────────────────────────────

export interface RoutingDecision {
  mode: "wizard" | "dashboard";
  reason: string;
}

// ── Daemon status ────────────────────────────────────────────────

export interface DaemonStatus {
  name: string;
  running: boolean;
  pid: number | null;
}

export interface DaemonsResponse {
  daemons: DaemonStatus[];
}
