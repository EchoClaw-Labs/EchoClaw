import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";
import { AGENT_DEFAULT_PORT, PACKAGE_ROOT } from "./constants.js";

const DEFAULT_AGENT_IMAGE_REPOSITORY = "ghcr.io/echoclaw-labs/echoclaw/echo-agent";
const DEFAULT_COMPOSE_TIMEOUT_MS = 300_000;
const OUTPUT_TAIL_LINES = 40;
const RELEASE_IMAGE_FAILURE_PATTERNS = [
  /error from registry:\s*denied/i,
  /pull access denied/i,
  /requested access to the resource is denied/i,
  /manifest unknown/i,
  /failed to resolve reference/i,
  /repository does not exist/i,
];

export const AGENT_PROJECT_NAME = "echo-agent";
export const AGENT_COMPOSE_FILE = join(PACKAGE_ROOT, "docker", "echo-agent", "docker-compose.yml");
export const AGENT_BUILD_COMPOSE_FILE = join(PACKAGE_ROOT, "docker", "echo-agent", "docker-compose.build.yml");

let cachedPackageVersion: string | null = null;

function getPackageVersionFromDisk(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "latest";
  } catch {
    return "latest";
  }
}

function trimOutput(output: string | null | undefined): string | null {
  if (!output) return null;
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return lines.slice(-OUTPUT_TAIL_LINES).join("\n");
}

function getFailureDetail(stdout: string | null | undefined, stderr: string | null | undefined): string | null {
  return trimOutput(stderr) ?? trimOutput(stdout);
}

export class AgentComposeError extends Error {
  constructor(
    message: string,
    readonly detail: string | null = null,
  ) {
    super(detail ? `${message}\n${detail}` : message);
    this.name = "AgentComposeError";
  }
}

export interface AgentComposeFailureInfo {
  detail: string | null;
  message: string;
  hint?: string;
  isReleaseIssue: boolean;
}

export function getAgentPackageVersion(): string {
  if (!cachedPackageVersion) {
    cachedPackageVersion = getPackageVersionFromDisk();
  }
  return cachedPackageVersion;
}

export function getAgentImageRepository(): string {
  return process.env.ECHO_AGENT_IMAGE_REPOSITORY?.trim() || DEFAULT_AGENT_IMAGE_REPOSITORY;
}

export function getAgentImageTag(): string {
  return process.env.ECHO_AGENT_IMAGE_TAG?.trim() || getAgentPackageVersion();
}

export function getAgentImage(): string {
  return process.env.ECHO_AGENT_IMAGE?.trim() || `${getAgentImageRepository()}:${getAgentImageTag()}`;
}

function getDefaultPublishedAgentImage(): string {
  return `${DEFAULT_AGENT_IMAGE_REPOSITORY}:${getAgentPackageVersion()}`;
}

function isDefaultPublishedAgentImage(image: string): boolean {
  return image === getDefaultPublishedAgentImage();
}

function isReleaseImageUnavailable(detail: string | null, image: string): boolean {
  if (!detail || !isDefaultPublishedAgentImage(image)) {
    return false;
  }

  return RELEASE_IMAGE_FAILURE_PATTERNS.some((pattern) => pattern.test(detail));
}

export function getAgentComposeFailureInfo(
  err: unknown,
  options: { defaultHint?: string } = {},
): AgentComposeFailureInfo {
  const detail =
    err instanceof AgentComposeError && err.detail
      ? err.detail
      : err instanceof Error
        ? err.message
        : String(err);
  const image = getAgentImage();

  if (isReleaseImageUnavailable(detail, image)) {
    return {
      detail,
      isReleaseIssue: true,
      message: `Agent image ${image} is not publicly available for package version ${getAgentPackageVersion()}.`,
      hint: `This npm release is incomplete. Ask the maintainer to publish the matching public GHCR image, or try again later.${detail ? `\n\nDocker output:\n${detail}` : ""}`,
    };
  }

  return {
    detail,
    isReleaseIssue: false,
    message: detail ? `Docker compose failed: ${detail}` : "Docker compose failed.",
    hint: options.defaultHint,
  };
}

export function getAgentConfigDir(): string {
  return process.env.ECHO_CONFIG_DIR?.trim() || CONFIG_DIR;
}

export function getAgentComposeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ECHO_AGENT_IMAGE: getAgentImage(),
    ECHO_CONFIG_DIR: getAgentConfigDir(),
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    env[key] = value;
  }

  return env;
}

export function getAgentComposeArgs(
  args: string[],
  options: { includeBuildOverride?: boolean } = {},
): string[] {
  const composeArgs = ["compose", "-f", AGENT_COMPOSE_FILE];
  if (options.includeBuildOverride) {
    composeArgs.push("-f", AGENT_BUILD_COMPOSE_FILE);
  }
  composeArgs.push("-p", AGENT_PROJECT_NAME, ...args);
  return composeArgs;
}

export function runAgentCompose(
  args: string[],
  options: {
    envOverrides?: Record<string, string | undefined>;
    includeBuildOverride?: boolean;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
  } = {},
): string {
  const stdio = options.stdio ?? "pipe";
  const result = spawnSync("docker", getAgentComposeArgs(args, { includeBuildOverride: options.includeBuildOverride }), {
    encoding: "utf8",
    env: getAgentComposeEnv(options.envOverrides),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? DEFAULT_COMPOSE_TIMEOUT_MS,
  });

  if (stdio === "inherit") {
    if (typeof result.stdout === "string" && result.stdout.length > 0) {
      process.stdout.write(result.stdout);
    }
    if (typeof result.stderr === "string" && result.stderr.length > 0) {
      process.stderr.write(result.stderr);
    }
  }

  if (result.error) {
    throw new AgentComposeError("Docker compose failed.", result.error.message);
  }

  if ((result.status ?? 0) !== 0) {
    throw new AgentComposeError(
      "Docker compose failed.",
      getFailureDetail(result.stdout, result.stderr),
    );
  }

  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

export function isAgentRunning(): boolean {
  try {
    const output = runAgentCompose(["ps", "--format", "json", "--status", "running"], { timeoutMs: 10_000 });
    return output.includes("\"agent\"") || output.includes("\"Service\":\"agent\"");
  } catch {
    return false;
  }
}

export function getAgentUrl(port = AGENT_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export async function waitForAgentHealth(
  port = AGENT_DEFAULT_PORT,
  options: {
    attempts?: number;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 2_000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const res = await fetch(`${getAgentUrl(port)}/api/agent/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return true;
    } catch {
      // Agent not ready yet.
    }
  }

  return false;
}
