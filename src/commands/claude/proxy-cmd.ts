import { Command } from "commander";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { isHeadless } from "../../utils/output.js";
import { colors } from "../../utils/ui.js";
import { isDaemonAlive } from "../../utils/daemon-spawn.js";
import {
  CLAUDE_PROXY_PID_FILE,
  CLAUDE_PROXY_STOPPED_FILE,
  CLAUDE_PROXY_LOG_FILE,
  CLAUDE_PROXY_DIR,
  CLAUDE_PROXY_DEFAULT_PORT,
} from "../../claude/constants.js";
import { loadConfig } from "../../config/store.js";

export function createProxySubcommand(): Command {
  const proxy = new Command("proxy")
    .description("Translation proxy: Anthropic Messages API → 0G OpenAI endpoint")
    .option("--daemon-child", "Run as daemon child (internal)", false)
    .action(async (options: { daemonChild?: boolean }) => {
      // Foreground mode (or daemon-child mode)
      const { startProxyServer, cleanupPidFile } = await import("../../claude/proxy.js");
      const config = loadConfig();
      const port = config.claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT;

      const writePid = !!options.daemonChild;

      const shutdown = () => {
        cleanupPidFile();
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      try {
        await startProxyServer(port, writePid);

        if (!isHeadless() && !options.daemonChild) {
          process.stderr.write(`\n  Claude proxy running on http://127.0.0.1:${port}\n`);
          process.stderr.write(`  Model: ${config.claude?.model ?? "not configured"}\n`);
          process.stderr.write(`  Press Ctrl+C to stop\n\n`);
        }
      } catch (err) {
        cleanupPidFile();
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.CLAUDE_PROXY_START_FAILED, `Failed to start proxy: ${msg}`);
      }

      // Keep alive
      await new Promise<void>(() => {});
    });

  // Hide --daemon-child from help
  const daemonOpt = proxy.options.find(o => o.long === "--daemon-child");
  if (daemonOpt) daemonOpt.hidden = true;

  // ── proxy start ──────────────────────────────────────────────────
  proxy
    .command("start")
    .description("Start proxy as background daemon")
    .option("--json", "JSON output")
    .action(async () => {
      // Remove stopped marker
      try {
        if (existsSync(CLAUDE_PROXY_STOPPED_FILE)) unlinkSync(CLAUDE_PROXY_STOPPED_FILE);
      } catch { /* ignore */ }

      const { spawnClaudeProxy } = await import("../../utils/daemon-spawn.js");
      const result = spawnClaudeProxy();

      if (result.status === "already_running") {
        throw new EchoError(ErrorCodes.CLAUDE_PROXY_ALREADY_RUNNING, "Claude proxy is already running.");
      }

      if (result.status === "spawn_failed") {
        throw new EchoError(ErrorCodes.CLAUDE_PROXY_START_FAILED, `Failed to start proxy: ${result.error}`);
      }

      respond({
        data: { daemon: true, pid: result.pid, logFile: result.logFile },
        ui: {
          type: "success",
          title: "Claude Proxy",
          body: `Started (PID ${result.pid})\nLog: ${result.logFile}`,
        },
      });
    });

  // ── proxy stop ───────────────────────────────────────────────────
  proxy
    .command("stop")
    .description("Stop the running proxy")
    .option("--json", "JSON output")
    .action(async () => {
      if (!existsSync(CLAUDE_PROXY_PID_FILE)) {
        throw new EchoError(ErrorCodes.CLAUDE_PROXY_NOT_RUNNING, "Claude proxy is not running (no pidfile).");
      }

      const pid = parseInt(readFileSync(CLAUDE_PROXY_PID_FILE, "utf-8").trim(), 10);

      try {
        process.kill(pid, 0);
      } catch {
        unlinkSync(CLAUDE_PROXY_PID_FILE);
        throw new EchoError(ErrorCodes.CLAUDE_PROXY_NOT_RUNNING, `Proxy not running (stale PID ${pid}).`);
      }

      // SIGTERM
      try {
        process.kill(pid, "SIGTERM");
      } catch { /* ignore */ }

      // Wait up to 5s
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
        } catch {
          // Process exited
          try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* ignore */ }
          if (!existsSync(CLAUDE_PROXY_DIR)) mkdirSync(CLAUDE_PROXY_DIR, { recursive: true });
          writeFileSync(CLAUDE_PROXY_STOPPED_FILE, String(Date.now()), "utf-8");

          respond({
            data: { stopped: true, pid },
            ui: { type: "success", title: "Claude Proxy", body: `Stopped (PID ${pid})` },
          });
          return;
        }
      }

      // SIGKILL
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
      try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* ignore */ }
      if (!existsSync(CLAUDE_PROXY_DIR)) mkdirSync(CLAUDE_PROXY_DIR, { recursive: true });
      writeFileSync(CLAUDE_PROXY_STOPPED_FILE, String(Date.now()), "utf-8");

      respond({
        data: { stopped: true, pid, method: "SIGKILL" },
        ui: { type: "warn", title: "Claude Proxy", body: `Force-killed (PID ${pid})` },
      });
    });

  // ── proxy status ─────────────────────────────────────────────────
  proxy
    .command("status")
    .description("Show proxy status")
    .option("--json", "JSON output")
    .action(async () => {
      const config = loadConfig();
      let running = false;
      let pid: number | undefined;

      if (existsSync(CLAUDE_PROXY_PID_FILE)) {
        pid = parseInt(readFileSync(CLAUDE_PROXY_PID_FILE, "utf-8").trim(), 10);
        try {
          process.kill(pid, 0);
          running = true;
        } catch {
          running = false;
        }
      }

      const port = config.claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT;
      const authConfigured = !!process.env.ZG_CLAUDE_AUTH_TOKEN;

      // Health check if running
      let healthy = false;
      if (running) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
          clearTimeout(timeout);
          healthy = res.ok;
        } catch {
          healthy = false;
        }
      }

      const data = {
        running,
        pid,
        port,
        healthy,
        provider: config.claude?.provider ?? null,
        model: config.claude?.model ?? null,
        providerEndpoint: config.claude?.providerEndpoint ?? null,
        authConfigured,
        logFile: CLAUDE_PROXY_LOG_FILE,
      };

      if (isHeadless()) {
        const { writeJsonSuccess } = await import("../../utils/output.js");
        writeJsonSuccess(data);
      } else {
        const lines: string[] = [];
        if (running) {
          lines.push(`${colors.success("Running")} (PID ${pid})`);
          lines.push(`Health: ${healthy ? colors.success("OK") : colors.warn("unreachable")}`);
        } else {
          lines.push(colors.muted("Not running"));
        }
        lines.push(`Port: ${port}`);
        lines.push(`Model: ${config.claude?.model ?? colors.muted("not configured")}`);
        lines.push(`Provider: ${config.claude?.provider ? config.claude.provider.slice(0, 10) + "..." : colors.muted("not configured")}`);
        lines.push(`Auth: ${authConfigured ? colors.success("configured") : colors.warn("not set")}`);
        lines.push(`Log: ${CLAUDE_PROXY_LOG_FILE}`);
        process.stderr.write(lines.join("\n") + "\n");
      }
    });

  return proxy;
}
