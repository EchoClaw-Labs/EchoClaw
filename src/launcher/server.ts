/**
 * EchoClaw Launcher HTTP server.
 *
 * Serves the React dashboard from dist/launcher-ui/ and
 * dispatches /api/* requests to registered route handlers.
 *
 * Binds to 127.0.0.1 only — local tool, not a security boundary.
 * Pattern follows claude/proxy.ts.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, errorResponse } from "./routes.js";
import { registerSnapshotRoutes } from "./handlers/snapshot.js";
import { registerCatalogRoutes } from "./handlers/catalog.js";
import { registerDaemonRoutes } from "./handlers/daemons.js";
import { registerAgentRoutes } from "./handlers/agent.js";
import { registerFundRoutes } from "./handlers/fund.js";
import { registerWalletRoutes } from "./handlers/wallet.js";
import { registerConnectRoutes } from "./handlers/connect.js";
import { registerClaudeRoutes } from "./handlers/claude.js";
import { registerBridgeRoutes } from "./handlers/bridge.js";
import { registerOpenClawRoutes } from "./handlers/openclaw.js";
import { registerTavilyRoutes } from "./handlers/tavily.js";
import {
  LAUNCHER_PID_FILE,
  LAUNCHER_DIR,
  LAUNCHER_DEFAULT_PORT,
} from "../config/paths.js";
import logger from "../utils/logger.js";

// ── Static file serving ──────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getStaticDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // In dist: dist/launcher/server.js → dist/launcher-ui/
  return resolve(__dirname, "..", "launcher-ui");
}

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function handleStaticRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const staticDir = getStaticDir();
  if (!existsSync(staticDir)) return false;

  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    pathname = req.url?.split("?")[0] ?? "/";
  }

  // Prevent path traversal
  const safePath = pathname.replace(/\.\./g, "");

  // Try exact file match
  const filePath = join(staticDir, safePath);
  if (serveStaticFile(res, filePath)) return true;

  // SPA fallback: serve index.html for non-file paths
  const indexPath = join(staticDir, "index.html");
  if (serveStaticFile(res, indexPath)) return true;

  return false;
}

// ── Route registration ───────────────────────────────────────────

function registerAllRoutes(): void {
  registerSnapshotRoutes();
  registerCatalogRoutes();
  registerDaemonRoutes();
  registerFundRoutes();
  registerWalletRoutes();
  registerConnectRoutes();
  registerClaudeRoutes();
  registerBridgeRoutes();
  registerOpenClawRoutes();
  registerAgentRoutes();
  registerTavilyRoutes();
}

// ── Request handler ──────────────────────────────────────────────

function createRequestHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  registerAllRoutes();

  return (req: IncomingMessage, res: ServerResponse) => {
    // CORS for localhost dev (Vite dev server on different port)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    handleApiRequest(req, res)
      .then((handled) => {
        if (handled) return;

        // Try serving static files
        if (handleStaticRequest(req, res)) return;

        errorResponse(res, 404, "NOT_FOUND", `${req.method} ${req.url}`);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[launcher] request error: ${msg}`);
        if (!res.writableEnded) {
          errorResponse(res, 500, "INTERNAL_ERROR", msg);
        }
      });
  };
}

// ── Server lifecycle ─────────────────────────────────────────────

export function startLauncherServer(port?: number, writePid = false): Promise<Server> {
  const listenPort = port ?? LAUNCHER_DEFAULT_PORT;

  return new Promise((resolve, reject) => {
    const server = createServer(createRequestHandler());

    server.on("error", (err) => {
      logger.error(`[launcher] server error: ${err.message}`);
      reject(err);
    });

    server.listen(listenPort, "127.0.0.1", () => {
      logger.info(`[launcher] listening on http://127.0.0.1:${listenPort}`);

      if (writePid) {
        if (!existsSync(dirname(LAUNCHER_PID_FILE))) {
          mkdirSync(dirname(LAUNCHER_PID_FILE), { recursive: true });
        }
        writeFileSync(LAUNCHER_PID_FILE, String(process.pid), "utf-8");
        logger.debug(`[launcher] PID file: ${LAUNCHER_PID_FILE}`);
      }

      resolve(server);
    });
  });
}

export function cleanupPidFile(): void {
  try {
    if (existsSync(LAUNCHER_PID_FILE)) {
      unlinkSync(LAUNCHER_PID_FILE);
    }
  } catch {
    // ignore
  }
}
