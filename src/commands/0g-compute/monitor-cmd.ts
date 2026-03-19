import { Command } from "commander";
import type { Address } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { respond } from "../../utils/respond.js";
import { requireAddress, requirePositiveNumber } from "../../0g-compute/helpers.js";
import { requireYes } from "./helpers.js";
import logger from "../../utils/logger.js";

export function createMonitorSubcommand(): Command {
  const monitor = new Command("monitor").description("Balance monitor daemon");

  monitor
    .command("start")
    .description("Start balance monitor (foreground or --daemon)")
    .option("--providers <addrs>", "Comma-separated provider addresses")
    .option("--mode <mode>", "Monitor mode: fixed | recommended", "fixed")
    .option("--threshold <0G>", "Alert threshold in 0G (required for --mode fixed)")
    .option("--buffer <0G>", "Extra buffer above recommended min (default 0, recommended mode)", "0")
    .option("--ratio <n>", "Alert ratio multiplier (default 1.2, recommended mode)", "1.2")
    .option("--interval <sec>", "Polling interval in seconds", "300")
    .option("--from-state", "Restore config from last saved state file")
    .option("--daemon", "Run detached as background process")
    .option("--json", "JSON output")
    .action(
      async (options: {
        providers?: string;
        mode: string;
        threshold?: string;
        buffer: string;
        ratio: string;
        interval: string;
        fromState?: boolean;
        daemon?: boolean;
        json?: boolean;
      }) => {
        // Remove stopped marker on explicit start
        const { existsSync: fsE2, unlinkSync: fsU2 } = await import("node:fs");
        const { ZG_MONITOR_STOPPED_FILE } = await import("../../0g-compute/constants.js");
        try { if (fsE2(ZG_MONITOR_STOPPED_FILE)) fsU2(ZG_MONITOR_STOPPED_FILE); } catch { /* ignore */ }

        let providersRaw = options.providers;
        let mode = options.mode as "fixed" | "recommended";
        let interval = Math.max(60, Number(options.interval) || 300);
        let buffer = Number(options.buffer) || 0;
        let alertRatio = Number(options.ratio) || 1.2;
        let threshold: number | undefined;

        // --from-state: load saved monitor state as defaults
        if (options.fromState) {
          const { existsSync: fsE, readFileSync: fsR } = await import("node:fs");
          const { ZG_MONITOR_STATE_FILE } = await import("../../0g-compute/constants.js");

          if (!fsE(ZG_MONITOR_STATE_FILE)) {
            throw new EchoError(
              ErrorCodes.ZG_MONITOR_NOT_RUNNING,
              "No saved monitor state file found.",
              "Run the monitor at least once first, or specify --providers manually."
            );
          }

          const saved = JSON.parse(fsR(ZG_MONITOR_STATE_FILE, "utf-8")) as {
            providers?: string[];
            mode?: string;
            threshold?: number;
            buffer?: number;
            alertRatio?: number;
            intervalSec?: number;
          };

          // Use saved values as defaults, explicit flags override
          if (!providersRaw && saved.providers?.length) {
            providersRaw = saved.providers.join(",");
          }
          if (!options.providers && saved.mode) {
            mode = saved.mode as "fixed" | "recommended";
          }
          if (options.threshold == null && saved.threshold != null) {
            threshold = saved.threshold;
          }
          if (options.buffer === "0" && saved.buffer != null) {
            buffer = saved.buffer;
          }
          if (options.ratio === "1.2" && saved.alertRatio != null) {
            alertRatio = saved.alertRatio;
          }
          if (options.interval === "300" && saved.intervalSec != null) {
            interval = Math.max(60, saved.intervalSec);
          }
        }

        if (!providersRaw) {
          throw new EchoError(
            ErrorCodes.INVALID_AMOUNT,
            "--providers is required (or use --from-state)",
            "Use: --providers <addr1,addr2,...>"
          );
        }

        const providers = providersRaw.split(",").map((a) => requireAddress(a.trim(), "provider"));

        if (mode !== "fixed" && mode !== "recommended") {
          throw new EchoError(ErrorCodes.INVALID_AMOUNT, `Invalid mode: ${options.mode}`, "Use: fixed | recommended");
        }

        if (mode === "fixed" && threshold == null) {
          if (!options.threshold) {
            throw new EchoError(
              ErrorCodes.INVALID_AMOUNT,
              "--threshold is required for --mode fixed",
              "Use: --threshold <0G> or switch to --mode recommended"
            );
          }
          threshold = requirePositiveNumber(options.threshold, "threshold");
        } else if (options.threshold && threshold == null) {
          threshold = requirePositiveNumber(options.threshold, "threshold");
        }

        if (options.daemon) {
          // Spawn detached child process
          const { spawn } = await import("node:child_process");
          const { existsSync: fsExists, openSync, mkdirSync, closeSync } = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const { ZG_COMPUTE_DIR, ZG_MONITOR_LOG_FILE } = await import("../../0g-compute/constants.js");
          const { getSkillHooksEnv } = await import("../../openclaw/config.js");

          // Ensure log directory exists
          if (!fsExists(ZG_COMPUTE_DIR)) {
            mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
          }

          // Build args for the child — replay the same command without --daemon
          const childArgs: string[] = [
            "0g-compute", "monitor", "start",
            "--providers", providersRaw,
            "--mode", mode,
            "--interval", String(interval),
            "--buffer", String(buffer),
            "--ratio", String(alertRatio),
          ];
          if (threshold != null) {
            childArgs.push("--threshold", String(threshold));
          }

          const cliPath = fileURLToPath(new URL("../../cli.js", import.meta.url));
          const logFd = openSync(ZG_MONITOR_LOG_FILE, "a");

          const child = spawn(process.execPath, [cliPath, ...childArgs], {
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: { ...process.env, ...getSkillHooksEnv() },
          });

          child.unref();
          closeSync(logFd);

          respond({
            data: { daemon: true, pid: child.pid, logFile: ZG_MONITOR_LOG_FILE },
            ui: {
              type: "success",
              title: "Monitor Daemon",
              body: `Started (PID ${child.pid})\nLog: ${ZG_MONITOR_LOG_FILE}`,
            },
          });
          return;
        }

        const { BalanceMonitor } = await import("../../0g-compute/monitor.js");
        const monitorInstance = new BalanceMonitor({
          providers,
          mode,
          threshold,
          buffer,
          alertRatio,
          intervalSec: interval,
        });
        await monitorInstance.start();

        // Keep alive
        await new Promise<void>(() => {});
      }
    );

  monitor
    .command("stop")
    .description("Stop the running balance monitor")
    .option("--json", "JSON output")
    .action(async () => {
      const { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } = await import("node:fs");
      const { ZG_MONITOR_PID_FILE, ZG_MONITOR_SHUTDOWN_FILE, ZG_MONITOR_STOPPED_FILE: STOPPED_FILE, ZG_COMPUTE_DIR } = await import("../../0g-compute/constants.js");

      if (!existsSync(ZG_MONITOR_PID_FILE)) {
        throw new EchoError(ErrorCodes.ZG_MONITOR_NOT_RUNNING, "Balance monitor is not running (no pidfile)");
      }

      const pid = parseInt(readFileSync(ZG_MONITOR_PID_FILE, "utf-8").trim(), 10);

      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        unlinkSync(ZG_MONITOR_PID_FILE);
        throw new EchoError(ErrorCodes.ZG_MONITOR_NOT_RUNNING, `Monitor not running (stale PID ${pid})`);
      }

      // SIGTERM
      try {
        process.kill(pid, "SIGTERM");
      } catch { /* ignore */ }

      // Wait up to 5s
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          process.kill(pid, 0);
        } catch {
          if (!existsSync(ZG_COMPUTE_DIR)) mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
          writeFileSync(STOPPED_FILE, String(Date.now()), "utf-8");
          respond({
            data: { stopped: true, pid },
            ui: { type: "success", title: "Monitor Stopped", body: `Balance monitor stopped (PID ${pid})` },
          });
          return;
        }
      }

      // Fallback: shutdown file
      writeFileSync(ZG_MONITOR_SHUTDOWN_FILE, String(Date.now()), "utf-8");

      const deadline2 = Date.now() + 10000;
      while (Date.now() < deadline2) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          process.kill(pid, 0);
        } catch {
          if (!existsSync(ZG_COMPUTE_DIR)) mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
          writeFileSync(STOPPED_FILE, String(Date.now()), "utf-8");
          respond({
            data: { stopped: true, pid, method: "shutdown-file" },
            ui: { type: "success", title: "Monitor Stopped", body: `Monitor stopped via shutdown file (PID ${pid})` },
          });
          return;
        }
      }

      // SIGKILL
      try {
        process.kill(pid, "SIGKILL");
      } catch { /* ignore */ }

      try { if (existsSync(ZG_MONITOR_PID_FILE)) unlinkSync(ZG_MONITOR_PID_FILE); } catch { /* ignore */ }
      try { if (existsSync(ZG_MONITOR_SHUTDOWN_FILE)) unlinkSync(ZG_MONITOR_SHUTDOWN_FILE); } catch { /* ignore */ }

      if (!existsSync(ZG_COMPUTE_DIR)) mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
      writeFileSync(STOPPED_FILE, String(Date.now()), "utf-8");

      respond({
        data: { stopped: true, pid, method: "SIGKILL" },
        ui: { type: "warn", title: "Monitor Killed", body: `Monitor force-killed (PID ${pid})` },
      });
    });

  monitor
    .command("status")
    .description("Show balance monitor status")
    .option("--json", "JSON output")
    .action(async () => {
      const { existsSync, readFileSync } = await import("node:fs");
      const { ZG_MONITOR_PID_FILE, ZG_MONITOR_STATE_FILE, ZG_MONITOR_LOG_FILE } = await import("../../0g-compute/constants.js");

      let running = false;
      let pid: number | undefined;
      if (existsSync(ZG_MONITOR_PID_FILE)) {
        pid = parseInt(readFileSync(ZG_MONITOR_PID_FILE, "utf-8").trim(), 10);
        try {
          process.kill(pid, 0);
          running = true;
        } catch {
          running = false;
        }
      }

      let state: Record<string, unknown> = {};
      if (existsSync(ZG_MONITOR_STATE_FILE)) {
        try {
          state = JSON.parse(readFileSync(ZG_MONITOR_STATE_FILE, "utf-8"));
        } catch { /* ignore corrupt state */ }
      }

      const logFileExists = existsSync(ZG_MONITOR_LOG_FILE);

      if (isHeadless()) {
        writeJsonSuccess({ running, pid, logFile: ZG_MONITOR_LOG_FILE, logFileExists, ...state });
      } else {
        if (!running) {
          process.stderr.write("Not running\n");
          return;
        }
        const lines = [`Running (PID ${pid})`];
        if (state.mode) lines.push(`Mode: ${state.mode}`);
        if (state.threshold != null) lines.push(`Threshold: ${state.threshold} 0G`);
        if (state.intervalSec != null) lines.push(`Interval: ${state.intervalSec}s`);
        if (state.lastCheckAt) {
          lines.push(`Last check: ${new Date(state.lastCheckAt as number).toISOString()}`);
        }
        if (state.providerThresholds) {
          lines.push("Provider thresholds:");
          for (const [addr, pt] of Object.entries(state.providerThresholds as Record<string, { threshold: number; recommendedMin: number }>)) {
            lines.push(`  ${addr.slice(0, 10)}... threshold=${pt.threshold.toFixed(4)} recommendedMin=${pt.recommendedMin.toFixed(4)}`);
          }
        }
        if (logFileExists) {
          lines.push(`Log: ${ZG_MONITOR_LOG_FILE}`);
        }
        process.stderr.write(lines.join("\n") + "\n");
      }
    });

  return monitor;
}
