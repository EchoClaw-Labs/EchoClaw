/**
 * Minimal route dispatcher for the agent server.
 * Same pattern as launcher/routes.ts but standalone.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import logger from "../utils/logger.js";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: { pathParams: Record<string, string>; body: Record<string, unknown> | null },
) => void | Promise<void>;

interface RouteEntry {
  method: string;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
}

const routes: RouteEntry[] = [];

export function registerRoute(method: string, pattern: string, handler: RouteHandler): void {
  routes.push({
    method: method.toUpperCase(),
    pattern,
    segments: pattern.split("/").filter(Boolean),
    handler,
  });
}

function matchRoute(method: string, url: string): { handler: RouteHandler; pathParams: Record<string, string> } | null {
  const [path] = url.split("?");
  const requestSegments = path.split("/").filter(Boolean);

  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== requestSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i++) {
      const routeSeg = route.segments[i];
      const reqSeg = requestSegments[i];

      if (routeSeg.startsWith(":")) {
        params[routeSeg.slice(1)] = reqSeg;
      } else if (routeSeg !== reqSeg) {
        matched = false;
        break;
      }
    }

    if (matched) return { handler: route.handler, pathParams: params };
  }

  return null;
}

/** Maximum request body size (1 MB). */
const MAX_BODY_BYTES = 1_048_576;

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null | "PARSE_ERROR" | "TOO_LARGE"> {
  return new Promise((resolve) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        resolve("TOO_LARGE");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      if (chunks.length === 0) { resolve(null); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        resolve("PARSE_ERROR");
      }
    });
    req.on("error", () => { if (!aborted) resolve(null); });
  });
}

export async function dispatchRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = req.url ?? "/";
  const requestId = randomUUID();
  const startTime = Date.now();

  const match = matchRoute(method, url);
  if (!match) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `${method} ${url}` } }));
    return;
  }

  try {
    const body = await readBody(req);
    if (body === "TOO_LARGE") {
      errorResponse(res, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds 1 MB limit");
      return;
    }
    if (body === "PARSE_ERROR") {
      errorResponse(res, 400, "INVALID_JSON", "Request body is not valid JSON");
      return;
    }
    await match.handler(req, res, { pathParams: match.pathParams, body });
    const durationMs = Date.now() - startTime;
    logger.debug("request.completed", { requestId, method, url, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    logger.error("request.failed", { requestId, method, url, durationMs, error: message });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message } }));
    }
  }
}

// ── Response helpers ─────────────────────────────────────────────────

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

export function errorResponse(res: ServerResponse, status: number, code: string, message: string): void {
  jsonResponse(res, status, { error: { code, message } });
}
