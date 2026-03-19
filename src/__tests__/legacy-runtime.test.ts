import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(
  tmpdir(),
  `echoclaw-legacy-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);
const appEnvPath = join(testDir, "app", ".env");
const updateDir = join(testDir, "update");
const stoppedFile = join(updateDir, "update.stopped");

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: testDir,
  ENV_FILE: appEnvPath,
}));

vi.mock("../update/constants.js", () => ({
  UPDATE_DIR: updateDir,
  UPDATE_PID_FILE: join(updateDir, "update.pid"),
  UPDATE_SHUTDOWN_FILE: join(updateDir, "update.shutdown"),
  UPDATE_STOPPED_FILE: stoppedFile,
  UPDATE_STATE_FILE: join(updateDir, "update-state.json"),
  UPDATE_LOG_FILE: join(updateDir, "update.log"),
}));

function writeEnvValue(target: string, key: string, value: string): string {
  mkdirSync(dirname(target), { recursive: true });
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedValue = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const line = `${key}=${quotedValue}`;
  const content = existsSync(target) ? readFileSync(target, "utf-8") : "";
  const regex = new RegExp(`^${escapedKey}=.*$`, "m");
  const updated = regex.test(content)
    ? content.replace(regex, line)
    : content.trimEnd() + `\n${line}\n`;
  writeFileSync(target, updated, { mode: 0o600 });
  return target;
}

const { retireLegacyUpdateDaemon, detectLegacyUpdateArtifacts } = await import("../update/legacy-runtime.js");
const { readEnvValue } = await import("../providers/env-resolution.js");

function ensureDirs(): void {
  mkdirSync(join(testDir, "app"), { recursive: true });
  mkdirSync(updateDir, { recursive: true });
}

describe("retireLegacyUpdateDaemon", () => {
  const origEnv = process.env.ECHO_AUTO_UPDATE;

  beforeEach(() => {
    delete process.env.ECHO_AUTO_UPDATE;
    ensureDirs();
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.ECHO_AUTO_UPDATE = origEnv;
    else delete process.env.ECHO_AUTO_UPDATE;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("removes legacy stopped marker without migrating a preference", async () => {
    writeFileSync(stoppedFile, "", "utf-8");

    await retireLegacyUpdateDaemon();

    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBeNull();
    expect(existsSync(stoppedFile)).toBe(false);
  });

  it("keeps explicit env preference authoritative while removing the legacy marker", async () => {
    writeEnvValue(appEnvPath, "ECHO_AUTO_UPDATE", "1");
    writeFileSync(stoppedFile, "", "utf-8");

    await retireLegacyUpdateDaemon();

    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBe("1");
    expect(existsSync(stoppedFile)).toBe(false);
  });
});

describe("detectLegacyUpdateArtifacts", () => {
  beforeEach(() => {
    ensureDirs();
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("reports legacy files when they exist", () => {
    writeFileSync(stoppedFile, "", "utf-8");
    const result = detectLegacyUpdateArtifacts();
    expect(result.detected).toBe(true);
    expect(result.stoppedFileExists).toBe(true);
    expect(result.daemonRunning).toBe(false);
  });
});
