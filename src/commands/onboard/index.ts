import { Command } from "commander";
import inquirer from "inquirer";
import { isHeadless, writeStderr } from "../../utils/output.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { colors, successBox } from "../../utils/ui.js";
import { renderBatBanner } from "../../utils/banner.js";
import type { OnboardState, OnboardStep } from "./types.js";

import { configStep } from "./steps/config.js";
import { openclawStep } from "./steps/openclaw.js";
import { passwordStep } from "./steps/password.js";
import { webhooksStep } from "./steps/webhooks.js";
import { walletStep } from "./steps/wallet.js";
import { computeStep } from "./steps/compute.js";
import { monitorStep } from "./steps/monitor.js";
import { gatewayStep } from "./steps/gateway.js";

// ── Helpers ────────────────────────────────────────────

function makeState(): OnboardState {
  return {
    configInitialized: false,
    openclawLinked: false,
    passwordSet: false,
    webhooksConfigured: false,
    walletAddress: null,
    hasKeystore: false,
    computeReady: false,
    selectedProvider: null,
    monitorRunning: false,
    gatewayRestarted: false,
  };
}

function divider(): void {
  writeStderr(colors.muted("  " + "·".repeat(58)));
}

function progressDots(
  steps: OnboardStep[],
  currentIdx: number,
  completed: Set<number>,
  skipped: Set<number>,
): string {
  return steps
    .map((_, i) => {
      if (completed.has(i)) return colors.success("●");
      if (skipped.has(i)) return colors.muted("○");
      if (i === currentIdx) return colors.info("◆");
      return colors.muted("○");
    })
    .join(" ");
}

function stepHeader(
  step: OnboardStep,
  idx: number,
  total: number,
  steps: OnboardStep[],
  completed: Set<number>,
  skipped: Set<number>,
): void {
  writeStderr("");
  divider();
  writeStderr(
    `  ${colors.bold(`Step ${idx + 1} of ${total}`)} ${colors.muted("·")} ${colors.info(step.name)}    ${progressDots(steps, idx, completed, skipped)}`
  );
  writeStderr(`  ${colors.muted(step.description)}`);
  writeStderr("");
}

// ── Core onboard flow (OpenClaw) ──────────────────────

export async function runOpenclawOnboard(): Promise<void> {
  writeStderr("");
  await renderBatBanner({
    subtitle: "OpenClaw Setup",
    description: "Set up everything you need to run EchoClaw on the 0G Network.\n  Each step can be skipped or reconfigured later.",
  });

  const state = makeState();
  const completed = new Set<number>();
  const skipped = new Set<number>();

  const steps: OnboardStep[] = [
    configStep,
    openclawStep,
    passwordStep,
    webhooksStep,
    walletStep,
    computeStep,
    monitorStep,
    gatewayStep,
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const status = await step.detect(state);

    stepHeader(step, i, steps.length, steps, completed, skipped);

    writeStderr(
      status.configured
        ? `  ${colors.success("✓")} ${status.summary}`
        : `  ${colors.warn("○")} ${status.summary}`
    );
    if (status.warning) {
      writeStderr(`  ${colors.warn("⚠")} ${colors.warn(status.warning)}`);
    }
    writeStderr("");

    if (status.configured) {
      const { action } = await inquirer.prompt([{
        type: "list",
        name: "action",
        message: `${step.name} is already configured. What would you like to do?`,
        choices: [
          { name: "Keep current (continue)", value: "skip" },
          { name: "Reconfigure", value: "reconfig" },
        ],
      }]);
      if (action === "skip") {
        completed.add(i);
        writeStderr(colors.muted("  Keeping current configuration."));
        continue;
      }
    } else {
      const { proceed } = await inquirer.prompt([{
        type: "confirm",
        name: "proceed",
        message: `Set up ${step.name}?`,
        default: true,
      }]);
      if (!proceed) {
        skipped.add(i);
        writeStderr(colors.muted("  Skipped."));
        continue;
      }
    }

    try {
      const result = await step.run(state);
      if (result.action === "configured") {
        completed.add(i);
        writeStderr(colors.success(`  ✓ ${result.message}`));
      } else if (result.action === "configured_with_warning") {
        completed.add(i);
        writeStderr(colors.warn(`  ⚠ ${result.message}`));
      } else if (result.action === "skipped") {
        skipped.add(i);
        writeStderr(colors.muted(`  ${result.message}`));
      } else if (result.action === "failed") {
        writeStderr(colors.error(`  ✗ ${result.message}`));
        const { cont } = await inquirer.prompt([{
          type: "confirm",
          name: "cont",
          message: "Continue with remaining steps?",
          default: true,
        }]);
        if (!cont) break;
      }
    } catch (err) {
      const msg = err instanceof EchoError
        ? `${err.message}${err.hint ? `\n  Hint: ${err.hint}` : ""}`
        : err instanceof Error ? err.message : String(err);
      writeStderr(colors.error(`  ✗ ${msg}`));

      const { cont } = await inquirer.prompt([{
        type: "confirm",
        name: "cont",
        message: "Continue with remaining steps?",
        default: true,
      }]);
      if (!cont) break;
    }
  }

  // ── Final summary ──

  writeStderr("");
  divider();
  writeStderr("");

  const summaryLines = [
    `  ${state.configInitialized ? colors.success("●") : colors.warn("○")}  Config        ${state.configInitialized ? colors.success("OK") : colors.warn("Not configured")}`,
    `  ${state.openclawLinked ? colors.success("●") : colors.warn("○")}  OpenClaw      ${state.openclawLinked ? colors.success("Linked") : colors.warn("Not linked")}`,
    `  ${state.passwordSet ? colors.success("●") : colors.warn("○")}  Password      ${state.passwordSet ? colors.success("Set") : colors.warn("Not set")}`,
    `  ${state.webhooksConfigured ? colors.success("●") : colors.muted("○")}  Notifications ${state.webhooksConfigured ? colors.success("Configured") : colors.muted("Skipped")}`,
    `  ${state.walletAddress ? colors.success("●") : colors.warn("○")}  Wallet        ${state.walletAddress ? colors.success(state.walletAddress) : colors.warn("Not created")}`,
    `  ${state.computeReady ? colors.success("●") : colors.warn("○")}  0G Compute    ${state.computeReady ? colors.success("OK") : colors.warn("Not configured")}`,
    `  ${state.monitorRunning ? colors.success("●") : colors.muted("○")}  Monitor       ${state.monitorRunning ? colors.success("Running") : colors.muted("Not started")}`,
    `  ${state.gatewayRestarted ? colors.success("●") : colors.muted("○")}  Gateway       ${state.gatewayRestarted ? colors.success("Restarted") : colors.muted("Not restarted")}`,
  ].join("\n");

  const nextSteps = state.computeReady
    ? `\n\n${colors.info("Next step:")}\n  Send ${colors.bold("/reset")} in chat`
    : "";

  successBox("Setup Complete", summaryLines + nextSteps);
}

// ── Commands ──────────────────────────────────────────

/**
 * Legacy meta-selector: choose OpenClaw or Claude Code setup.
 */
export function createOnboardCommand(): Command {
  return new Command("onboard")
    .description("Interactive setup wizard — choose OpenClaw or Claude Code (TTY only)")
    .action(async () => {
      if (isHeadless()) {
        throw new EchoError(
          ErrorCodes.ONBOARD_REQUIRES_TTY,
          "The onboard wizard requires an interactive terminal.",
          "Run this command in a TTY terminal. For automation, use individual commands:\n" +
            "  echoclaw config init --json\n" +
            "  echoclaw setup openclaw --json\n" +
            "  echoclaw setup password --from-env --json\n" +
            "  echoclaw wallet create --json  (requires ECHO_ALLOW_WALLET_MUTATION=1)"
        );
      }

      writeStderr("");
      await renderBatBanner({
        subtitle: "Setup Wizard",
        description: "Choose what to set up.",
      });

      const { target } = await inquirer.prompt([{
        type: "list",
        name: "target",
        message: "What do you want to set up?",
        choices: [
          { name: "OpenClaw (EchoClaw agent gateway)", value: "openclaw" },
          { name: "Claude Code (0G inference for Claude)", value: "claude" },
        ],
      }]);

      if (target === "openclaw") {
        await runOpenclawOnboard();
      } else {
        const { runClaudeSetup } = await import("../claude/setup-cmd.js");
        await runClaudeSetup();
      }
    });
}

/**
 * Legacy direct shortcut to OpenClaw onboarding (no meta-selector).
 */
export function createOpenclawCommand(): Command {
  return new Command("openclaw")
    .description("OpenClaw setup wizard — configure EchoClaw agent gateway (TTY only)")
    .action(async () => {
      if (isHeadless()) {
        throw new EchoError(
          ErrorCodes.ONBOARD_REQUIRES_TTY,
          "The openclaw wizard requires an interactive terminal.",
          "Use individual commands for automation."
        );
      }

      await runOpenclawOnboard();
    });
}
