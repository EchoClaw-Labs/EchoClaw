/**
 * Agent subcommand for `echoclaw echo`.
 *
 * Docker-based control plane:
 * - start  → docker compose up -d
 * - stop   → docker compose down
 * - status → docker compose ps
 * - reset  → docker compose down -v (destroys DB)
 */

import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EchoError, ErrorCodes } from "../../errors.js";
import { loadProviderDotenv } from "../../providers/env-resolution.js";
import { respond } from "../../utils/respond.js";
import { AGENT_DEFAULT_PORT, AGENT_DIR } from "../../agent/constants.js";
import { checkDocker, formatDockerError } from "../../agent/docker-check.js";
import { AGENT_COMPOSE_FILE, AGENT_PROJECT_NAME, getAgentComposeFailureInfo, getAgentUrl, isAgentRunning, runAgentCompose, waitForAgentHealth } from "../../agent/compose.js";
import { ensureAgentPasswordReadyForContainer } from "../../password/compat.js";

const TOKEN_FILE = join(AGENT_DIR, "agent.token");

function runCompose(args: string[], options: { silent?: boolean; envOverrides?: Record<string, string | undefined> } = {}): string {
  try {
    // Load .env vars (TAVILY_API_KEY etc.) so docker compose inherits them
    loadProviderDotenv();
    return runAgentCompose(args, {
      envOverrides: options.envOverrides,
      stdio: options.silent ? "pipe" : "inherit",
      timeoutMs: 120_000,
    })?.toString().trim() ?? "";
  } catch (err) {
    const failure = getAgentComposeFailureInfo(err, { defaultHint: "Is Docker running?" });
    throw new EchoError(ErrorCodes.AGENT_START_FAILED, failure.message, failure.hint);
  }
}

export function createAgentSubcommand(): Command {
  const agent = new Command("agent")
    .description("Echo Agent — AI trading assistant powered by 0G Compute");

  // ── agent start ─────────────────────────────────────────────

  agent
    .command("start")
    .description("Start agent (Docker: agent + postgres)")
    .option("--json", "JSON output")
    .option("--port <number>", "Override agent port (default: 4201)")
    .action(async (opts: { port?: string }) => {
      // Check Docker
      const docker = checkDocker();
      const dockerError = formatDockerError(docker);
      if (dockerError) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, dockerError);
      }

      // Check compose file
      if (!existsSync(AGENT_COMPOSE_FILE)) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, `docker-compose.yml not found at ${AGENT_COMPOSE_FILE}`, "Reinstall echoclaw or check installation.");
      }

      const port = opts.port ? parseInt(opts.port, 10) : AGENT_DEFAULT_PORT;
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, `Invalid port: ${opts.port}`, "Use a TCP port between 1 and 65535.");
      }

      if (isAgentRunning()) {
        respond({
          data: { status: "already_running", url: getAgentUrl(port) },
          ui: { type: "info", title: "Echo Agent", body: `Already running at ${getAgentUrl(port)}` },
        });
        return;
      }

      ensureAgentPasswordReadyForContainer();
      runCompose(["up", "-d"], { envOverrides: port === AGENT_DEFAULT_PORT ? {} : { AGENT_PORT: String(port) } });

      // Wait for agent to be healthy
      const ready = await waitForAgentHealth(port);

      if (!ready) {
        respond({
          data: { status: "starting", url: getAgentUrl(port) },
          ui: { type: "warn", title: "Echo Agent", body: `Containers started but agent not healthy yet. Check: docker compose -p ${AGENT_PROJECT_NAME} logs agent` },
        });
        return;
      }

      // Read auth token
      let token: string | undefined;
      try { token = readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { /* token not readable from host — normal in Docker */ }

      try { await openBrowser(); } catch { /* non-fatal */ }

      respond({
        data: { status: "running", url: getAgentUrl(port), token: token ?? null },
        ui: {
          type: "success",
          title: "Echo Agent",
          body: `Running at ${getAgentUrl(port)}\n${token ? `Token: ${token.slice(0, 16)}...` : "Token: check agent.token file"}`,
        },
      });
    });

  // ── agent stop ──────────────────────────────────────────────

  agent
    .command("stop")
    .description("Stop agent containers")
    .option("--json", "JSON output")
    .action(() => {
      if (!isAgentRunning()) {
        respond({ data: { stopped: true, wasRunning: false }, ui: { type: "info", title: "Echo Agent", body: "Not running" } });
        return;
      }
      runCompose(["down"]);
      respond({ data: { stopped: true }, ui: { type: "success", title: "Echo Agent", body: "Stopped" } });
    });

  // ── agent status ────────────────────────────────────────────

  agent
    .command("status")
    .description("Show agent status")
    .option("--json", "JSON output")
    .action(async () => {
      const running = isAgentRunning();
      let healthy = false;
      if (running) {
        try {
          const res = await fetch(`${getAgentUrl()}/api/agent/health`, { signal: AbortSignal.timeout(3000) });
          healthy = res.ok;
        } catch { /* not healthy */ }
      }

      respond({
        data: { running, healthy, url: running ? getAgentUrl() : null },
        ui: {
          type: running ? "success" : "info",
          title: "Echo Agent",
          body: running
            ? `Running (${healthy ? "healthy" : "starting..."})\nURL: ${getAgentUrl()}`
            : "Not running\nStart: echoclaw echo agent start",
        },
      });
    });

  // ── agent reset ─────────────────────────────────────────────

  agent
    .command("reset")
    .description("Reset agent — destroys all data (DB, sessions, trades, memory)")
    .option("--json", "JSON output")
    .option("--keep-soul", "Keep soul identity during reset")
    .action(async (opts: { keepSoul?: boolean }) => {
      if (isAgentRunning() && !opts.keepSoul) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, "Stop the agent first: echoclaw echo agent stop");
      }

      if (opts.keepSoul && isAgentRunning()) {
        // Soft reset: wipe data tables but keep soul — via API
        let token: string | undefined;
        try { token = readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { /* */ }
        if (!token) {
          throw new EchoError(ErrorCodes.AGENT_START_FAILED, "Cannot read agent token for soft reset");
        }
        // TODO: implement soft reset endpoint when needed
        respond({
          data: { reset: true, keepSoul: true },
          ui: { type: "info", title: "Echo Agent", body: "--keep-soul: not yet implemented for running agent. Stop first, then reset." },
        });
        return;
      }

      // down -v destroys the pgdata volume = full DB reset
      try { runCompose(["down", "-v"], { silent: true }); } catch { /* already down */ }

      respond({
        data: { reset: true, keepSoul: false },
        ui: { type: "success", title: "Echo Agent", body: "Full reset complete. All data destroyed. Next start will re-initialize." },
      });
    });

  // ── agent backup ────────────────────────────────────────────

  agent
    .command("backup")
    .description("Backup agent data to 0G Storage")
    .option("--json", "JSON output")
    .action(async () => {
      if (!isAgentRunning()) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, "Agent must be running for backup. Start: echoclaw echo agent start");
      }

      let token: string | undefined;
      try { token = readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { /* */ }

      const res = await fetch(`${getAgentUrl()}/api/agent/backup`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: "Unknown error" } })) as Record<string, unknown>;
        const errMsg = ((body.error as Record<string, unknown>)?.message as string) ?? `HTTP ${res.status}`;
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, `Backup failed: ${errMsg}`);
      }

      const data = await res.json() as Record<string, unknown>;
      const backup = data.backup as Record<string, unknown>;

      respond({
        data,
        ui: {
          type: "success",
          title: "Echo Agent Backup",
          body: `Backup complete!\nRoot: ${backup.rootHash}\nFiles: ${backup.fileCount}\nTimestamp: ${backup.createdAt}`,
        },
      });
    });

  // ── agent restore ───────────────────────────────────────────

  agent
    .command("restore")
    .description("Restore agent data from 0G Storage snapshot")
    .requiredOption("--root <hash>", "Root hash of backup snapshot (0x-prefixed)")
    .option("--json", "JSON output")
    .action(async (opts: { root: string }) => {
      if (!isAgentRunning()) {
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, "Agent must be running for restore. Start: echoclaw echo agent start");
      }

      let token: string | undefined;
      try { token = readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { /* */ }

      const res = await fetch(`${getAgentUrl()}/api/agent/restore`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ root: opts.root }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: "Unknown error" } })) as Record<string, unknown>;
        const errMsg = ((body.error as Record<string, unknown>)?.message as string) ?? `HTTP ${res.status}`;
        throw new EchoError(ErrorCodes.AGENT_START_FAILED, `Restore failed: ${errMsg}`);
      }

      const data = await res.json() as Record<string, unknown>;

      respond({
        data,
        ui: { type: "success", title: "Echo Agent Restore", body: `Restore complete from root: ${opts.root}` },
      });
    });

  return agent;
}

async function openBrowser(port = AGENT_DEFAULT_PORT): Promise<void> {
  const url = `http://127.0.0.1:${port}`;
  const { exec } = await import("node:child_process");
  const { platform } = await import("node:os");
  const cmd = platform() === "darwin" ? `open "${url}"` : platform() === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
