import { existsSync, readFileSync, openSync, mkdirSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import inquirer from "inquirer";
import { ZG_COMPUTE_DIR, ZG_MONITOR_LOG_FILE, ZG_MONITOR_STATE_FILE } from "../../../0g-compute/constants.js";
import { stopMonitorDaemon, isMonitorTrackingProvider, getMonitorPid } from "../../../0g-compute/monitor-lifecycle.js";
import { loadComputeState } from "../../../0g-compute/readiness.js";
import { getSkillHooksEnv } from "../../../openclaw/config.js";
import { writeStderr } from "../../../utils/output.js";
import { colors } from "../../../utils/ui.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

function detect(state: OnboardState): StepStatus {
  const pid = getMonitorPid();
  if (pid === null) {
    return { configured: false, summary: "Balance monitor not running" };
  }

  // PID is alive — check state file for config parity
  if (state.selectedProvider) {
    if (isMonitorTrackingProvider(state.selectedProvider)) {
      state.monitorRunning = true;
      return { configured: true, summary: `Monitor running (PID ${pid})` };
    }

    // Not tracking — distinguish "state file unreadable" from "not tracking this provider"
    if (existsSync(ZG_MONITOR_STATE_FILE)) {
      try {
        JSON.parse(readFileSync(ZG_MONITOR_STATE_FILE, "utf-8"));
        // Parseable but provider not tracked
        return {
          configured: false,
          summary: `Monitor running (PID ${pid}) but not tracking current provider — reconfigure recommended`,
        };
      } catch {
        // Cannot parse state file — treat as running with warning
        state.monitorRunning = true;
        return {
          configured: true,
          summary: `Monitor running (PID ${pid})`,
          warning: "Could not verify monitor config — state file unreadable",
        };
      }
    }
  }

  state.monitorRunning = true;
  return { configured: true, summary: `Monitor running (PID ${pid})` };
}

async function run(state: OnboardState): Promise<StepResult> {
  // Recover provider from existing state if step 6 was skipped
  if (!state.selectedProvider) {
    const computeState = loadComputeState();
    if (computeState?.activeProvider) {
      state.selectedProvider = computeState.activeProvider;
    }
  }
  if (!state.selectedProvider && existsSync(ZG_MONITOR_STATE_FILE)) {
    try {
      const monState = JSON.parse(readFileSync(ZG_MONITOR_STATE_FILE, "utf-8")) as { providers?: string[] };
      const candidate = monState.providers?.[0]?.trim();
      if (candidate) {
        state.selectedProvider = candidate;
      }
    } catch { /* ignore unreadable state file */ }
  }
  if (!state.selectedProvider) {
    return { action: "failed", message: "No provider found. Complete the 0G Compute step first." };
  }

  if (!state.webhooksConfigured) {
    writeStderr(colors.warn("  ⚠ Notifications not configured — monitor will check balance but cannot send alerts."));
    writeStderr(colors.muted("  To enable alerts, go back and set up Notifications."));
    writeStderr("");
  }

  const { startMonitor } = await inquirer.prompt([{
    type: "confirm",
    name: "startMonitor",
    message: "Start balance monitor daemon?",
    default: true,
  }]);

  if (!startMonitor) {
    return { action: "skipped", message: "Monitor not started" };
  }

  // Stop existing monitor if running
  const stopResult = await stopMonitorDaemon();
  if (!stopResult.stopped) {
    return { action: "failed", message: stopResult.error! };
  }

  const { mode } = await inquirer.prompt([{
    type: "list",
    name: "mode",
    message: "Monitor mode:",
    choices: [
      { name: "Recommended (auto-calculates threshold from provider pricing)", value: "recommended" },
      { name: "Fixed threshold", value: "fixed" },
    ],
  }]);

  let threshold: string | undefined;
  let buffer = "0";

  if (mode === "fixed") {
    const { thresholdInput } = await inquirer.prompt([{
      type: "input",
      name: "thresholdInput",
      message: "Alert threshold (in 0G):",
      default: "1.0",
      validate: (input: string) => {
        const n = Number(input);
        return (Number.isFinite(n) && n > 0) || "Must be a positive number";
      },
    }]);
    threshold = thresholdInput;
  } else {
    const { bufferInput } = await inquirer.prompt([{
      type: "input",
      name: "bufferInput",
      message: "Extra buffer above recommended min (in 0G):",
      default: "0",
      validate: (input: string) => {
        const n = Number(input);
        return (Number.isFinite(n) && n >= 0) || "Must be >= 0";
      },
    }]);
    buffer = bufferInput;
  }

  const { interval } = await inquirer.prompt([{
    type: "input",
    name: "interval",
    message: "Check interval (seconds):",
    default: "300",
    validate: (input: string) => {
      const n = Number(input);
      return (Number.isInteger(n) && n >= 60) || "Must be an integer >= 60";
    },
  }]);

  // Ensure log directory
  if (!existsSync(ZG_COMPUTE_DIR)) {
    mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
  }

  // Build daemon args
  const childArgs: string[] = [
    "0g-compute", "monitor", "start",
    "--providers", state.selectedProvider,
    "--mode", mode,
    "--interval", interval,
    "--buffer", buffer,
  ];
  if (threshold != null) {
    childArgs.push("--threshold", threshold);
  }

  const cliPath = fileURLToPath(new URL("../../../cli.js", import.meta.url));
  const logFd = openSync(ZG_MONITOR_LOG_FILE, "a");

  try {
    const child = spawn(process.execPath, [cliPath, ...childArgs], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...getSkillHooksEnv() },
    });

    child.unref();
    closeSync(logFd);

    state.monitorRunning = true;

    writeStderr(colors.muted(`  PID: ${child.pid}`));
    writeStderr(colors.muted(`  Log: ${ZG_MONITOR_LOG_FILE}`));

    return {
      action: "configured",
      message: `Monitor daemon started (PID ${child.pid})`,
    };
  } catch (err) {
    try { closeSync(logFd); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `Failed to start monitor: ${msg}` };
  }
}

export const monitorStep: OnboardStep = {
  name: "Balance Monitor",
  description: "Starts a background watchdog that checks your AI compute balance. It alerts you before your credits run out so your agent never goes offline.",
  detect,
  run,
};
