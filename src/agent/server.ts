/**
 * Echo Agent HTTP server (Postgres-backed).
 *
 * Auth: startup token generated on boot, required for all /api/* requests.
 * CORS: same-origin only in production, localhost dev via Vite proxy.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { AGENT_DEFAULT_PORT, AGENT_PID_FILE, AGENT_DIR } from "./constants.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/client.js";
import { seedSkills } from "./db/repos/skills.js";
import { initEngine, createSession, processMessage } from "./engine.js";
import { registerChatRoutes } from "./handlers/chat.js";
import { registerStatusRoutes } from "./handlers/status.js";
import { registerMemoryRoutes } from "./handlers/memory.js";
import { registerApproveRoutes } from "./handlers/approve.js";
import { registerTradesRoutes } from "./handlers/trades.js";
import { registerPortfolioRoutes } from "./handlers/portfolio.js";
import { registerTasksRoutes } from "./handlers/tasks.js";
import { registerBillingRoutes } from "./handlers/billing.js";
import { registerLoopRoutes } from "./handlers/loop.js";
import { registerBackupRoutes } from "./handlers/backup.js";
import { registerConfigRoutes } from "./handlers/config.js";
import { registerRoute, dispatchRoute } from "./routes.js";
import { initScheduler, setInferenceHandler, stopAll as stopScheduler } from "./scheduler.js";
import { checkRateLimit, getClientIp } from "./rate-limit.js";
import logger from "../utils/logger.js";

// ── Auth token ───────────────────────────────────────────────────────

const AGENT_TOKEN_FILE = join(AGENT_DIR, "agent.token");

function generateAuthToken(): string {
  // Use env var if provided (Docker / dev), otherwise generate
  if (process.env.AGENT_AUTH_TOKEN) return process.env.AGENT_AUTH_TOKEN;

  const token = `agent-${randomBytes(24).toString("hex")}`;
  if (!existsSync(AGENT_DIR)) mkdirSync(AGENT_DIR, { recursive: true });
  writeFileSync(AGENT_TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

let authToken = "";

function checkAuth(req: IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim() === authToken;
  }
  // Parse cookie properly — match exact token value
  const cookies = (req.headers.cookie ?? "").split(";").map(c => c.trim());
  const tokenCookie = cookies.find(c => c.startsWith("agent_token="));
  return tokenCookie?.slice("agent_token=".length) === authToken;
}

// ── MIME types ───────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
};

function findStaticRoot(): string {
  const candidates = [
    join(process.cwd(), "dist", "agent-ui"),
    join(dirname(new URL(import.meta.url).pathname), "..", "..", "dist", "agent-ui"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0];
}

function serveStatic(res: ServerResponse, urlPath: string, staticRoot: string): boolean {
  const safePath = urlPath.replace(/\.\./g, "").replace(/\/+/g, "/");
  const filePath = join(staticRoot, safePath === "/" ? "index.html" : safePath);
  if (!existsSync(filePath)) return false;

  const ext = extname(filePath);
  const content = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Content-Length": content.length,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  res.end(content);
  return true;
}

// ── Server startup ───────────────────────────────────────────────────

export async function startAgentServer(port?: number, writePid = false): Promise<void> {
  const listenPort = port ?? AGENT_DEFAULT_PORT;
  const staticRoot = findStaticRoot();

  // 0. Generate auth token
  authToken = generateAuthToken();
  logger.debug(`[agent] auth token: ${authToken.slice(0, 12)}...`);

  // 1. Database: migrate + seed skills
  logger.info("[agent] running database migrations...");
  await runMigrations();
  logger.info("[agent] seeding skill references...");
  await seedSkills();

  // 2. Engine init
  const engineReady = await initEngine();
  if (!engineReady) {
    logger.error("[agent] Engine failed to initialize — compute not configured?");
    process.exit(1);
  }

  // 3. Scheduler + register inference handler (Fix #4)
  logger.info("[agent] initializing scheduler...");
  setInferenceHandler(async (prompt: string, loopMode: string) => {
    const session = createSession();
    if (!session) return "Agent not ready";
    let result = "";
    await processMessage(session, prompt, (event) => {
      if (event.type === "text_delta" && typeof event.data.text === "string") {
        result += event.data.text;
      }
    }, loopMode as "full" | "restricted" | "off");
    return result;
  });
  await initScheduler();

  // 4. Register API routes
  registerChatRoutes();
  registerStatusRoutes();
  registerMemoryRoutes();
  registerApproveRoutes();
  registerTradesRoutes();
  registerPortfolioRoutes();
  registerTasksRoutes();
  registerBillingRoutes();
  registerLoopRoutes();
  registerBackupRoutes();
  registerConfigRoutes();

  // Health: no auth required
  registerRoute("GET", "/api/agent/health", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: listenPort }));
  });

  // Auth token endpoint: same-origin UI fetches token + sets cookie
  registerRoute("GET", "/api/agent/auth-init", (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `agent_token=${authToken}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    });
    res.end(JSON.stringify({ ok: true }));
  });

  // 5. HTTP server
  const isDev = process.env.NODE_ENV !== "production";

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    // Dev CORS (Vite proxy on different port)
    if (isDev) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "http://localhost:4202");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    }

    // Static files — no auth needed (SPA assets)
    if (!url.startsWith("/api/")) {
      if (serveStatic(res, url, staticRoot)) return;
      if (!url.includes(".") && existsSync(join(staticRoot, "index.html"))) { serveStatic(res, "/", staticRoot); return; }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // API auth check (skip health + auth-init)
    if (url !== "/api/agent/health" && url !== "/api/agent/auth-init") {
      if (!checkAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid or missing auth token" } }));
        return;
      }
    }

    // Rate limit critical endpoints
    const rateLimits: Record<string, [number, number]> = {
      "/api/agent/chat": [10, 60_000],      // 10 per minute
      "/api/agent/backup": [5, 60_000],     // 5 per minute
    };
    const baseUrl = url.split("?")[0];
    const rateRule = rateLimits[baseUrl];
    if (rateRule) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(clientIp, baseUrl, rateRule[0], rateRule[1])) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests — try again later" } }));
        return;
      }
    }

    dispatchRoute(req, res);
  });

  server.listen(listenPort, "0.0.0.0", () => {
    logger.info(`[agent] listening on http://0.0.0.0:${listenPort}`);
    if (writePid) {
      if (!existsSync(dirname(AGENT_PID_FILE))) mkdirSync(dirname(AGENT_PID_FILE), { recursive: true });
      writeFileSync(AGENT_PID_FILE, String(process.pid), "utf-8");
    }
  });

  const shutdown = async () => {
    logger.info("[agent] shutting down...");
    stopScheduler();
    await closePool();
    try { if (existsSync(AGENT_PID_FILE)) unlinkSync(AGENT_PID_FILE); } catch { /* */ }
    try { if (existsSync(AGENT_TOKEN_FILE)) unlinkSync(AGENT_TOKEN_FILE); } catch { /* */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };

  process.on("SIGTERM", () => { shutdown(); });
  process.on("SIGINT", () => { shutdown(); });
}

// ── Auto-start when run directly (Docker CMD or `node dist/agent/server.js`) ──

const isDirectRun = process.argv[1]?.endsWith("agent/server.js") || process.argv[1]?.endsWith("agent\\server.js");
if (isDirectRun) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  startAgentServer(port, true).catch((err) => {
    console.error("[agent] Fatal:", err);
    process.exit(1);
  });
}
