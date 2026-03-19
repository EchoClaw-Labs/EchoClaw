import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UPDATE_COMMAND_TEST_TIMEOUT_MS = 30_000;

function captureStdout(): { output: () => string; restore: () => void } {
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
    output += typeof chunk === "string" ? chunk : chunk.toString(encoding);
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof cb === "function") {
      cb();
    }
    return true;
  }) as any;
  return {
    output: () => output,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

async function loadUpdateCommand(root: string) {
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.OPENCLAW_HOME = join(root, "openclaw");
  vi.resetModules();

  const output = await import("../utils/output.js");
  output.setJsonMode(true);

  const updateModule = await import("../commands/update/index.js");
  const pathsModule = await import("../config/paths.js");
  const envModule = await import("../providers/env-resolution.js");

  return {
    createUpdateCommand: updateModule.createUpdateCommand,
    setJsonMode: output.setJsonMode,
    envFile: pathsModule.ENV_FILE,
    readEnvValue: envModule.readEnvValue,
  };
}

describe.sequential("update command", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedOpenclawHome = process.env.OPENCLAW_HOME;

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;

    if (savedOpenclawHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedOpenclawHome;
  });

  it("enable/start writes env preference and accepts legacy flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-enable-"));
    const { createUpdateCommand, setJsonMode, envFile, readEnvValue } =
      await loadUpdateCommand(root);

    const update = createUpdateCommand();
    const capture = captureStdout();
    try {
      await update.parseAsync(["start", "--daemon", "--interval", "300"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.enabled).toBe(true);
      expect(payload.legacyOptionsIgnored).toBe(true);
      expect(payload.daemonUsed).toBe(false);
      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("1");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);

  it("disable/stop writes explicit opt-out", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-update-disable-"));
    const { createUpdateCommand, setJsonMode, envFile, readEnvValue } =
      await loadUpdateCommand(root);

    const update = createUpdateCommand();
    const capture = captureStdout();
    try {
      await update.parseAsync(["stop"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.enabled).toBe(false);
      expect(payload.daemonUsed).toBe(false);
      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("0");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, UPDATE_COMMAND_TEST_TIMEOUT_MS);
});
