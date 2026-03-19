/**
 * Launcher subcommand for `echoclaw echo`.
 *
 * Manages the browser-based launcher dashboard:
 * - `echoclaw echo launcher` (foreground / --daemon-child)
 * - `echoclaw echo launcher start` (background daemon)
 * - `echoclaw echo launcher stop`
 * - `echoclaw echo launcher status`
 *
 * Pattern follows claude/proxy-cmd.ts exactly.
 */

import { Command } from "commander";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { EchoError, ErrorCodes } from "../../errors.js";
import { respond } from "../../utils/respond.js";
import { isHeadless } from "../../utils/output.js";
import { isDaemonAlive } from "../../utils/daemon-spawn.js";
import {
  LAUNCHER_PID_FILE,
  LAUNCHER_STOPPED_FILE,
  LAUNCHER_LOG_FILE,
  LAUNCHER_DIR,
  LAUNCHER_DEFAULT_PORT,
} from "../../config/paths.js";

export function createLauncherSubcommand(): Command {
  const launcher = new Command("launcher")
    .description("Browser-based EchoClaw dashboard on localhost")
    .option("--daemon-child", "Run as daemon child (internal)", false)
    .option("--port <port>", "Override default port")
    .action(async (options: { daemonChild?: boolean; port?: string }) => {
      const { startLauncherServer, cleanupPidFile } = await import("../../launcher/server.js");
      const port = options.port ? parseInt(options.port, 10) : LAUNCHER_DEFAULT_PORT;

      const writePid = !!options.daemonChild;

      const shutdown = () => {
        cleanupPidFile();
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      try {
        await startLauncherServer(port, writePid);

        if (!isHeadless() && !options.daemonChild) {
          process.stderr.write(`\n  Launcher running on http://127.0.0.1:${port}\n`);
          process.stderr.write(`  Press Ctrl+C to stop\n\n`);
        }
      } catch (err) {
        cleanupPidFile();
        const msg = err instanceof Error ? err.message : String(err);
        throw new EchoError(ErrorCodes.LAUNCHER_START_FAILED, `Failed to start launcher: ${msg}`);
      }

      // Keep alive
      await new Promise<void>(() => {});
    });

  // Hide --daemon-child from help
  const daemonOpt = launcher.options.find(o => o.long === "--daemon-child");
  if (daemonOpt) daemonOpt.hidden = true;

  // ── launcher start ─────────────────────────────────────────────

  launcher
    .command("start")
    .description("Start launcher as background daemon")
    .option("--json", "JSON output")
    .action(async () => {
      // Remove stopped marker
      try {
        if (existsSync(LAUNCHER_STOPPED_FILE)) unlinkSync(LAUNCHER_STOPPED_FILE);
      } catch { /* ignore */ }

      const { spawnLauncher } = await import("../../utils/daemon-spawn.js");
      const result = spawnLauncher();

      if (result.status === "already_running") {
        respond({
          data: { status: "already_running", url: `http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}` },
          ui: { type: "info", title: "Launcher", body: `Already running at http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}` },
        });
        return;
      }

      if (result.status === "spawn_failed") {
        throw new EchoError(ErrorCodes.LAUNCHER_START_FAILED, `Failed to start launcher: ${result.error}`);
      }

      respond({
        data: { status: "spawned", pid: result.pid, logFile: result.logFile, url: `http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}` },
        ui: {
          type: "success",
          title: "Launcher",
          body: `Started (PID ${result.pid})\nURL: http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}\nLog: ${result.logFile}`,
        },
      });
    });

  // ── launcher stop ──────────────────────────────────────────────

  launcher
    .command("stop")
    .description("Stop the running launcher")
    .option("--json", "JSON output")
    .action(async () => {
      if (!existsSync(LAUNCHER_PID_FILE)) {
        throw new EchoError(ErrorCodes.LAUNCHER_NOT_RUNNING, "Launcher is not running (no pidfile).");
      }

      const pid = parseInt(readFileSync(LAUNCHER_PID_FILE, "utf-8").trim(), 10);

      try {
        process.kill(pid, 0);
      } catch {
        unlinkSync(LAUNCHER_PID_FILE);
        throw new EchoError(ErrorCodes.LAUNCHER_NOT_RUNNING, `Launcher not running (stale PID ${pid}).`);
      }

      try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
        } catch {
          try { if (existsSync(LAUNCHER_PID_FILE)) unlinkSync(LAUNCHER_PID_FILE); } catch { /* ignore */ }
          if (!existsSync(LAUNCHER_DIR)) mkdirSync(LAUNCHER_DIR, { recursive: true });
          writeFileSync(LAUNCHER_STOPPED_FILE, String(Date.now()), "utf-8");

          respond({
            data: { stopped: true, pid },
            ui: { type: "success", title: "Launcher", body: `Stopped (PID ${pid})` },
          });
          return;
        }
      }

      // SIGKILL
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
      try { if (existsSync(LAUNCHER_PID_FILE)) unlinkSync(LAUNCHER_PID_FILE); } catch { /* ignore */ }
      if (!existsSync(LAUNCHER_DIR)) mkdirSync(LAUNCHER_DIR, { recursive: true });
      writeFileSync(LAUNCHER_STOPPED_FILE, String(Date.now()), "utf-8");

      respond({
        data: { stopped: true, pid, method: "SIGKILL" },
        ui: { type: "warn", title: "Launcher", body: `Force-killed (PID ${pid})` },
      });
    });

  // ── launcher status ────────────────────────────────────────────

  launcher
    .command("status")
    .description("Show launcher status")
    .option("--json", "JSON output")
    .action(async () => {
      const running = isDaemonAlive(LAUNCHER_PID_FILE);
      let pid: number | undefined;

      if (running && existsSync(LAUNCHER_PID_FILE)) {
        pid = parseInt(readFileSync(LAUNCHER_PID_FILE, "utf-8").trim(), 10);
      }

      const data = {
        running,
        pid: pid ?? null,
        port: LAUNCHER_DEFAULT_PORT,
        url: `http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}`,
        logFile: LAUNCHER_LOG_FILE,
      };

      respond({
        data,
        ui: {
          type: running ? "success" : "info",
          title: "Launcher",
          body: running
            ? `Running (PID ${pid})\nURL: http://127.0.0.1:${LAUNCHER_DEFAULT_PORT}\nLog: ${LAUNCHER_LOG_FILE}`
            : `Not running\nStart: echoclaw echo launcher start`,
        },
      });
    });

  return launcher;
}

/**
 * Open the launcher URL in the user's default browser.
 * Cross-platform: xdg-open (Linux), open (macOS), start (Windows).
 */
export async function openLauncherInBrowser(port = LAUNCHER_DEFAULT_PORT): Promise<void> {
  const url = `http://127.0.0.1:${port}`;
  const { exec } = await import("node:child_process");
  const { platform } = await import("node:os");

  const command = platform() === "darwin"
    ? `open "${url}"`
    : platform() === "win32"
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) {
      // Non-fatal: just log, user can open manually
      process.stderr.write(`  Open manually: ${url}\n`);
    }
  });
}
