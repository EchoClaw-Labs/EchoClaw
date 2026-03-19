import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(
  tmpdir(),
  `echo-auto-update-pref-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const {
  ensureAutoUpdateDefault,
  getAutoUpdatePreference,
  hasExplicitAutoUpdatePreference,
  hasExplicitNonLegacyAutoUpdatePreference,
  isAutoUpdateEnabled,
  setAutoUpdatePreference,
} = await import("../update/auto-update-preference.js");

const { readEnvValue } = await import("../providers/env-resolution.js");

function ensureDirs(): void {
  mkdirSync(join(testDir, "app"), { recursive: true });
  mkdirSync(updateDir, { recursive: true });
}

describe("getAutoUpdatePreference", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv.ECHO_AUTO_UPDATE = process.env.ECHO_AUTO_UPDATE;
    origEnv.ECHO_DISABLE_UPDATE_CHECK = process.env.ECHO_DISABLE_UPDATE_CHECK;
    delete process.env.ECHO_AUTO_UPDATE;
    delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    ensureDirs();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("returns none when no preference exists", () => {
    expect(getAutoUpdatePreference()).toEqual({
      enabled: false,
      explicit: false,
      source: "none",
      value: null,
    });
  });

  it("prefers ECHO_DISABLE_UPDATE_CHECK over other sources", () => {
    process.env.ECHO_DISABLE_UPDATE_CHECK = "1";
    writeEnvValue(appEnvPath, "ECHO_AUTO_UPDATE", "1");

    expect(getAutoUpdatePreference()).toEqual({
      enabled: false,
      explicit: true,
      source: "disable-flag",
      value: "0",
    });
  });

  it("reads process.env before file sources", () => {
    process.env.ECHO_AUTO_UPDATE = "0";
    writeEnvValue(appEnvPath, "ECHO_AUTO_UPDATE", "1");

    expect(getAutoUpdatePreference()).toEqual({
      enabled: false,
      explicit: true,
      source: "process-env",
      value: "0",
    });
  });

  it("ignores legacy stopped markers when reading the current preference", () => {
    writeFileSync(stoppedFile, "", "utf-8");

    expect(getAutoUpdatePreference()).toEqual({
      enabled: false,
      explicit: false,
      source: "none",
      value: null,
    });
  });
});

describe("explicit preference helpers", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv.ECHO_AUTO_UPDATE = process.env.ECHO_AUTO_UPDATE;
    origEnv.ECHO_DISABLE_UPDATE_CHECK = process.env.ECHO_DISABLE_UPDATE_CHECK;
    delete process.env.ECHO_AUTO_UPDATE;
    delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    ensureDirs();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("does not treat legacy stopped as an explicit preference", () => {
    writeFileSync(stoppedFile, "", "utf-8");

    expect(hasExplicitAutoUpdatePreference()).toBe(false);
    expect(hasExplicitNonLegacyAutoUpdatePreference()).toBe(false);
  });
});

describe("ensureAutoUpdateDefault", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv.ECHO_AUTO_UPDATE = process.env.ECHO_AUTO_UPDATE;
    origEnv.ECHO_DISABLE_UPDATE_CHECK = process.env.ECHO_DISABLE_UPDATE_CHECK;
    delete process.env.ECHO_AUTO_UPDATE;
    delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    ensureDirs();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("seeds ECHO_AUTO_UPDATE=1 when no preference exists", () => {
    ensureAutoUpdateDefault();
    expect(process.env.ECHO_AUTO_UPDATE).toBe("1");
    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBe("1");
    // Mirror write removed — only app env is written now
  });

  it("does not override explicit opt-out", () => {
    process.env.ECHO_AUTO_UPDATE = "0";
    ensureAutoUpdateDefault();
    expect(process.env.ECHO_AUTO_UPDATE).toBe("0");
    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBeNull();
  });

  it("still seeds when only legacy stopped exists", () => {
    writeFileSync(stoppedFile, "", "utf-8");
    ensureAutoUpdateDefault();
    expect(process.env.ECHO_AUTO_UPDATE).toBe("1");
  });

  it("does not seed when checks are globally disabled", () => {
    process.env.ECHO_DISABLE_UPDATE_CHECK = "1";
    ensureAutoUpdateDefault();
    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBeNull();
  });

  it("is idempotent on repeated calls", () => {
    ensureAutoUpdateDefault();
    const firstContent = existsSync(appEnvPath) ? readFileSync(appEnvPath, "utf-8") : "";
    ensureAutoUpdateDefault();
    const secondContent = existsSync(appEnvPath) ? readFileSync(appEnvPath, "utf-8") : "";
    expect(firstContent).toBe(secondContent);
  });

  it("writes only the app env file", () => {
    ensureAutoUpdateDefault();
    expect(process.env.ECHO_AUTO_UPDATE).toBe("1");
    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBe("1");
  });
});

describe("setAutoUpdatePreference", () => {
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

  it("writes the preference to app env and process.env", () => {
    const result = setAutoUpdatePreference(false);

    expect(typeof result).toBe("string");
    expect(process.env.ECHO_AUTO_UPDATE).toBe("0");
    expect(readEnvValue("ECHO_AUTO_UPDATE", appEnvPath)).toBe("0");
  });
});

describe("isAutoUpdateEnabled", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv.ECHO_AUTO_UPDATE = process.env.ECHO_AUTO_UPDATE;
    origEnv.ECHO_DISABLE_UPDATE_CHECK = process.env.ECHO_DISABLE_UPDATE_CHECK;
    delete process.env.ECHO_AUTO_UPDATE;
    delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    ensureDirs();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("returns true when ECHO_AUTO_UPDATE=1", () => {
    process.env.ECHO_AUTO_UPDATE = "1";
    expect(isAutoUpdateEnabled()).toBe(true);
  });

  it("returns false when ECHO_AUTO_UPDATE=0", () => {
    process.env.ECHO_AUTO_UPDATE = "0";
    expect(isAutoUpdateEnabled()).toBe(false);
  });

  it("returns true when legacy stopped exists but explicit env enables updates", () => {
    process.env.ECHO_AUTO_UPDATE = "1";
    writeFileSync(stoppedFile, "", "utf-8");
    expect(isAutoUpdateEnabled()).toBe(true);
  });

  it("returns false when checks are globally disabled", () => {
    process.env.ECHO_AUTO_UPDATE = "1";
    process.env.ECHO_DISABLE_UPDATE_CHECK = "1";
    expect(isAutoUpdateEnabled()).toBe(false);
  });
});
