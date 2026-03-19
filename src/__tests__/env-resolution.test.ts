import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use real fs for integration tests
const testDir = join(tmpdir(), `echoclaw-env-test-${Date.now()}`);
const appEnvPath = join(testDir, "app", ".env");

vi.mock("../config/paths.js", () => ({
  ENV_FILE: appEnvPath,
}));

const { readEnvValue, loadProviderDotenv, writeAppEnvValue } = await import("../providers/env-resolution.js");

describe("readEnvValue", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should return null for non-existent file", () => {
    expect(readEnvValue("FOO", "/nonexistent/.env")).toBeNull();
  });

  it("should read unquoted value", () => {
    writeFileSync(appEnvPath, "MY_KEY=my-value\n");
    expect(readEnvValue("MY_KEY", appEnvPath)).toBe("my-value");
  });

  it("should read double-quoted value", () => {
    writeFileSync(appEnvPath, 'MY_KEY="my password with spaces"\n');
    expect(readEnvValue("MY_KEY", appEnvPath)).toBe("my password with spaces");
  });

  it("should handle escaped quotes in double-quoted value", () => {
    writeFileSync(appEnvPath, 'MY_KEY="pass\\"word"\n');
    expect(readEnvValue("MY_KEY", appEnvPath)).toBe('pass"word');
  });

  it("should return null for missing key", () => {
    writeFileSync(appEnvPath, "OTHER_KEY=value\n");
    expect(readEnvValue("MY_KEY", appEnvPath)).toBeNull();
  });

  it("should return null for empty value", () => {
    writeFileSync(appEnvPath, "MY_KEY=\n");
    expect(readEnvValue("MY_KEY", appEnvPath)).toBeNull();
  });
});

describe("loadProviderDotenv", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.TEST_APP_VAR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load from app .env", () => {
    writeFileSync(appEnvPath, "TEST_APP_VAR=from-app\n");
    loadProviderDotenv();
    expect(process.env.TEST_APP_VAR).toBe("from-app");
  });

  it("should not overwrite existing process.env", () => {
    process.env.TEST_APP_VAR = "already-set";
    writeFileSync(appEnvPath, "TEST_APP_VAR=from-file\n");
    loadProviderDotenv();
    expect(process.env.TEST_APP_VAR).toBe("already-set");
  });
});

describe("writeAppEnvValue", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, "app"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes to app env", () => {
    const result = writeAppEnvValue("ECHO_KEYSTORE_PASSWORD", "secret-pass");
    expect(result).toBe(appEnvPath);
    expect(readEnvValue("ECHO_KEYSTORE_PASSWORD", appEnvPath)).toBe("secret-pass");
  });
});
