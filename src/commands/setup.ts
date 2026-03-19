import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import inquirer from "inquirer";
import { EchoError, ErrorCodes } from "../errors.js";
import { respond } from "../utils/respond.js";
import { patchOpenclawSkillEnv, patchOpenclawConfig, getSkillHooksEnv, loadOpenclawConfig, removeOpenclawConfigKey } from "../openclaw/config.js";
import { getKeystorePassword } from "../utils/env.js";
import { runLegacyCleanupWithLog } from "../utils/legacy-cleanup.js";
import { isHeadless, writeJsonSuccess } from "../utils/output.js";
import { successBox, warnBox, infoBox, colors } from "../utils/ui.js";
import { linkOpenclawSkill } from "../setup/openclaw-link.js";
import { ENV_FILE } from "../config/paths.js";
import { readEnvValue, writeAppEnvValue } from "../providers/env-resolution.js";
import { setAutoUpdatePreference } from "../update/auto-update-preference.js";
import { retireLegacyUpdateDaemon } from "../update/legacy-runtime.js";
import { handleSkillInstall } from "./skill.js";
import {
  validateHooksTokenSync,
  buildMonitorAlertPayload,
  buildMarketMakerPayload,
  sendTestWebhook,
  type OpenClawHooksConfig,
  type WebhookPayloadPreview,
} from "../openclaw/hooks-client.js";

function isInsideContainer(): boolean {
  if (existsSync("/.dockerenv")) return true;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

function restartInstructions(): string {
  if (isInsideContainer()) {
    return (
      `  1. Exit container and run from host:\n` +
      `     ${colors.bold("docker compose -f ~/openclaw/docker-compose.yml restart")}\n` +
      `  2. Re-enter container and restore monitor:\n` +
      `     ${colors.bold("echoclaw 0g-compute monitor start --from-state --daemon")}\n` +
      `  3. Send ${colors.bold("/restart")} in chat`
    );
  }
  return (
    `  1. Restart gateway: ${colors.bold("openclaw gateway restart")}\n` +
    `  2. Send ${colors.bold("/restart")} in chat`
  );
}

export function createSetupCommand(): Command {
  const setup = new Command("setup").description("Setup and integration commands");

  setup
    .command("openclaw")
    .description("Link EchoClaw skill into OpenClaw skills directory")
    .option("--force", "Overwrite existing skill directory")
    .action((opts: { force?: boolean }) => {
      const result = linkOpenclawSkill("echoclaw", opts);

      respond({
        data: {
          source: result.source,
          target: result.target,
          linkType: result.linkType,
          workspaceTarget: result.workspaceTarget,
          workspaceLinked: result.workspaceLinked,
        },
        ui: {
          type: "success",
          title: "OpenClaw Skill Linked",
          body:
            `${result.linkType === "copy" ? "Copied" : "Symlinked"} skill to ${result.target}` +
            (result.workspaceLinked ? `\nWorkspace link: ${result.workspaceTarget}` : ""),
        },
      });
    });

  setup
    .command("provider")
    .description("Install echoclaw skill to AI agent platform (alias for: echoclaw skill install)")
    .option("--provider <name>", "Provider: openclaw, claude, claude-code, codex, other")
    .option("--scope <scope>", "Install scope: user (default) or project", "user")
    .option("--force", "Overwrite existing skill installation")
    .action(handleSkillInstall);

  // echoclaw setup password
  setup
    .command("password")
    .description("Save ECHO_KEYSTORE_PASSWORD to ~/.config/echoclaw/.env")
    .option("--from-env", "Read password from ECHO_KEYSTORE_PASSWORD env var")
    .option("--password <password>", "Provide password directly (less secure — visible in shell history)")
    .option("--force", "Overwrite existing password")
    .option("--auto-update", "Also set ECHO_AUTO_UPDATE=1")
    .action(async (opts: { fromEnv?: boolean; password?: string; force?: boolean; autoUpdate?: boolean }) => {
      // 1. Determine password source: --password > --from-env > TTY prompt
      let password: string | undefined;

      if (opts.password) {
        password = opts.password;
      } else if (opts.fromEnv) {
        password = getKeystorePassword() ?? undefined;
        if (!password) {
          throw new EchoError(
            ErrorCodes.KEYSTORE_PASSWORD_NOT_SET,
            "ECHO_KEYSTORE_PASSWORD environment variable is not set.",
            "Export it first: export ECHO_KEYSTORE_PASSWORD=\"your-password\""
          );
        }
      } else {
        // TTY prompt
        if (isHeadless()) {
          throw new EchoError(
            ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
            "Password input requires a TTY. Use --from-env or --password in headless mode.",
            "ECHO_KEYSTORE_PASSWORD=pw echoclaw setup password --from-env --json"
          );
        }
        const answers = await inquirer.prompt([
          { type: "password", name: "pw", message: "Enter keystore password:", mask: "*" },
          { type: "password", name: "pwConfirm", message: "Confirm password:", mask: "*" },
        ]);
        if (answers.pw !== answers.pwConfirm) {
          throw new EchoError(
            ErrorCodes.PASSWORD_MISMATCH,
            "Passwords do not match.",
            "Try again with matching passwords."
          );
        }
        password = answers.pw;
      }

      // 2. Validate length
      if (!password || password.length < 8) {
        throw new EchoError(
          ErrorCodes.PASSWORD_TOO_SHORT,
          "Password must be at least 8 characters.",
          "Choose a longer password."
        );
      }

      // 3. Save password to ~/.config/echoclaw/.env (chmod 600)
      const existing = !opts.force
        ? readEnvValue("ECHO_KEYSTORE_PASSWORD", ENV_FILE)
        : null;
      const shouldWritePassword = opts.force || !existing;

      if (!opts.force) {
        if (existing) {
          if (opts.autoUpdate) {
            // continue — caller may only be enabling auto-update
          } else if (isHeadless()) {
            writeJsonSuccess({
              status: "exists",
              path: ENV_FILE,
              keysSet: [],
              keysSkipped: ["ECHO_KEYSTORE_PASSWORD"],
              restartRequired: false,
            });
            return;
          } else {
            infoBox("Already Configured", `Password already set in .env\n\nUse ${colors.info("--force")} to overwrite.`);
            return;
          }
        }
      }

      const passwordPath = shouldWritePassword ? writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", password!) : null;
      let autoUpdatePath: string | null = null;
      let autoUpdateCleanupWarnings: string[] = [];
      if (opts.autoUpdate) {
        autoUpdatePath = setAutoUpdatePreference(true);
        const cleanup = await retireLegacyUpdateDaemon({ waitMs: 1000 });
        autoUpdateCleanupWarnings = cleanup.warnings;
      }

      if (passwordPath != null || autoUpdatePath != null) {
        // Clean up legacy echoclaw() function from shell rc files
        runLegacyCleanupWithLog();
      }

      const keysSet = [
        ...(shouldWritePassword ? ["ECHO_KEYSTORE_PASSWORD"] : []),
        ...(opts.autoUpdate ? ["ECHO_AUTO_UPDATE"] : []),
      ];
      const keysSkipped = shouldWritePassword ? [] : ["ECHO_KEYSTORE_PASSWORD"];
      const restartRequired = passwordPath != null || autoUpdatePath != null;

      if (isHeadless()) {
        writeJsonSuccess({
          status: restartRequired ? "updated" : "exists",
          path: passwordPath ?? ENV_FILE,
          keysSet,
          keysSkipped,
          restartRequired,
          warnings: autoUpdateCleanupWarnings,
        });
      } else {
        const savedPath = passwordPath ?? ENV_FILE;
        const warningLine = autoUpdateCleanupWarnings.length > 0
          ? `\n${colors.warn("Warnings:")}\n  ${autoUpdateCleanupWarnings.join("\n  ")}`
          : "";
        successBox(
          shouldWritePassword ? "Password Saved" : "Auto-Update Updated",
          `Saved to: ${colors.info(savedPath)} ${colors.muted("(chmod 600)")}\n` +
            `Keys set: ${colors.value(keysSet.join(", "))}\n` +
            warningLine +
            `\n${colors.warn("Apply changes:")}\n` +
            restartInstructions()
        );
      }
    });

  // echoclaw setup openclaw-hooks
  setup
    .command("openclaw-hooks")
    .description("Configure OpenClaw webhook ENV vars for MarketMaker notifications")
    .option("--from-env", "Read all vars from OPENCLAW_HOOKS_* env vars")
    .option("--base-url <url>", "Gateway URL (e.g. http://127.0.0.1:18789)")
    .option("--token <token>", "Shared secret (warn: visible in shell history)")
    .option("--agent-id <id>", "Route to specific agent")
    .option("--channel <ch>", "Delivery channel override")
    .option("--to <recipient>", "Recipient override")
    .option("--include-guardrail", "Include GUARDRAIL_EXCEEDED events")
    .option("--session-key <key>", "Set hooks.defaultSessionKey (e.g. hook:alerts)")
    .option("--force", "Overwrite existing keys")
    .action((opts: {
      fromEnv?: boolean;
      baseUrl?: string;
      token?: string;
      agentId?: string;
      channel?: string;
      to?: string;
      includeGuardrail?: boolean;
      sessionKey?: string;
      force?: boolean;
    }) => {
      const envMap: Record<string, string> = {};

      if (opts.fromEnv) {
        // Read from OPENCLAW_HOOKS_* env vars
        const mapping: Record<string, string> = {
          OPENCLAW_HOOKS_BASE_URL: process.env.OPENCLAW_HOOKS_BASE_URL ?? "",
          OPENCLAW_HOOKS_TOKEN: process.env.OPENCLAW_HOOKS_TOKEN ?? "",
          OPENCLAW_HOOKS_AGENT_ID: process.env.OPENCLAW_HOOKS_AGENT_ID ?? "",
          OPENCLAW_HOOKS_CHANNEL: process.env.OPENCLAW_HOOKS_CHANNEL ?? "",
          OPENCLAW_HOOKS_TO: process.env.OPENCLAW_HOOKS_TO ?? "",
          OPENCLAW_HOOKS_INCLUDE_GUARDRAIL: process.env.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL ?? "",
        };
        for (const [key, value] of Object.entries(mapping)) {
          if (value) envMap[key] = value;
        }
      }

      // Explicit flags override env values
      if (opts.baseUrl) envMap.OPENCLAW_HOOKS_BASE_URL = opts.baseUrl;
      if (opts.token) envMap.OPENCLAW_HOOKS_TOKEN = opts.token;
      if (opts.agentId) envMap.OPENCLAW_HOOKS_AGENT_ID = opts.agentId;
      if (opts.channel) envMap.OPENCLAW_HOOKS_CHANNEL = opts.channel;
      if (opts.to) envMap.OPENCLAW_HOOKS_TO = opts.to;
      if (opts.includeGuardrail) envMap.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL = "1";

      // Require at least base-url + token
      if (!envMap.OPENCLAW_HOOKS_BASE_URL || !envMap.OPENCLAW_HOOKS_TOKEN) {
        throw new EchoError(
          ErrorCodes.OPENCLAW_HOOKS_VALIDATION_FAILED,
          "Both --base-url and --token are required (or set OPENCLAW_HOOKS_BASE_URL and OPENCLAW_HOOKS_TOKEN env vars with --from-env).",
          "Example: echoclaw setup openclaw-hooks --base-url http://127.0.0.1:18789 --token <secret>"
        );
      }

      // Patch openclaw.json
      const result = patchOpenclawSkillEnv("echoclaw", envMap, { force: opts.force });
      let configChanged = result.keysSet.length > 0;

      // Sync token to gateway config (hooks.token) — prevents drift
      if (envMap.OPENCLAW_HOOKS_TOKEN) {
        const r1 = patchOpenclawConfig("hooks.token", envMap.OPENCLAW_HOOKS_TOKEN, { force: true });
        const r2 = patchOpenclawConfig("hooks.enabled", true, { force: true });
        if (r1.keysSet.length > 0 || r2.keysSet.length > 0) configChanged = true;
      }

      // Set session key if provided
      if (opts.sessionKey) {
        const r = patchOpenclawConfig("hooks.defaultSessionKey", opts.sessionKey, { force: true });
        if (r.keysSet.length > 0) configChanged = true;
      }

      // Remove gateway.auth.token if it conflicts with OPENCLAW_GATEWAY_TOKEN env
      // (prevents WS 1008 — server reads config-first, client reads env-first)
      const envGwToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      if (envGwToken) {
        const ocConf = loadOpenclawConfig();
        const cfgGwToken = ocConf?.gateway?.auth?.token as string | undefined;
        if (cfgGwToken && cfgGwToken !== envGwToken) {
          removeOpenclawConfigKey("gateway.auth.token");
          configChanged = true;
        }
      }

      // Handle "already configured" case — only if NOTHING changed at all
      if (!configChanged) {
        if (isHeadless()) {
          writeJsonSuccess({
            status: result.status,
            path: result.path,
            keysSet: result.keysSet,
            keysSkipped: result.keysSkipped,
            restartRequired: false,
          });
        } else {
          infoBox(
            "Already Configured",
            `Webhook keys already set in ${result.path}\n\nUse ${colors.info("--force")} to overwrite.`
          );
        }
        return;
      }

      // Success output (never log token values)
      if (isHeadless()) {
        writeJsonSuccess({
          status: result.status,
          path: result.path,
          keysSet: result.keysSet,
          keysSkipped: result.keysSkipped,
          restartRequired: true,
        });
      } else {
        successBox(
          "Webhook Config Saved",
          `Saved to: ${colors.info(result.path)}\n` +
            `Keys set: ${colors.value(result.keysSet.join(", "))}\n` +
            (result.keysSkipped.length > 0
              ? `Keys skipped: ${colors.muted(result.keysSkipped.join(", "))}\n`
              : "") +
            `\n${colors.warn("Apply changes:")}\n` +
            restartInstructions()
        );
      }
    });

  // echoclaw setup test-hooks
  setup
    .command("test-hooks")
    .description("Validate OpenClaw webhook config and simulate monitor/marketmaker payloads")
    .option("--probe-live", "Send real requests to gateway (creates agent turns, consumes tokens)")
    .action(async (opts: { probeLive?: boolean }) => {
      const checks: { name: string; pass: boolean; detail: string }[] = [];

      // 1. Token sync
      const sync = validateHooksTokenSync();
      if (!sync.hooksTokenSet && !sync.skillTokenSet) {
        checks.push({ name: "Token sync", pass: false, detail: "Neither hooks.token nor skill token configured" });
      } else if (!sync.synced) {
        const detail = sync.hooksTokenSet && !sync.skillTokenSet
          ? "hooks.token set but OPENCLAW_HOOKS_TOKEN missing in skill env"
          : !sync.hooksTokenSet && sync.skillTokenSet
            ? "OPENCLAW_HOOKS_TOKEN set in skill env but hooks.token missing — run: echoclaw setup openclaw-hooks --token <tok> --force"
            : "hooks.token and OPENCLAW_HOOKS_TOKEN differ — run: echoclaw setup openclaw-hooks --token <tok> --force";
        checks.push({ name: "Token sync", pass: false, detail });
      } else {
        checks.push({ name: "Token sync", pass: true, detail: "hooks.token and skill env token match" });
      }

      // 2. Gateway token (WS auth for hook delivery)
      const ocConfig = loadOpenclawConfig();
      const envGwToken = process.env.OPENCLAW_GATEWAY_TOKEN;
      const cfgGwToken = ocConfig?.gateway?.auth?.token as string | undefined;
      if (envGwToken && cfgGwToken) {
        if (envGwToken === cfgGwToken) {
          checks.push({ name: "Gateway token", pass: true, detail: "gateway.auth.token matches OPENCLAW_GATEWAY_TOKEN env" });
        } else {
          checks.push({
            name: "Gateway token",
            pass: false,
            detail: "gateway.auth.token in config differs from OPENCLAW_GATEWAY_TOKEN env — hook delivery will fail (WS 1008). Fix: remove gateway.auth.token from openclaw.json",
          });
        }
      } else if (envGwToken && !cfgGwToken) {
        checks.push({ name: "Gateway token", pass: true, detail: "OPENCLAW_GATEWAY_TOKEN in env, no config override (correct)" });
      } else {
        checks.push({ name: "Gateway token", pass: true, detail: "No OPENCLAW_GATEWAY_TOKEN env — using config value only" });
      }

      // 3. Session key
      const sessionKey = ocConfig?.hooks?.defaultSessionKey as string | undefined;
      if (sessionKey) {
        checks.push({ name: "Session key", pass: true, detail: `hooks.defaultSessionKey=${sessionKey}` });
      } else {
        checks.push({ name: "Session key", pass: false, detail: "Not set — each hook gets random session (no context continuity). Fix: set hooks.defaultSessionKey in openclaw.json" });
      }

      // 4. Routing
      const hooksEnv = getSkillHooksEnv();
      const hasBaseUrl = !!hooksEnv.OPENCLAW_HOOKS_BASE_URL;
      const hasToken = !!hooksEnv.OPENCLAW_HOOKS_TOKEN;
      const hasChannel = !!hooksEnv.OPENCLAW_HOOKS_CHANNEL;
      const hasTo = !!hooksEnv.OPENCLAW_HOOKS_TO;

      if (!hasBaseUrl || !hasToken) {
        checks.push({ name: "Config", pass: false, detail: "OPENCLAW_HOOKS_BASE_URL or TOKEN not configured in skill env" });
      } else {
        checks.push({ name: "Config", pass: true, detail: `base_url=${hooksEnv.OPENCLAW_HOOKS_BASE_URL}` });
      }

      if (!hasChannel || !hasTo) {
        const missing = [!hasChannel && "channel", !hasTo && "to"].filter(Boolean).join(", ");
        checks.push({ name: "Routing", pass: false, detail: `Missing: ${missing} — webhooks may be accepted but not delivered` });
      } else {
        checks.push({ name: "Routing", pass: true, detail: `channel=${hooksEnv.OPENCLAW_HOOKS_CHANNEL} to=${hooksEnv.OPENCLAW_HOOKS_TO}` });
      }

      // 3. Dry-run payloads
      const payloads: { name: string; preview: WebhookPayloadPreview }[] = [];
      if (hasBaseUrl && hasToken) {
        const config: OpenClawHooksConfig = {
          baseUrl: hooksEnv.OPENCLAW_HOOKS_BASE_URL!.replace(/\/+$/, ""),
          token: hooksEnv.OPENCLAW_HOOKS_TOKEN!,
          agentId: hooksEnv.OPENCLAW_HOOKS_AGENT_ID || undefined,
          channel: hooksEnv.OPENCLAW_HOOKS_CHANNEL || undefined,
          to: hooksEnv.OPENCLAW_HOOKS_TO || undefined,
          includeGuardrail: hooksEnv.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL === "1",
        };

        const monitorPayload = buildMonitorAlertPayload(config);
        const mmPayload = buildMarketMakerPayload(config);
        payloads.push(
          { name: "BalanceMonitor", preview: monitorPayload },
          { name: "MarketMaker", preview: mmPayload },
        );
        checks.push({ name: "Dry-run: BalanceMonitor", pass: true, detail: "Payload constructed" });
        checks.push({ name: "Dry-run: MarketMaker", pass: true, detail: "Payload constructed" });

        // 4. Live probe (optional)
        if (opts.probeLive) {
          if (!isHeadless()) {
            warnBox(
              "Live Probe Warning",
              "This will create agent turns on the gateway, consume tokens,\nand may produce messages in sessions."
            );
          }

          const monitorResult = await sendTestWebhook(config, monitorPayload.body);
          checks.push({
            name: "Probe: BalanceMonitor",
            pass: monitorResult.ok,
            detail: monitorResult.ok
              ? `Gateway accepted (${monitorResult.status})`
              : `Gateway rejected: ${monitorResult.error}`,
          });

          const mmResult = await sendTestWebhook(config, mmPayload.body);
          checks.push({
            name: "Probe: MarketMaker",
            pass: mmResult.ok,
            detail: mmResult.ok
              ? `Gateway accepted (${mmResult.status})`
              : `Gateway rejected: ${mmResult.error}`,
          });
        }
      }

      // Output
      const allPass = checks.every(c => c.pass);

      if (isHeadless()) {
        writeJsonSuccess({
          checks,
          allPass,
          payloads: payloads.map(p => ({ name: p.name, ...p.preview })),
        });
      } else {
        const lines = checks.map(c =>
          `${c.pass ? colors.success("PASS") : colors.error("FAIL")} ${c.name}: ${c.detail}`
        );

        if (payloads.length > 0) {
          lines.push("");
          for (const p of payloads) {
            lines.push(`${colors.info(`[${p.name}]`)} ${p.preview.url}`);
            lines.push(colors.muted(JSON.stringify(p.preview.body, null, 2)));
          }
        }

        if (allPass) {
          successBox("All Checks Passed", lines.join("\n"));
        } else {
          warnBox("Issues Found", lines.join("\n"));
        }
      }
    });

  return setup;
}
