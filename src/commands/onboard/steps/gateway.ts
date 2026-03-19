import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import inquirer from "inquirer";
import { writeStderr } from "../../../utils/output.js";
import { colors } from "../../../utils/ui.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

// ── Environment detection ────────────────────────────────

function isInsideContainer(): boolean {
  if (existsSync("/.dockerenv")) return true;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

function hasOpenclawCli(): boolean {
  try {
    execSync("which openclaw", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findDockerCompose(): string | null {
  const candidate = join(homedir(), "openclaw", "docker-compose.yml");
  return existsSync(candidate) ? candidate : null;
}

// ── Step ─────────────────────────────────────────────────

function detect(_state: OnboardState): StepStatus {
  return { configured: false, summary: "Gateway not restarted yet" };
}

async function run(state: OnboardState): Promise<StepResult> {
  const inContainer = isInsideContainer();

  // ── Inside container: can only print instructions ──
  if (inContainer) {
    writeStderr("");
    writeStderr(colors.warn("  Running inside a container — cannot restart gateway from here."));
    writeStderr("");
    writeStderr("  After onboarding, exit the container and run from the host:");
    writeStderr(colors.bold("    docker compose -f ~/openclaw/docker-compose.yml restart"));
    writeStderr("");
    writeStderr("  Then re-enter the container and restore the monitor:");
    writeStderr(colors.bold("    echoclaw 0g-compute monitor start --from-state --daemon"));
    writeStderr("");

    const { understood } = await inquirer.prompt([{
      type: "confirm",
      name: "understood",
      message: "Understood — I'll restart from the host after onboarding",
      default: true,
    }]);

    if (understood) {
      state.gatewayRestarted = true;
      return {
        action: "configured_with_warning",
        message: "Instructions shown — restart from host after onboarding",
      };
    }
    return { action: "skipped", message: "Gateway restart skipped" };
  }

  // ── On host: detect available methods ──
  const hasCli = hasOpenclawCli();
  const composePath = findDockerCompose();

  type RestartMode = "cli" | "docker" | "skip";
  const choices: { name: string; value: RestartMode }[] = [];

  if (hasCli) {
    choices.push({ name: "CLI restart (openclaw gateway restart)", value: "cli" });
  }
  if (composePath) {
    choices.push({ name: `Docker restart (docker compose -f ${composePath} restart)`, value: "docker" });
  }
  choices.push({ name: "Skip — I'll restart manually", value: "skip" });

  // Nothing detected except skip
  if (choices.length === 1) {
    writeStderr(colors.muted("  No openclaw CLI or Docker Compose file detected."));
    writeStderr(colors.muted("  Restart the gateway manually after onboarding."));
    return {
      action: "configured_with_warning",
      message: "No restart method detected — restart manually",
    };
  }

  const { mode } = await inquirer.prompt([{
    type: "list",
    name: "mode",
    message: "How should we restart the gateway?",
    choices,
  }]);

  if (mode === "skip") {
    return { action: "skipped", message: "Restart skipped — run manually when ready" };
  }

  if (mode === "cli") {
    try {
      writeStderr(colors.muted("  Running: openclaw gateway restart"));
      execSync("openclaw gateway restart", { stdio: "inherit", timeout: 60_000 });
      state.gatewayRestarted = true;
      return { action: "configured", message: "Gateway restarted (CLI)" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { action: "failed", message: `CLI restart failed: ${msg}` };
    }
  }

  // mode === "docker"
  let finalPath = composePath!;

  const { customPath } = await inquirer.prompt([{
    type: "input",
    name: "customPath",
    message: "Docker Compose file path:",
    default: finalPath,
  }]);
  finalPath = customPath;

  if (!existsSync(finalPath)) {
    return { action: "failed", message: `File not found: ${finalPath}` };
  }

  try {
    writeStderr(colors.muted(`  Running: docker compose -f ${finalPath} restart`));
    execSync(`docker compose -f "${finalPath}" restart`, { stdio: "inherit", timeout: 60_000 });
    state.gatewayRestarted = true;
    return { action: "configured", message: "Gateway restarted (Docker)" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: "failed", message: `Docker restart failed: ${msg}` };
  }
}

export const gatewayStep: OnboardStep = {
  name: "Gateway Restart",
  description: "Restarts the OpenClaw gateway so your new configuration takes effect. Without a restart, the gateway uses stale settings.",
  detect,
  run,
};
