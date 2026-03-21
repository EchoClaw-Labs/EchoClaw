/**
 * Agent readiness + start + password handler for launcher.
 *
 * GET  /api/agent/readiness  — checks Docker, wallet, compute, password (cached 30s)
 * POST /api/agent/start      — starts agent via docker compose
 * POST /api/agent/password   — saves keystore password to .env
 */

import { existsSync } from "node:fs";
import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import { checkDockerAsync, getDockerInstallUrl, type DockerStatus } from "../../agent/docker-check.js";
import { AGENT_DEFAULT_PORT } from "../../agent/constants.js";
import { AGENT_COMPOSE_FILE, getAgentComposeFailureInfo, getAgentUrl, runAgentCompose, waitForAgentHealth } from "../../agent/compose.js";
import { EchoError } from "../../errors.js";
import logger from "../../utils/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const CACHE_TTL = 30_000;
const COMPUTE_CHECK_TIMEOUT_MS = 8_000;
const AGENT_HEALTH_TIMEOUT_MS = 2_000;
const MIN_PASSWORD_LENGTH = 8;

// ── Docker check cache (30s) ─────────────────────────────────────────

let cachedDocker: DockerStatus | null = null;
let cachedAt = 0;

async function getCachedDocker(): Promise<DockerStatus> {
  const now = Date.now();
  if (cachedDocker && (now - cachedAt) < CACHE_TTL) return cachedDocker;
  cachedDocker = await checkDockerAsync();
  cachedAt = now;
  return cachedDocker;
}

// ── Compose path ─────────────────────────────────────────────────────

// ── Fallback response (always valid JSON) ────────────────────────────

interface ReadinessResponse {
  ready: boolean;
  checks: {
    docker: { installed: boolean; running: boolean; composeAvailable: boolean; version: string | null };
    wallet: boolean;
    password: boolean;
    passwordInfo: {
      status: "ready" | "missing" | "drift" | "invalid";
      source: "env" | "app-env" | "none";
    };
    compute: { ready: boolean; detail: string | null };
  };
  agentRunning: boolean;
  agentUrl: string | null;
  installDockerUrl: string;
}

function fallbackReadiness(reason: string): ReadinessResponse {
  return {
    ready: false,
    checks: {
      docker: { installed: false, running: false, composeAvailable: false, version: null },
      wallet: false,
      password: false,
      passwordInfo: { status: "missing", source: "none" },
      compute: { ready: false, detail: reason },
    },
    agentRunning: false,
    agentUrl: null,
    installDockerUrl: getDockerInstallUrl(),
  };
}

// ── Readiness ────────────────────────────────────────────────────────

const handleReadiness: RouteHandler = async (_req, res) => {
  try {
    const docker = await getCachedDocker();

    let walletOk = false;
    try {
      const { keystoreExists } = await import("../../wallet/keystore.js");
      walletOk = keystoreExists();
    } catch { /* wallet module unavailable */ }

    let passwordInfo: ReadinessResponse["checks"]["passwordInfo"] = {
      status: "missing",
      source: "none",
    };
    try {
      const { getPasswordHealth } = await import("../../password/health.js");
      const health = getPasswordHealth();
      passwordInfo = {
        status: health.status,
        source: health.source,
      };
    } catch { /* env module unavailable */ }
    const passwordOk = passwordInfo.status === "ready";

    let computeOk = false;
    let computeDetail: string | null = null;
    try {
      const { loadComputeState, checkComputeReadiness } = await import("../../0g-compute/readiness.js");
      const state = loadComputeState();
      if (state?.activeProvider) {
        try {
          const timeoutSignal = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("compute readiness check timeout")), COMPUTE_CHECK_TIMEOUT_MS),
          );
          const readiness = await Promise.race([checkComputeReadiness(), timeoutSignal]);
          computeOk = readiness.ready;
          computeDetail = readiness.ready
            ? state.model ?? null
            : Object.entries(readiness.checks).filter(([, v]) => !v.ok).map(([k]) => k).join(", ");
        } catch (err) {
          computeOk = false;
          computeDetail = err instanceof Error ? err.message : "compute readiness check failed";
        }
      }
    } catch { /* compute module unavailable */ }

    let agentRunning = false;
    try {
      const r = await fetch(`http://127.0.0.1:${AGENT_DEFAULT_PORT}/api/agent/health`, { signal: AbortSignal.timeout(AGENT_HEALTH_TIMEOUT_MS) });
      agentRunning = r.ok;
    } catch { /* agent not reachable */ }

    const ready = docker.installed && docker.running && docker.composeAvailable && walletOk && passwordOk && computeOk;

    jsonResponse(res, 200, {
      ready,
      checks: {
        docker: { installed: docker.installed, running: docker.running, composeAvailable: docker.composeAvailable, version: docker.version },
        wallet: walletOk,
        password: passwordOk,
        passwordInfo,
        compute: { ready: computeOk, detail: computeDetail },
      },
      agentRunning,
      agentUrl: agentRunning ? `http://127.0.0.1:${AGENT_DEFAULT_PORT}` : null,
      installDockerUrl: getDockerInstallUrl(),
    } satisfies ReadinessResponse);
  } catch (err) {
    // Global fallback — never let readiness endpoint return non-200
    logger.warn(`agent.readiness.failed: ${err instanceof Error ? err.message : String(err)}`);
    jsonResponse(res, 200, fallbackReadiness("readiness check failed"));
  }
};

// ── Start agent ──────────────────────────────────────────────────────

const handleStart: RouteHandler = async (_req, res) => {
  const docker = await getCachedDocker();
  if (!docker.installed || !docker.running) {
    errorResponse(res, 400, "DOCKER_NOT_READY", "Docker is not installed or not running");
    return;
  }

  if (!existsSync(AGENT_COMPOSE_FILE)) {
    errorResponse(res, 500, "COMPOSE_NOT_FOUND", "docker-compose.yml not found");
    return;
  }

  try {
    // Load .env vars (TAVILY_API_KEY etc.) so docker compose inherits them
    const { loadProviderDotenv } = await import("../../providers/env-resolution.js");
    const { ensureAgentPasswordReadyForContainer } = await import("../../password/compat.js");
    loadProviderDotenv();
    ensureAgentPasswordReadyForContainer();

    runAgentCompose(["up", "-d"], {
      stdio: "pipe",
      timeoutMs: 300_000,
    });

    // Poll health
    const healthy = await waitForAgentHealth(AGENT_DEFAULT_PORT, { attempts: 15, intervalMs: 2_000, timeoutMs: AGENT_HEALTH_TIMEOUT_MS });

    jsonResponse(res, 200, {
      started: true,
      healthy,
      url: getAgentUrl(),
    });
  } catch (err) {
    if (err instanceof EchoError) {
      const message = err.hint ? `${err.message} Hint: ${err.hint}` : err.message;
      errorResponse(res, 500, "START_FAILED", message);
      return;
    }
    const failure = getAgentComposeFailureInfo(err, { defaultHint: "Make sure Docker is running and retry." });
    const message = failure.hint ? `${failure.message} Hint: ${failure.hint}` : failure.message;
    errorResponse(res, 500, "START_FAILED", message);
  }
};

// ── Password setup ───────────────────────────────────────────────────

const handleSetPassword: RouteHandler = async (_req, res, params) => {
  const body = params.body as { password?: string } | undefined;
  const password = body?.password?.trim() ?? "";

  if (!password) {
    errorResponse(res, 400, "MISSING_PASSWORD", "Password is required");
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errorResponse(res, 400, "PASSWORD_TOO_SHORT", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return;
  }

  try {
    const { writeAppEnvValue } = await import("../../providers/env-resolution.js");
    writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password);
    process.env.ECHO_KEYSTORE_PASSWORD = password;

    // Verify decryption works if keystore exists
    let verified = false;
    try {
      const { keystoreExists, loadKeystore, decryptPrivateKey } = await import("../../wallet/keystore.js");
      if (keystoreExists()) {
        const ks = loadKeystore();
        if (ks) {
          decryptPrivateKey(ks, password);
          verified = true;
        }
      } else {
        // No keystore yet — password saved for when wallet is created
        verified = true;
      }
    } catch {
      // Decryption failed — password is wrong, but still saved
      verified = false;
    }

    logger.info("agent.password.saved");
    jsonResponse(res, 200, { saved: true, verified });
  } catch (err) {
    errorResponse(res, 500, "SAVE_FAILED", err instanceof Error ? err.message : "Failed to save password");
  }
};

// ── Registration ─────────────────────────────────────────────────────

export function registerAgentRoutes(): void {
  registerRoute("GET", "/api/agent/readiness", handleReadiness);
  registerRoute("POST", "/api/agent/start", handleStart);
  registerRoute("POST", "/api/agent/password", handleSetPassword);
}
