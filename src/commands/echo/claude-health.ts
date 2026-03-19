import { existsSync, readFileSync } from "node:fs";
import { CLAUDE_PROXY_DEFAULT_PORT, CLAUDE_PROXY_LOG_FILE, CLAUDE_PROXY_PID_FILE } from "../../claude/constants.js";
import { loadConfig } from "../../config/store.js";
import { isDaemonAlive } from "../../utils/daemon-spawn.js";
import { getSettingsPath } from "../claude/config-cmd.js";

export interface ClaudeProxyHealth {
  configured: boolean;
  running: boolean;
  healthy: boolean;
  pid: number | null;
  port: number;
  authConfigured: boolean;
  provider: string | null;
  model: string | null;
  providerEndpoint: string | null;
  logFile: string;
  settings: {
    projectLocal: { path: string; exists: boolean };
    projectShared: { path: string; exists: boolean };
    user: { path: string; exists: boolean };
  };
}

function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function getClaudeProxyHealth(): Promise<ClaudeProxyHealth> {
  const cfg = loadConfig();
  const configured = !!cfg.claude;
  const port = cfg.claude?.proxyPort ?? CLAUDE_PROXY_DEFAULT_PORT;
  const running = isDaemonAlive(CLAUDE_PROXY_PID_FILE);
  const pid = running ? readPid(CLAUDE_PROXY_PID_FILE) : null;
  const authConfigured = !!process.env.ZG_CLAUDE_AUTH_TOKEN;

  let healthy = false;
  if (running) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      healthy = res.ok;
    } catch {
      healthy = false;
    }
  }

  return {
    configured,
    running,
    healthy,
    pid,
    port,
    authConfigured,
    provider: cfg.claude?.provider ?? null,
    model: cfg.claude?.model ?? null,
    providerEndpoint: cfg.claude?.providerEndpoint ?? null,
    logFile: CLAUDE_PROXY_LOG_FILE,
    settings: {
      projectLocal: {
        path: getSettingsPath("project-local"),
        exists: existsSync(getSettingsPath("project-local")),
      },
      projectShared: {
        path: getSettingsPath("project-shared"),
        exists: existsSync(getSettingsPath("project-shared")),
      },
      user: {
        path: getSettingsPath("user"),
        exists: existsSync(getSettingsPath("user")),
      },
    },
  };
}
