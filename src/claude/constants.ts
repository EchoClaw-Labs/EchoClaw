import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";

export const CLAUDE_PROXY_DIR = join(CONFIG_DIR, "claude-proxy");
export const CLAUDE_PROXY_PID_FILE = join(CLAUDE_PROXY_DIR, "proxy.pid");
export const CLAUDE_PROXY_LOG_FILE = join(CLAUDE_PROXY_DIR, "proxy.log");
export const CLAUDE_PROXY_STOPPED_FILE = join(CLAUDE_PROXY_DIR, "proxy.stopped");
export const CLAUDE_PROXY_DEFAULT_PORT = 4101;
export const CLAUDE_CONFIG_BACKUP_DIR = join(CONFIG_DIR, "claude-config-backup");

export function getClaudeDisplayModelLabel(model: string): string {
  return `0G-${model}`;
}
