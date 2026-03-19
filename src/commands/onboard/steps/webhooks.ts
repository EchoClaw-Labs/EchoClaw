import { randomBytes } from "node:crypto";
import inquirer from "inquirer";
import { loadOpenclawConfig, patchOpenclawConfig, patchOpenclawSkillEnv, removeOpenclawConfigKey } from "../../../openclaw/config.js";
import { writeStderr } from "../../../utils/output.js";
import { colors } from "../../../utils/ui.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

const SKILL_KEY = "echoclaw";
const DEFAULT_BASE_URL = "http://127.0.0.1:18789";

function detect(state: OnboardState): StepStatus {
  const config = loadOpenclawConfig();
  if (!config) {
    return { configured: false, summary: "OpenClaw config not found" };
  }

  const hooksEnabled = config.hooks?.enabled === true;
  const hooksToken = !!config.hooks?.token;
  const skillEnv = config.skills?.entries?.[SKILL_KEY]?.env ?? {};
  const hasBaseUrl = !!skillEnv.OPENCLAW_HOOKS_BASE_URL;
  const hasToken = !!skillEnv.OPENCLAW_HOOKS_TOKEN;

  if (hooksEnabled && hooksToken && hasBaseUrl && hasToken) {
    state.webhooksConfigured = true;
    return { configured: true, summary: "Webhooks enabled (gateway + skill env)" };
  }

  if (hooksEnabled || hasBaseUrl) {
    return { configured: false, summary: "Webhooks partially configured" };
  }

  return { configured: false, summary: "Webhooks not configured (optional)" };
}

async function run(state: OnboardState): Promise<StepResult> {
  const { baseUrl } = await inquirer.prompt([{
    type: "input",
    name: "baseUrl",
    message: "OpenClaw gateway base URL:",
    default: DEFAULT_BASE_URL,
  }]);

  // Generate or input shared secret
  const { tokenChoice } = await inquirer.prompt([{
    type: "list",
    name: "tokenChoice",
    message: "Shared webhook token:",
    choices: [
      { name: "Generate random token (recommended)", value: "generate" },
      { name: "Enter custom token", value: "custom" },
    ],
  }]);

  let sharedToken: string;
  if (tokenChoice === "generate") {
    sharedToken = randomBytes(32).toString("hex");
    writeStderr(colors.muted(`  Generated token: ${sharedToken.slice(0, 8)}...`));
  } else {
    const { customToken } = await inquirer.prompt([{
      type: "password",
      name: "customToken",
      message: "Enter shared token:",
      mask: "*",
      validate: (input: string) => input.length >= 16 || "Token must be at least 16 characters",
    }]);
    sharedToken = customToken;
  }

  // Optional: agent ID and channel
  const { agentId } = await inquirer.prompt([{
    type: "input",
    name: "agentId",
    message: "Agent ID (optional, press Enter to skip):",
    default: "",
  }]);

  const { channel } = await inquirer.prompt([{
    type: "input",
    name: "channel",
    message: "Channel (optional, press Enter to skip):",
    default: "",
  }]);

  const { to } = await inquirer.prompt([{
    type: "input",
    name: "to",
    message: "Recipient (Telegram chat ID / phone, optional, press Enter to skip):",
    default: "",
  }]);

  // Warn about missing routing
  if (!channel && !to) {
    writeStderr(colors.warn("  Warning: no channel or recipient set."));
    writeStderr(colors.warn("  Webhooks will be accepted by the gateway but may not be delivered."));
    writeStderr(colors.muted("  You can set these later with: echoclaw setup openclaw-hooks --channel <ch> --to <id> --force"));
    writeStderr("");
  } else if (!channel || !to) {
    const missing = !channel ? "channel" : "recipient (to)";
    writeStderr(colors.warn(`  Warning: ${missing} not set — delivery may use defaults from main session.`));
    writeStderr("");
  }

  // 1. Patch gateway config: per-key to preserve existing hooks.* keys
  patchOpenclawConfig("hooks.enabled", true, { force: true });
  patchOpenclawConfig("hooks.token", sharedToken, { force: true });
  patchOpenclawConfig("hooks.defaultSessionKey", "hook:alerts", { force: false });

  // 2. Patch skill env
  const skillEnv: Record<string, string> = {
    OPENCLAW_HOOKS_BASE_URL: baseUrl,
    OPENCLAW_HOOKS_TOKEN: sharedToken,
    OPENCLAW_HOOKS_INCLUDE_GUARDRAIL: "1",
  };
  if (agentId) skillEnv.OPENCLAW_HOOKS_AGENT_ID = agentId;
  if (channel) skillEnv.OPENCLAW_HOOKS_CHANNEL = channel;
  if (to) skillEnv.OPENCLAW_HOOKS_TO = to;

  const patchResult = patchOpenclawSkillEnv(SKILL_KEY, skillEnv, { force: true });

  writeStderr(colors.muted(`  Gateway: hooks.enabled=true, hooks.token set, defaultSessionKey=hook:alerts`));
  writeStderr(colors.muted(`  Skill env: ${patchResult.keysSet.join(", ")}`));

  // 3. Remove gateway.auth.token from config if OPENCLAW_GATEWAY_TOKEN is in env
  //    (prevents WS auth mismatch — server reads config-first, client reads env-first)
  const envGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (envGatewayToken) {
    const cfgReloaded = loadOpenclawConfig();
    const configGatewayToken = cfgReloaded?.gateway?.auth?.token as string | undefined;
    if (configGatewayToken && configGatewayToken !== envGatewayToken) {
      removeOpenclawConfigKey("gateway.auth.token");
      writeStderr(colors.warn("  Removed gateway.auth.token from config (env var is the source of truth)"));
    }
  }

  state.webhooksConfigured = true;

  return {
    action: "configured",
    message: "Webhooks configured (gateway + skill env)",
  };
}

export const webhooksStep: OnboardStep = {
  name: "Notifications",
  description: "Enables real-time alerts in your chat — order fills from MarketMaker, low balance warnings from the monitor. Without this, your agent works silently (no notifications).",
  detect,
  run,
};
