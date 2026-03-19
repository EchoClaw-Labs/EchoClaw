/**
 * Docker detection utility.
 *
 * Provides both sync (CLI) and async (launcher) versions.
 * Async version uses execFile to avoid blocking the event loop.
 */

import { execSync, execFile } from "node:child_process";
import { platform } from "node:os";

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  composeAvailable: boolean;
  version: string | null;
}

/** Sync version — for CLI use only (agent-cmd.ts). */
export function checkDocker(): DockerStatus {
  let installed = false;
  let running = false;
  let composeAvailable = false;
  let version: string | null = null;

  try {
    const v = execSync("docker --version", { stdio: "pipe", timeout: 5_000 }).toString().trim();
    installed = true;
    version = v.replace(/^Docker version\s*/i, "").split(",")[0] ?? v;
  } catch { /* */ }

  if (!installed) return { installed, running, composeAvailable, version };

  try { execSync("docker info", { stdio: "ignore", timeout: 5_000 }); running = true; } catch { /* */ }
  try { execSync("docker compose version", { stdio: "ignore", timeout: 5_000 }); composeAvailable = true; } catch { /* */ }

  return { installed, running, composeAvailable, version };
}

/** Async version — for launcher handler (non-blocking). */
export async function checkDockerAsync(): Promise<DockerStatus> {
  let installed = false;
  let running = false;
  let composeAvailable = false;
  let version: string | null = null;

  try {
    const v = await execAsync("docker", ["--version"]);
    installed = true;
    version = v.replace(/^Docker version\s*/i, "").split(",")[0] ?? v;
  } catch { /* */ }

  if (!installed) return { installed, running, composeAvailable, version };

  try { await execAsync("docker", ["info"]); running = true; } catch { /* */ }
  try { await execAsync("docker", ["compose", "version"]); composeAvailable = true; } catch { /* */ }

  return { installed, running, composeAvailable, version };
}

function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export function getDockerInstallUrl(): string {
  const p = platform();
  if (p === "win32") return "https://docs.docker.com/desktop/setup/install/windows-install/";
  if (p === "darwin") return "https://docs.docker.com/desktop/setup/install/mac-install/";
  return "https://docs.docker.com/engine/install/";
}

export function formatDockerError(status: DockerStatus): string {
  if (!status.installed) {
    return [
      "Docker is not installed.",
      "",
      "Echo Agent requires Docker to run its isolated stack",
      "(agent + postgres + search + web scraper).",
      "",
      `Install Docker: ${getDockerInstallUrl()}`,
      "",
      "After installing, run: echoclaw echo agent start",
    ].join("\n");
  }

  if (!status.running) {
    return [
      "Docker is installed but not running.",
      "",
      "Start Docker Desktop (or the docker daemon) and try again.",
    ].join("\n");
  }

  if (!status.composeAvailable) {
    return "Docker Compose plugin is not available. Install it: https://docs.docker.com/compose/install/";
  }

  return "";
}
