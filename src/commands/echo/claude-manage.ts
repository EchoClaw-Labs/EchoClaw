import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import inquirer from "inquirer";
import {
  CLAUDE_PROXY_DIR,
  CLAUDE_PROXY_LOG_FILE,
  CLAUDE_PROXY_PID_FILE,
  CLAUDE_PROXY_STOPPED_FILE,
} from "../../claude/constants.js";
import { loadConfig } from "../../config/store.js";
import { spawnClaudeProxy } from "../../utils/daemon-spawn.js";
import { infoBox, successBox, warnBox, colors } from "../../utils/ui.js";
import { getClaudeProxyHealth } from "./state.js";
import { getSettingsPath, injectClaudeSettings, removeClaudeSettings, restoreClaudeSettings } from "../claude/config-cmd.js";
import { runClaudeSetup } from "../claude/setup-cmd.js";
import { printVerify } from "./status.js";

export async function stopClaudeProxyInteractive(): Promise<void> {
  if (!existsSync(CLAUDE_PROXY_PID_FILE)) {
    warnBox("Claude Proxy", "Proxy is not running.");
    return;
  }

  const pid = parseInt(readFileSync(CLAUDE_PROXY_PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    try { unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* ignore */ }
    warnBox("Claude Proxy", "Removed a stale PID file.");
    return;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      process.kill(pid, 0);
    } catch {
      try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* ignore */ }
      mkdirSync(CLAUDE_PROXY_DIR, { recursive: true });
      writeFileSync(CLAUDE_PROXY_STOPPED_FILE, String(Date.now()), "utf-8");
      successBox("Claude Proxy", `Stopped (PID ${pid}).`);
      return;
    }
  }

  try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
  try { if (existsSync(CLAUDE_PROXY_PID_FILE)) unlinkSync(CLAUDE_PROXY_PID_FILE); } catch { /* ignore */ }
  mkdirSync(CLAUDE_PROXY_DIR, { recursive: true });
  writeFileSync(CLAUDE_PROXY_STOPPED_FILE, String(Date.now()), "utf-8");
  warnBox("Claude Proxy", `Force-killed PID ${pid}.`);
}

export async function printClaudeStatus(): Promise<void> {
  const status = await getClaudeProxyHealth();
  const cfg = loadConfig();

  infoBox("Claude Code", [
    `Configured: ${status.configured ? colors.success("yes") : colors.warn("no")}`,
    `Proxy:      ${status.running ? colors.success(`running on ${status.port}`) : colors.warn("stopped")}`,
    `Health:     ${status.healthy ? colors.success("ok") : colors.warn("unreachable")}`,
    `Provider:   ${cfg.claude?.provider ?? colors.muted("not configured")}`,
    `Model:      ${cfg.claude?.model ?? colors.muted("not configured")}`,
    `Settings:   ${status.settings.projectLocal.path}`,
    `Backup:     ${existsSync(getSettingsPath("project-local")) ? "present" : "none"}`,
    `Log:        ${CLAUDE_PROXY_LOG_FILE}`,
  ].join("\n"));
}

export async function runClaudeManageMenu(): Promise<void> {
  while (true) {
    await printClaudeStatus();

    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "Claude Code actions",
      choices: [
        { name: "Show config", value: "show" },
        { name: "Inject config", value: "inject" },
        { name: "Remove EchoClaw config", value: "remove" },
        { name: "Restore previous config", value: "restore" },
        { name: "Start proxy", value: "start" },
        { name: "Stop proxy", value: "stop" },
        { name: "Run proxy health test", value: "test" },
        { name: "Re-run Claude setup", value: "setup" },
        { name: "Back", value: "back" },
      ],
    }]);

    if (action === "back") return;
    if (action === "show") {
      await printClaudeStatus();
      continue;
    }
    if (action === "inject") {
      const cfg = loadConfig();
      const { scope } = await inquirer.prompt([{
        type: "list",
        name: "scope",
        message: "Where should Claude settings be injected?",
        default: "project-local",
        choices: [
          { name: "Project local (.claude/settings.local.json)", value: "project-local" },
          { name: "Project shared (.claude/settings.json)", value: "project-shared" },
          { name: "User (~/.claude/settings.json)", value: "user" },
        ],
      }]);
      const injected = injectClaudeSettings(cfg, scope);
      successBox("Claude Config Injected", `Settings file: ${injected.settingsPath}\nBase URL: http://127.0.0.1:${injected.port}`);
      continue;
    }
    if (action === "remove") {
      const { scope } = await inquirer.prompt([{ type: "list", name: "scope", message: "Scope to clean up", default: "project-local", choices: ["project-local", "project-shared", "user"] }]);
      const result = removeClaudeSettings(scope);
      infoBox("Claude Config Remove", JSON.stringify(result, null, 2));
      continue;
    }
    if (action === "restore") {
      const { scope } = await inquirer.prompt([{ type: "list", name: "scope", message: "Scope to restore", default: "project-local", choices: ["project-local", "project-shared", "user"] }]);
      const restored = restoreClaudeSettings(scope);
      successBox("Claude Config Restored", `Restored ${restored.path}`);
      continue;
    }
    if (action === "start") {
      const result = spawnClaudeProxy();
      if (result.status === "already_running") {
        infoBox("Claude Proxy", "Already running.");
      } else if (result.status === "spawn_failed") {
        warnBox("Claude Proxy", result.error);
      } else {
        successBox("Claude Proxy", `Started (PID ${result.pid})\nLog: ${result.logFile}`);
      }
      continue;
    }
    if (action === "stop") {
      await stopClaudeProxyInteractive();
      continue;
    }
    if (action === "test") {
      await printVerify(false, "claude-code");
      continue;
    }
    if (action === "setup") {
      await runClaudeSetup();
    }
  }
}
