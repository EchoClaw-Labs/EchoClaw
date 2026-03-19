/**
 * OpenClaw onboard API handlers.
 *
 * DOES NOT call step.run() directly — those use inquirer.prompt() which
 * requires TTY. Instead, each interactive step has its own HTTP handler
 * that accepts JSON body inputs and calls the underlying non-interactive
 * functions directly.
 *
 * Non-interactive steps (config, openclaw-link, monitor) can use run() safely.
 */

import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import type { RouteHandler } from "../types.js";
import { jsonResponse, errorResponse, registerRoute } from "../routes.js";
import type { OnboardState, StepStatus } from "../../commands/onboard/types.js";
import { configStep } from "../../commands/onboard/steps/config.js";
import { openclawStep } from "../../commands/onboard/steps/openclaw.js";
import { passwordStep } from "../../commands/onboard/steps/password.js";
import { webhooksStep } from "../../commands/onboard/steps/webhooks.js";
import { walletStep } from "../../commands/onboard/steps/wallet.js";
import { computeStep } from "../../commands/onboard/steps/compute.js";
import { monitorStep } from "../../commands/onboard/steps/monitor.js";
import { gatewayStep } from "../../commands/onboard/steps/gateway.js";
import { patchOpenclawConfig, patchOpenclawSkillEnv } from "../../openclaw/config.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { createWallet } from "../../wallet/create.js";
import { keystoreExists } from "../../wallet/keystore.js";
import { solanaKeystoreExists } from "../../wallet/solana-keystore.js";
import { spawnMonitorFromState } from "../../utils/daemon-spawn.js";
import logger from "../../utils/logger.js";

const ALL_STEPS = [
  { key: "config", step: configStep },
  { key: "openclaw", step: openclawStep },
  { key: "password", step: passwordStep },
  { key: "webhooks", step: webhooksStep },
  { key: "wallet", step: walletStep },
  { key: "compute", step: computeStep },
  { key: "monitor", step: monitorStep },
  { key: "gateway", step: gatewayStep },
];

function makeState(): OnboardState {
  return {
    configInitialized: false, openclawLinked: false, passwordSet: false,
    webhooksConfigured: false, walletAddress: null, hasKeystore: false,
    computeReady: false, selectedProvider: null, monitorRunning: false,
    gatewayRestarted: false,
  };
}

// ── GET /api/openclaw/status — detect-only, safe ─────────────────

const handleStatus: RouteHandler = async (_req, res) => {
  const state = makeState();
  const statuses: Array<{ key: string; name: string; description: string; status: StepStatus }> = [];

  for (const { key, step } of ALL_STEPS) {
    const status = await step.detect(state);
    statuses.push({ key, name: step.name, description: step.description, status });
  }

  jsonResponse(res, 200, { state, steps: statuses });
};

// ── POST /api/openclaw/step/config — non-interactive, safe ───────

const handleConfigInit: RouteHandler = async (_req, res) => {
  const state = makeState();
  const result = await configStep.run(state);
  logger.info(`[launcher] openclaw config: ${result.action}`);
  jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "config", action: result.action, message: result.message });
};

// ── POST /api/openclaw/step/openclaw — non-interactive, safe ─────

const handleLinkSkill: RouteHandler = async (_req, res) => {
  const state = makeState();
  const result = await openclawStep.run(state);
  logger.info(`[launcher] openclaw link: ${result.action}`);
  jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "openclaw", action: result.action, message: result.message });
};

// ── POST /api/openclaw/step/password — needs JSON body, NOT inquirer

const handlePassword: RouteHandler = async (_req, res, params) => {
  const password = params.body?.password as string | undefined;
  const autoUpdate = params.body?.autoUpdate !== false; // default true

  if (!password || password.length < 8) {
    errorResponse(res, 400, "INVALID_PASSWORD", "Password must be at least 8 characters.");
    return;
  }

  // Save password (same as CLI password.ts)
  writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password);
  process.env.ECHO_KEYSTORE_PASSWORD = password;

  // Auto-update preference (same as CLI password.ts:54)
  try {
    const { setAutoUpdatePreference } = await import("../../update/auto-update-preference.js");
    setAutoUpdatePreference(autoUpdate);
  } catch { /* non-fatal if module not available */ }

  // Retire legacy update daemon (same as CLI password.ts:55)
  try {
    const { retireLegacyUpdateDaemon } = await import("../../update/legacy-runtime.js");
    await retireLegacyUpdateDaemon({ waitMs: 1000 });
  } catch { /* non-fatal */ }

  // Legacy shell cleanup (same as CLI password.ts:81)
  try {
    const { runLegacyCleanupWithLog } = await import("../../utils/legacy-cleanup.js");
    runLegacyCleanupWithLog();
  } catch { /* non-fatal */ }

  logger.info("[launcher] openclaw password set + auto-update + legacy cleanup");
  jsonResponse(res, 200, {
    phase: "openclaw", status: "applied", step: "password",
    action: "configured", message: `Password saved. Auto-update: ${autoUpdate ? "enabled" : "disabled"}.`,
  });
};

// ── POST /api/openclaw/step/webhooks — needs JSON body ───────────

const handleWebhooks: RouteHandler = async (_req, res, params) => {
  const body = params.body ?? {};
  const baseUrl = (body.baseUrl as string) || "http://127.0.0.1:18789";
  const token = (body.token as string) || randomBytes(32).toString("hex");
  const agentId = body.agentId as string | undefined;
  const channel = body.channel as string | undefined;
  const to = body.to as string | undefined;

  // Patch gateway config
  patchOpenclawConfig("hooks.enabled", true, { force: true });
  patchOpenclawConfig("hooks.token", token, { force: true });
  patchOpenclawConfig("hooks.defaultSessionKey", "hook:alerts", { force: false });

  // Patch skill env
  const skillEnv: Record<string, string> = {
    OPENCLAW_HOOKS_BASE_URL: baseUrl,
    OPENCLAW_HOOKS_TOKEN: token,
    OPENCLAW_HOOKS_INCLUDE_GUARDRAIL: "1",
  };
  if (agentId) skillEnv.OPENCLAW_HOOKS_AGENT_ID = agentId;
  if (channel) skillEnv.OPENCLAW_HOOKS_CHANNEL = channel;
  if (to) skillEnv.OPENCLAW_HOOKS_TO = to;

  patchOpenclawSkillEnv("echoclaw", skillEnv, { force: true });

  logger.info("[launcher] openclaw webhooks configured");
  jsonResponse(res, 200, {
    phase: "openclaw", status: "applied", step: "webhooks",
    action: "configured", message: "Webhooks configured (gateway + skill env).",
  });
};

// ── POST /api/openclaw/step/wallet — needs JSON body ─────────────

const handleWallet: RouteHandler = async (_req, res, params) => {
  const chain = (params.body?.chain as string) ?? "evm";
  try {
    if (chain === "solana") {
      const forceCreate = solanaKeystoreExists();
      const { createSolanaWallet } = await import("../../wallet/solana-create.js");
      const result = await createSolanaWallet({ force: forceCreate });
      logger.info(`[launcher] openclaw solana wallet created: ${result.address}`);
      jsonResponse(res, 200, {
        phase: "openclaw", status: "applied", step: "wallet",
        action: "configured", message: `Solana wallet created: ${result.address}`,
        address: result.address,
      });
    } else {
      const forceCreate = keystoreExists();
      const result = await createWallet({ force: forceCreate });
      logger.info(`[launcher] openclaw wallet created: ${result.address}`);
      jsonResponse(res, 200, {
        phase: "openclaw", status: "applied", step: "wallet",
        action: "configured", message: `EVM wallet created: ${result.address}`,
        address: result.address,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 400, "WALLET_CREATE_FAILED", msg);
  }
};

// ── POST /api/openclaw/step/compute — full compute setup via existing operations

const handleCompute: RouteHandler = async (_req, res, params) => {
  const provider = params.body?.provider as string | undefined;
  const depositAmount = (params.body?.depositAmount as string) ?? "1.0";
  const fundAmount = (params.body?.fundAmount as string) ?? "1.0";

  if (!provider) {
    errorResponse(res, 400, "MISSING_PROVIDER", "provider is required. Fetch from GET /api/fund/providers first.");
    return;
  }

  const { getAuthenticatedBroker } = await import("../../0g-compute/broker-factory.js");
  const { depositToLedger, fundProvider: fundProviderOp, ackWithReadback, createApiKey, listChatServices } = await import("../../0g-compute/operations.js");
  const { configureOpenclawProvider } = await import("../../0g-compute/operations.js");

  try {
    const broker = await getAuthenticatedBroker();

    // 1. Deposit to ledger
    await depositToLedger(broker, depositAmount);

    // 2. Fund provider
    await fundProviderOp(broker, provider, fundAmount);

    // 3. ACK provider
    await ackWithReadback(broker, provider);

    // 4. Create API key
    const apiKey = await createApiKey(broker, provider, 0);

    // 5. Patch OpenClaw config with provider details
    await configureOpenclawProvider(broker, provider, apiKey.rawToken);

    logger.info(`[launcher] openclaw compute setup complete for ${provider.slice(0, 10)}...`);
    jsonResponse(res, 200, {
      phase: "openclaw", status: "applied", step: "compute",
      action: "configured",
      message: `Compute ready: deposited ${depositAmount}, funded ${fundAmount}, ACK'd, API key created, OpenClaw config patched.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorResponse(res, 500, "COMPUTE_SETUP_FAILED", `Compute setup failed: ${msg}`);
  }
};

// ── POST /api/openclaw/step/monitor — non-interactive, safe ──────

const handleMonitor: RouteHandler = async (_req, res) => {
  const result = spawnMonitorFromState();
  if (result.status === "already_running") {
    jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "monitor", action: "already_configured", message: "Monitor already running." });
    return;
  }
  if (result.status === "spawn_failed") {
    errorResponse(res, 500, "MONITOR_SPAWN_FAILED", `Failed: ${result.error}`);
    return;
  }
  logger.info(`[launcher] openclaw monitor started (PID ${result.pid})`);
  jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "monitor", action: "configured", message: `Monitor started (PID ${result.pid}).` });
};

// ── GET /api/openclaw/gateway-methods — detect available restart methods

const handleGatewayMethods: RouteHandler = async (_req, res) => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  // Container detection (mirrors gateway.ts)
  const isContainer = existsSync("/.dockerenv") || (() => {
    try { const cg = readFileSync("/proc/1/cgroup", "utf-8"); return cg.includes("docker") || cg.includes("containerd"); } catch { return false; }
  })();

  let hasCli = false;
  try { execSync("which openclaw", { stdio: "ignore" }); hasCli = true; } catch { /* */ }

  const composePath = join(homedir(), "openclaw", "docker-compose.yml");
  const hasDockerCompose = existsSync(composePath);

  const methods: string[] = [];
  if (hasCli) methods.push("cli");
  if (hasDockerCompose) methods.push("docker");
  methods.push("skip");

  jsonResponse(res, 200, {
    isContainer,
    hasCli,
    hasDockerCompose,
    composePath: hasDockerCompose ? composePath : null,
    availableMethods: methods,
  });
};

// ── POST /api/openclaw/step/gateway — needs JSON body ────────────

const handleGateway: RouteHandler = async (_req, res, params) => {
  const method = (params.body?.method as string) ?? "skip";
  const composePath = params.body?.composePath as string | undefined;

  if (method === "skip") {
    jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "gateway", action: "skipped", message: "Gateway restart skipped." });
    return;
  }

  if (method === "cli") {
    try {
      execSync("openclaw gateway restart", { stdio: "ignore", timeout: 60_000 });
      jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "gateway", action: "configured", message: "Gateway restarted (CLI)." });
    } catch (err) {
      errorResponse(res, 500, "GATEWAY_RESTART_FAILED", `CLI restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (method === "docker") {
    const path = composePath ?? `${process.env.HOME}/openclaw/docker-compose.yml`;
    try {
      execSync(`docker compose -f "${path}" restart`, { stdio: "ignore", timeout: 60_000 });
      jsonResponse(res, 200, { phase: "openclaw", status: "applied", step: "gateway", action: "configured", message: "Gateway restarted (Docker)." });
    } catch (err) {
      errorResponse(res, 500, "GATEWAY_RESTART_FAILED", `Docker restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  errorResponse(res, 400, "INVALID_METHOD", `Unknown method: ${method}. Use: cli, docker, skip`);
};

// ── Registration ─────────────────────────────────────────────────

export function registerOpenClawRoutes(): void {
  registerRoute("GET", "/api/openclaw/status", handleStatus);
  registerRoute("GET", "/api/openclaw/gateway-methods", handleGatewayMethods);
  registerRoute("POST", "/api/openclaw/step/config", handleConfigInit);
  registerRoute("POST", "/api/openclaw/step/openclaw", handleLinkSkill);
  registerRoute("POST", "/api/openclaw/step/password", handlePassword);
  registerRoute("POST", "/api/openclaw/step/webhooks", handleWebhooks);
  registerRoute("POST", "/api/openclaw/step/wallet", handleWallet);
  registerRoute("POST", "/api/openclaw/step/compute", handleCompute);
  registerRoute("POST", "/api/openclaw/step/monitor", handleMonitor);
  registerRoute("POST", "/api/openclaw/step/gateway", handleGateway);
}
