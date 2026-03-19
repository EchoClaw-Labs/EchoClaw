import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { BOT_PID_FILE, BOT_SHUTDOWN_FILE, BOT_STOPPED_FILE, BOT_DIR } from "../../config/paths.js";
import logger from "../../utils/logger.js";
import { loadOrders } from "../../bot/orders.js";
import { getRecentExecutions } from "../../bot/state.js";

export function createStartSubcommand(): Command {
  const start = new Command("start")
    .description("Start the MarketMaker daemon (foreground or --daemon)")
    .option("--daemon", "Run detached as background process")
    .option("--json", "JSON output")
    .action(async (options: { daemon?: boolean }) => {
      // Remove stopped marker on explicit start
      try { if (existsSync(BOT_STOPPED_FILE)) unlinkSync(BOT_STOPPED_FILE); } catch { /* ignore */ }

      if (options.daemon) {
        const { spawnBotDaemon } = await import("../../utils/daemon-spawn.js");
        const { respond } = await import("../../utils/respond.js");
        const result = spawnBotDaemon();

        if (result.status === "already_running") {
          respond({
            data: { daemon: false, reason: "already_running" },
            ui: { type: "info", title: "MarketMaker", body: "Daemon is already running" },
          });
          return;
        }
        if (result.status === "spawn_failed") {
          respond({
            data: { daemon: false, reason: "spawn_failed", error: result.error },
            ui: { type: "warn", title: "MarketMaker", body: `Failed to spawn daemon: ${result.error}` },
          });
          return;
        }

        respond({
          data: { daemon: true, pid: result.pid, logFile: result.logFile },
          ui: { type: "success", title: "MarketMaker", body: `Started (PID ${result.pid})\nLog: ${result.logFile}` },
        });
        return;
      }

      const { BotDaemon } = await import("../../bot/daemon.js");
      const { requireWalletAndKeystore } = await import("../../bot/executor.js");

      const { address, privateKey } = requireWalletAndKeystore();
      const daemon = new BotDaemon(privateKey, address);
      await daemon.start();

      // Keep process alive — daemon runs until signal
      await new Promise<void>(() => {});
    });

  return start;
}

export function createStopSubcommand(): Command {
  const stop = new Command("stop")
    .description("Stop the running MarketMaker daemon")
    .action(async () => {
      if (!existsSync(BOT_PID_FILE)) {
        throw new EchoError(ErrorCodes.BOT_NOT_RUNNING, "MarketMaker daemon is not running (no pidfile)");
      }

      const pid = parseInt(readFileSync(BOT_PID_FILE, "utf-8").trim(), 10);

      // Check if alive
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        // Stale pidfile
        unlinkSync(BOT_PID_FILE);
        throw new EchoError(ErrorCodes.BOT_NOT_RUNNING, `MarketMaker daemon is not running (stale PID ${pid})`);
      }

      // Try SIGTERM first
      logger.info(`[mm stop] Sending SIGTERM to PID ${pid}`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore
      }

      // Wait up to 5s
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
        } catch {
          // Process died
          if (!existsSync(BOT_DIR)) mkdirSync(BOT_DIR, { recursive: true });
          writeFileSync(BOT_STOPPED_FILE, String(Date.now()), "utf-8");
          if (isHeadless()) {
            writeJsonSuccess({ stopped: true, pid });
          } else {
            process.stderr.write(`MarketMaker daemon stopped (PID ${pid})\n`);
          }
          return;
        }
      }

      // Fallback: create shutdown file (Windows-friendly)
      logger.info("[mm stop] SIGTERM didn't work, creating shutdown file...");
      writeFileSync(BOT_SHUTDOWN_FILE, String(Date.now()), "utf-8");

      // Wait another 10s
      const deadline2 = Date.now() + 10000;
      while (Date.now() < deadline2) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          process.kill(pid, 0);
        } catch {
          if (!existsSync(BOT_DIR)) mkdirSync(BOT_DIR, { recursive: true });
          writeFileSync(BOT_STOPPED_FILE, String(Date.now()), "utf-8");
          if (isHeadless()) {
            writeJsonSuccess({ stopped: true, pid, method: "shutdown-file" });
          } else {
            process.stderr.write(`MarketMaker daemon stopped via shutdown file (PID ${pid})\n`);
          }
          return;
        }
      }

      // Last resort: SIGKILL
      logger.warn(`[mm stop] Force killing PID ${pid}`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }

      // Cleanup
      try { if (existsSync(BOT_PID_FILE)) unlinkSync(BOT_PID_FILE); } catch { /* ignore */ }
      try { if (existsSync(BOT_SHUTDOWN_FILE)) unlinkSync(BOT_SHUTDOWN_FILE); } catch { /* ignore */ }

      if (!existsSync(BOT_DIR)) mkdirSync(BOT_DIR, { recursive: true });
      writeFileSync(BOT_STOPPED_FILE, String(Date.now()), "utf-8");

      if (isHeadless()) {
        writeJsonSuccess({ stopped: true, pid, method: "SIGKILL" });
      } else {
        process.stderr.write(`MarketMaker daemon force-killed (PID ${pid})\n`);
      }
    });

  return stop;
}

export function createStatusSubcommand(): Command {
  const status = new Command("status")
    .description("Show MarketMaker daemon status")
    .option("--json", "JSON output")
    .action(async () => {
      const file = loadOrders();
      const armed = file.orders.filter((o) => o.state === "armed").length;
      const filled = file.orders.filter((o) => o.state === "filled").length;
      const failed = file.orders.filter((o) => o.state === "failed").length;
      const total = file.orders.length;

      let daemonRunning = false;
      let daemonPid: number | undefined;
      if (existsSync(BOT_PID_FILE)) {
        daemonPid = parseInt(readFileSync(BOT_PID_FILE, "utf-8").trim(), 10);
        try {
          process.kill(daemonPid, 0);
          daemonRunning = true;
        } catch {
          daemonRunning = false;
        }
      }

      const recentExecs = getRecentExecutions(5);

      if (isHeadless()) {
        writeJsonSuccess({
          daemon: { running: daemonRunning, pid: daemonPid },
          orders: { total, armed, filled, failed },
          recentExecutions: recentExecs,
        });
      } else {
        process.stderr.write(`MarketMaker daemon: ${daemonRunning ? `running (PID ${daemonPid})` : "stopped"}\n`);
        process.stderr.write(`Orders: ${total} total, ${armed} armed, ${filled} filled, ${failed} failed\n`);
        if (recentExecs.length > 0) {
          process.stderr.write(`\nRecent executions:\n`);
          for (const e of recentExecs) {
            const time = new Date(e.timestamp).toISOString().slice(11, 19);
            process.stderr.write(
              `  ${time} | ${e.side.padEnd(4)} | ${e.status.padEnd(6)} | ${e.orderId.slice(0, 8)} | ${e.txHash?.slice(0, 14) ?? e.failReason?.slice(0, 30) ?? ""}\n`
            );
          }
        }
      }
    });

  return status;
}
