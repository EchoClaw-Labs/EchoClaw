/**
 * Local Anthropic-to-OpenAI translation proxy for Claude Code.
 *
 * Accepts Anthropic Messages API requests from Claude Code,
 * translates to OpenAI /chat/completions, forwards to 0G broker,
 * translates response back to Anthropic format.
 *
 * Binds to 127.0.0.1 only — local adapter, not a security boundary.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config/store.js";
import logger from "../utils/logger.js";
import {
  translateRequest,
  translateResponse,
  translateStreamChunk,
  finalizeStream,
  estimateTokenCount,
  createStreamState,
  type AnthropicRequest,
} from "./translate.js";
import {
  CLAUDE_PROXY_PID_FILE,
  CLAUDE_PROXY_DIR,
  CLAUDE_PROXY_DEFAULT_PORT,
  getClaudeDisplayModelLabel,
} from "./constants.js";

const STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const NON_STREAM_TIMEOUT_MS = 2 * 60 * 1000;

function redactSecret(s: string): string {
  if (s.startsWith("app-sk-") && s.length > 16) {
    return s.slice(0, 10) + "..." + s.slice(-4);
  }
  return s;
}

function getAuthToken(): string | null {
  return process.env.ZG_CLAUDE_AUTH_TOKEN ?? null;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function errorResponse(res: ServerResponse, status: number, type: string, message: string): void {
  jsonResponse(res, status, { type: "error", error: { type, message } });
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = loadConfig();
  if (!config.claude) {
    errorResponse(res, 503, "service_unavailable", "Claude proxy not configured. Run: echoclaw echo claude config show");
    return;
  }

  const authToken = getAuthToken();
  if (!authToken) {
    errorResponse(res, 503, "service_unavailable", "ZG_CLAUDE_AUTH_TOKEN not set in ~/.config/echoclaw/.env");
    return;
  }

  // Log incoming headers
  const anthropicVersion = req.headers["anthropic-version"];
  const anthropicBeta = req.headers["anthropic-beta"];
  if (anthropicVersion) logger.debug(`[claude-proxy] anthropic-version: ${anthropicVersion}`);
  if (anthropicBeta) logger.debug(`[claude-proxy] anthropic-beta: ${anthropicBeta}`);

  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read request body";
    const status = msg.includes("too large") ? 413 : 400;
    errorResponse(res, status, "invalid_request", msg);
    return;
  }

  let anthropicReq: AnthropicRequest;
  try {
    anthropicReq = JSON.parse(body);
  } catch {
    errorResponse(res, 400, "invalid_request", "Invalid JSON in request body");
    return;
  }

  const isStream = anthropicReq.stream === true;
  const requestedModel = anthropicReq.model;
  const resolvedAnthropicReq = {
    ...anthropicReq,
    model: resolveClaudeModel(requestedModel, config.claude.model),
  };

  let openAIReq;
  try {
    openAIReq = translateRequest(resolvedAnthropicReq);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 400, "invalid_request", msg);
    return;
  }
  const upstreamUrl = `${config.claude.providerEndpoint}/chat/completions`;

  logger.info(`[claude-proxy] ${isStream ? "stream" : "non-stream"} → ${config.claude.model} via ${config.claude.provider.slice(0, 10)}...`);

  const controller = new AbortController();
  const timeoutMs = isStream ? STREAM_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Abort upstream if client disconnects
  req.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify(openAIReq),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.text().catch(() => "");
      logger.error(`[claude-proxy] upstream ${upstreamRes.status}: ${errBody.slice(0, 200)}`);
      errorResponse(res, 502, "upstream_error", `0G broker returned ${upstreamRes.status}: ${errBody.slice(0, 200)}`);
      return;
    }

    if (isStream) {
      await handleStreamResponse(upstreamRes, res, requestedModel);
    } else {
      const responseText = await upstreamRes.text();
      const openAIRes = JSON.parse(responseText);
      const anthropicRes = translateResponse(openAIRes, requestedModel);
      jsonResponse(res, 200, anthropicRes);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      if (!res.writableEnded) {
        errorResponse(res, 504, "timeout", "Request timed out or client disconnected");
      }
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[claude-proxy] fetch error: ${msg}`);
    if (!res.writableEnded) {
      errorResponse(res, 502, "upstream_error", `Failed to reach 0G broker: ${msg}`);
    }
  }
}

async function handleStreamResponse(
  upstreamRes: Response,
  res: ServerResponse,
  reqModel: string,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const state = createStreamState(reqModel);
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    const events = finalizeStream(state);
    for (const ev of events) res.write(ev);
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed === "data: [DONE]") {
          const events = finalizeStream(state);
          for (const ev of events) res.write(ev);
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const chunk = JSON.parse(jsonStr);
            const events = translateStreamChunk(chunk, state);
            for (const ev of events) res.write(ev);
          } catch {
            logger.debug(`[claude-proxy] skipping unparseable chunk: ${jsonStr.slice(0, 100)}`);
          }
        }
      }
    }

    // Handle any remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const events = translateStreamChunk(chunk, state);
          for (const ev of events) res.write(ev);
        } catch {
          // ignore
        }
      }
    }

    // Ensure stream is finalized
    const finalEvents = finalizeStream(state);
    for (const ev of finalEvents) res.write(ev);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[claude-proxy] stream error: ${msg}`);
    const finalEvents = finalizeStream(state);
    for (const ev of finalEvents) res.write(ev);
  }

  res.end();
}

function handleCountTokens(req: IncomingMessage, res: ServerResponse): void {
  readBody(req)
    .then((body) => {
      const parsed = JSON.parse(body) as AnthropicRequest;
      const count = estimateTokenCount(parsed);
      jsonResponse(res, 200, { input_tokens: count });
    })
    .catch(() => {
      errorResponse(res, 400, "invalid_request", "Invalid JSON body");
    });
}

function handleHealth(res: ServerResponse): void {
  const config = loadConfig();
  const authToken = getAuthToken();
  jsonResponse(res, 200, {
    status: "ok",
    provider: config.claude?.provider ?? null,
    model: config.claude?.model ?? null,
    providerEndpoint: config.claude?.providerEndpoint ?? null,
    port: config.claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT,
    authConfigured: !!authToken,
  });
}

function isClaudeAlias(model: string): boolean {
  return model === "sonnet" || model === "opus" || model === "haiku";
}

export function resolveClaudeModel(
  requestedModel: string,
  configuredModel: string,
): string {
  const brandedModel = getClaudeDisplayModelLabel(configuredModel);
  if (isClaudeAlias(requestedModel) || requestedModel === brandedModel) {
    return configuredModel;
  }
  return requestedModel;
}

export function normalizeRoutePath(rawUrl: string | undefined): string {
  if (!rawUrl) return "";

  try {
    return new URL(rawUrl, "http://127.0.0.1").pathname;
  } catch {
    return rawUrl;
  }
}

// ── Server ───────────────────────────────────────────────────────────

export function createProxyRequestHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  return requestHandler;
}

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method?.toUpperCase();
  const rawUrl = req.url ?? "";
  const routePath = normalizeRoutePath(rawUrl);

  if (method === "POST" && (routePath === "/v1/messages" || routePath === "/v1/messages/")) {
    handleMessages(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[claude-proxy] unhandled: ${msg}`);
      if (!res.writableEnded) {
        errorResponse(res, 500, "internal_error", msg);
      }
    });
    return;
  }

  if (method === "POST" && (routePath === "/v1/messages/count_tokens" || routePath === "/v1/messages/count_tokens/")) {
    handleCountTokens(req, res);
    return;
  }

  if (method === "GET" && (routePath === "/health" || routePath === "/health/")) {
    handleHealth(res);
    return;
  }

  errorResponse(res, 404, "not_found", `Unknown route: ${method} ${rawUrl}`);
}

export function startProxyServer(port?: number, writePid = false): Promise<Server> {
  const listenPort = port ?? loadConfig().claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT;

  return new Promise((resolve, reject) => {
    const server = createServer(createProxyRequestHandler());

    server.on("error", (err) => {
      logger.error(`[claude-proxy] server error: ${err.message}`);
      reject(err);
    });

    server.listen(listenPort, "127.0.0.1", () => {
      const authToken = getAuthToken();
      const config = loadConfig();
      logger.info(`[claude-proxy] listening on http://127.0.0.1:${listenPort}`);
      logger.info(`[claude-proxy] model: ${config.claude?.model ?? "not configured"}`);
      logger.info(`[claude-proxy] auth: ${authToken ? redactSecret(authToken) : "NOT SET"}`);

      if (writePid) {
        if (!existsSync(dirname(CLAUDE_PROXY_PID_FILE))) {
          mkdirSync(dirname(CLAUDE_PROXY_PID_FILE), { recursive: true });
        }
        writeFileSync(CLAUDE_PROXY_PID_FILE, String(process.pid), "utf-8");
        logger.debug(`[claude-proxy] PID file: ${CLAUDE_PROXY_PID_FILE}`);
      }

      resolve(server);
    });
  });
}

export function cleanupPidFile(): void {
  try {
    if (existsSync(CLAUDE_PROXY_PID_FILE)) {
      unlinkSync(CLAUDE_PROXY_PID_FILE);
    }
  } catch {
    // ignore
  }
}
