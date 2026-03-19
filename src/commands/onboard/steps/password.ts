import inquirer from "inquirer";
import { getKeystorePassword } from "../../../utils/env.js";
import { writeAppEnvValue } from "../../../providers/env-resolution.js";
import { runLegacyCleanupWithLog } from "../../../utils/legacy-cleanup.js";
import { writeStderr } from "../../../utils/output.js";
import { colors } from "../../../utils/ui.js";
import { setAutoUpdatePreference } from "../../../update/auto-update-preference.js";
import { retireLegacyUpdateDaemon } from "../../../update/legacy-runtime.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

const MIN_PASSWORD_LENGTH = 8;

function detect(state: OnboardState): StepStatus {
  // getKeystorePassword() resolves from process.env first, then app .env.
  const pw = getKeystorePassword();
  if (pw) {
    state.passwordSet = true;
    return { configured: true, summary: "ECHO_KEYSTORE_PASSWORD is set" };
  }

  return { configured: false, summary: "Keystore password not configured" };
}

async function run(state: OnboardState): Promise<StepResult> {
  const { password } = await inquirer.prompt([{
    type: "password",
    name: "password",
    message: "Choose a keystore password (min 8 chars):",
    mask: "*",
    validate: (input: string) =>
      input.length >= MIN_PASSWORD_LENGTH || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  }]);

  const { confirm } = await inquirer.prompt([{
    type: "password",
    name: "confirm",
    message: "Confirm password:",
    mask: "*",
    validate: (input: string) =>
      input === password || "Passwords do not match",
  }]);

  // Ask about auto-update
  const { autoUpdate } = await inquirer.prompt([{
    type: "confirm",
    name: "autoUpdate",
    message: "Enable auto-update checks?",
    default: true,
  }]);

  // Save to app .env (chmod 600)
  const pwPath = writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password);
  const autoUpdatePath = setAutoUpdatePreference(autoUpdate);
  const cleanup = await retireLegacyUpdateDaemon({ waitMs: 1000 });
  if (autoUpdate) {
    writeStderr(colors.muted("  Auto-update enabled for CLI use, including headless"));
  } else {
    writeStderr(colors.muted("  Auto-update disabled"));
  }
  writeStderr(colors.muted(`  Saved to: ${pwPath} (chmod 600)`));
  writeStderr(colors.muted(`  Auto-update saved to: ${autoUpdatePath}`));
  if (cleanup.warnings.length > 0) {
    for (const warning of cleanup.warnings) {
      writeStderr(colors.warn(`  Warning: ${warning}`));
    }
  }

  // Set in current process so wallet step can use it
  process.env.ECHO_KEYSTORE_PASSWORD = password;
  state.passwordSet = true;

  // Clean up legacy echoclaw() function from shell rc files (if present)
  runLegacyCleanupWithLog();

  return {
    action: cleanup.warnings.length === 0
      ? "configured"
      : "configured_with_warning",
    message: "Keystore password saved to .env",
  };
}

export const passwordStep: OnboardStep = {
  name: "Keystore Password",
  description: "Sets a master password that encrypts your private key on disk. Without it, nobody can sign transactions — even if they access your server.",
  detect,
  run,
};
