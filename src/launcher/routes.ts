/**
 * Launcher API route dispatcher.
 *
 * Matches incoming requests to registered handlers.
 * Pattern: static segments + :param segments.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteEntry, RouteHandler, RouteParams, HttpMethod, ApiError } from "./types.js";
import { EchoError } from "../errors.js";
import logger from "../utils/logger.js";

// ── Route registry ───────────────────────────────────────────────

const routes: RouteEntry[] = [];

export function registerRoute(method: HttpMethod, pattern: string, handler: RouteHandler): void {
  routes.push({ method, pattern, handler });
}

// ── Request parsing ──────────────────────────────────────────────

function parseQueryString(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!raw) return params;
  for (const pair of raw.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const value = decodeURIComponent(pair.slice(eqIdx + 1));
    params[key] = value;
  }
  return params;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  if (req.method !== "POST") return null;
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Pattern matching ─────────────────────────────────────────────

function matchRoute(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: { segments: Record<string, string> } } | null {
  const reqMethod = method?.toUpperCase() ?? "GET";

  for (const route of routes) {
    if (route.method !== reqMethod) continue;

    const patternParts = route.pattern.split("/").filter(Boolean);
    const pathParts = pathname.split("/").filter(Boolean);

    if (patternParts.length !== pathParts.length) continue;

    const segments: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i]!;
      const rp = pathParts[i]!;

      if (pp.startsWith(":")) {
        segments[pp.slice(1)] = rp;
      } else if (pp !== rp) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { handler: route.handler, params: { segments } };
    }
  }

  return null;
}

// ── Response helpers ─────────────────────────────────────────────

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function errorResponse(res: ServerResponse, status: number, code: string, message: string, hint?: string): void {
  const body: ApiError = { error: { code, message, ...(hint ? { hint } : {}) } };
  jsonResponse(res, status, body);
}

// ── Main dispatcher ──────────────────────────────────────────────

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawUrl = req.url ?? "";
  let pathname: string;
  let queryString: string;

  try {
    const url = new URL(rawUrl, "http://127.0.0.1");
    pathname = url.pathname;
    queryString = url.search.slice(1);
  } catch {
    pathname = rawUrl.split("?")[0] ?? rawUrl;
    queryString = rawUrl.split("?")[1] ?? "";
  }

  if (!pathname.startsWith("/api/")) return false;

  const match = matchRoute(req.method ?? "GET", pathname);
  if (!match) {
    errorResponse(res, 404, "NOT_FOUND", `No handler for ${req.method} ${pathname}`);
    return true;
  }

  const query = parseQueryString(queryString);
  const body = await parseBody(req);

  if (req.method === "POST" && body === null) {
    errorResponse(res, 400, "INVALID_JSON", "Request body is not valid JSON");
    return true;
  }

  const params: RouteParams = { segments: match.params.segments, query, body };

  try {
    await match.handler(req, res, params);
  } catch (err) {
    if (err instanceof EchoError) {
      logger.error(`[launcher] ${err.code}: ${err.message}`);
      errorResponse(res, 400, err.code, err.message, err.hint);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[launcher] unhandled: ${msg}`);
      errorResponse(res, 500, "INTERNAL_ERROR", msg);
    }
  }

  return true;
}
