import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function loadSetupCommand(root: string) {
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  process.env.OPENCLAW_HOME = join(root, "openclaw");
  vi.resetModules();
  vi.doMock("../utils/legacy-cleanup.js", () => ({
    runLegacyCleanupWithLog: vi.fn(),
  }));
  vi.doMock("../update/legacy-runtime.js", () => ({
    retireLegacyUpdateDaemon: vi.fn(async () => ({
      initial: {
        detected: false,
        pidFileExists: false,
        shutdownFileExists: false,
        stoppedFileExists: false,
        stateFileExists: false,
        logFileExists: false,
        pid: null,
        daemonRunning: false,
      },
      final: {
        detected: false,
        pidFileExists: false,
        shutdownFileExists: false,
        stoppedFileExists: false,
        stateFileExists: false,
        logFileExists: false,
        pid: null,
        daemonRunning: false,
      },
      stopSignalSent: false,
      shutdownRequested: false,
      forceKilled: false,
      cleanedFiles: [],
      warnings: [],
    })),
  }));
  vi.doMock("../openclaw/config.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../openclaw/config.js")>();
    return {
      ...actual,
      patchOpenclawSkillEnv: vi.fn(() => ({
        status: "updated",
        path: join(root, "openclaw", "openclaw.json"),
        keysSet: ["ECHO_KEYSTORE_PASSWORD"],
        keysSkipped: [],
      })),
      patchOpenclawConfig: vi.fn(() => ({ changed: false })),
      getSkillHooksEnv: vi.fn(() => ({})),
      loadOpenclawConfig: vi.fn(() => ({})),
      removeOpenclawConfigKey: vi.fn(() => ({ changed: false })),
    };
  });
  vi.doMock("../openclaw/hooks-client.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../openclaw/hooks-client.js")>();
    return {
      ...actual,
      validateHooksTokenSync: vi.fn(),
      buildMonitorAlertPayload: vi.fn(() => ({})),
      buildMarketMakerPayload: vi.fn(() => ({})),
      sendTestWebhook: vi.fn(async () => ({ ok: true })),
    };
  });
  vi.doMock("../setup/openclaw-link.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../setup/openclaw-link.js")>();
    return {
      ...actual,
      linkOpenclawSkill: vi.fn(() => ({
        source: join(root, "src-skill"),
        target: join(root, "dst-skill"),
        linkType: "copy",
        workspaceTarget: undefined,
        workspaceLinked: false,
      })),
    };
  });

  const output = await import("../utils/output.js");
  output.setJsonMode(true);

  const setupModule = await import("../commands/setup.js");
  const pathsModule = await import("../config/paths.js");
  const envModule = await import("../providers/env-resolution.js");

  return {
    createSetupCommand: setupModule.createSetupCommand,
    setJsonMode: output.setJsonMode,
    envFile: pathsModule.ENV_FILE,
    readEnvValue: envModule.readEnvValue,
  };
}

describe("setup password + provider", () => {
  const savedXdg = process.env.XDG_CONFIG_HOME;
  const savedOpenclawHome = process.env.OPENCLAW_HOME;

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;

    if (savedOpenclawHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedOpenclawHome;
  });

  it("setup password writes to app env", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-password-"));
    const { createSetupCommand, setJsonMode, envFile, readEnvValue } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const passwordCmd = setup.commands.find((cmd) => cmd.name() === "password");
    expect(passwordCmd).toBeDefined();

    const capture = captureStdout();
    try {
      await passwordCmd!.parseAsync(["--password", "super-secret-pass", "--force"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.status).toBe("updated");
      expect(payload.path).toBe(envFile);
      expect(readEnvValue("ECHO_KEYSTORE_PASSWORD", envFile)).toBe("super-secret-pass");
      expect(readFileSync(envFile, "utf-8")).toContain("ECHO_KEYSTORE_PASSWORD");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);

  it("setup password --auto-update writes auto-update preference to env file", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-password-autoupdate-"));
    const { createSetupCommand, setJsonMode, envFile, readEnvValue } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const passwordCmd = setup.commands.find((cmd) => cmd.name() === "password");
    expect(passwordCmd).toBeDefined();

    const capture = captureStdout();
    try {
      await passwordCmd!.parseAsync(
        ["--password", "super-secret-pass", "--force", "--auto-update"],
        { from: "user" },
      );
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.status).toBe("updated");
      expect(readEnvValue("ECHO_AUTO_UPDATE", envFile)).toBe("1");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);

  it("setup provider delegates to skill installer flow", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-setup-provider-"));
    const { createSetupCommand, setJsonMode } = await loadSetupCommand(root);

    const setup = createSetupCommand();
    const providerCmd = setup.commands.find((cmd) => cmd.name() === "provider");
    expect(providerCmd).toBeDefined();

    const capture = captureStdout();
    try {
      await providerCmd!.parseAsync(["--provider", "other", "--scope", "project"], { from: "user" });
      const payload = JSON.parse(capture.output().trim());

      expect(payload.success).toBe(true);
      expect(payload.status).toBe("manual_required");
      expect(payload.provider).toBe("other");
      expect(payload.sourcePath).toContain("skills/echoclaw");
    } finally {
      capture.restore();
      setJsonMode(false);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
