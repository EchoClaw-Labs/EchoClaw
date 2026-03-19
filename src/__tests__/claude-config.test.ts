import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const originalHome = process.env.HOME;
const originalXdg = process.env.XDG_CONFIG_HOME;
const originalProjectRoot = process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT;

interface ClaudeConfigModule {
  getSettingsPath: (scope?: string) => string;
  injectClaudeSettings: (cfg: any, scope?: string) => { settingsPath: string; port: number };
  removeClaudeSettings: (scope?: string) => {
    changed: boolean;
    path: string;
    removed: string[];
    restored: string[];
    skipped: string[];
    reason?: string;
  };
  restoreClaudeSettings: (scope?: string, opts?: { force?: boolean }) => { path: string; fileExistedBefore: boolean };
}

function makeClaudeCfg() {
  return {
    claude: {
      provider: "0xBB3f5b0b5062CB5B3245222C5917afD1f6e13aF6",
      model: "openai/gpt-oss-120b",
      providerEndpoint: "https://compute.example/v1/proxy",
      proxyPort: 4101,
    },
  };
}

describe("claude config helpers", () => {
  let testRoot: string;
  let homeDir: string;
  let xdgDir: string;
  let projectDir: string;
  let mod: ClaudeConfigModule;

  beforeEach(async () => {
    testRoot = join(tmpdir(), `echoclaw-claude-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    homeDir = join(testRoot, "home");
    xdgDir = join(testRoot, "xdg");
    projectDir = join(testRoot, "project");

    mkdirSync(homeDir, { recursive: true });
    mkdirSync(xdgDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    process.env.HOME = homeDir;
    process.env.XDG_CONFIG_HOME = xdgDir;
    process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT = projectDir;

    vi.resetModules();
    mod = await import("../commands/claude/config-cmd.js");
  }, 30_000);

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    if (originalProjectRoot === undefined) {
      delete process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT;
    } else {
      process.env.ECHOCLAW_CLAUDE_PROJECT_ROOT = originalProjectRoot;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("injects Claude settings with key-level merge and preserves unrelated keys", () => {
    const settingsPath = mod.getSettingsPath("project-local");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      model: "opus",
      permissions: { allow: ["Bash(npm test:*)"] },
      env: { KEEP_ME: "1" },
    }, null, 2));

    const result = mod.injectClaudeSettings(makeClaudeCfg(), "project-local");
    const injected = JSON.parse(readFileSync(settingsPath, "utf-8"));

    expect(result.settingsPath).toBe(settingsPath);
    expect(injected.permissions).toEqual({ allow: ["Bash(npm test:*)"] });
    expect(injected.model).toBe("sonnet");
    expect(injected.env).toMatchObject({
      KEEP_ME: "1",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4101",
      ANTHROPIC_AUTH_TOKEN: "passthrough",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "0G-openai/gpt-oss-120b",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "0G-openai/gpt-oss-120b",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "0G-openai/gpt-oss-120b",
      CLAUDE_CODE_SUBAGENT_MODEL: "0G-openai/gpt-oss-120b",
    });
  });

  it("remove restores original managed values and skips user-modified keys", () => {
    const settingsPath = mod.getSettingsPath("project-local");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      model: "opus",
      env: { KEEP_ME: "1" },
    }, null, 2));

    mod.injectClaudeSettings(makeClaudeCfg(), "project-local");

    const modified = JSON.parse(readFileSync(settingsPath, "utf-8"));
    modified.env.ANTHROPIC_BASE_URL = "http://manual.local:9999";
    writeFileSync(settingsPath, JSON.stringify(modified, null, 2));

    const result = mod.removeClaudeSettings("project-local");
    const afterRemove = JSON.parse(readFileSync(settingsPath, "utf-8"));

    expect(result.changed).toBe(true);
    expect(result.restored).toContain("model");
    expect(result.skipped).toContain("env.ANTHROPIC_BASE_URL");
    expect(afterRemove.model).toBe("opus");
    expect(afterRemove.env).toMatchObject({
      KEEP_ME: "1",
      ANTHROPIC_BASE_URL: "http://manual.local:9999",
    });
    expect(afterRemove.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(afterRemove.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(afterRemove.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(afterRemove.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(afterRemove.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it("backfills newly managed alias keys when metadata comes from an older inject", () => {
    const settingsPath = mod.getSettingsPath("project-local");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      model: "sonnet",
      env: {
        KEEP_ME: "1",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4101",
        ANTHROPIC_AUTH_TOKEN: "passthrough",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "0G-openai/gpt-oss-120b",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "manual-opus",
      },
    }, null, 2));

    const metaDir = join(xdgDir, "echoclaw", "claude-config-backup");
    mkdirSync(metaDir, { recursive: true });
    const metaId = createHash("sha256").update(resolve(settingsPath)).digest("hex").slice(0, 16);
    const metaPath = join(metaDir, `${metaId}.meta.json`);
    writeFileSync(metaPath, JSON.stringify({
      originalPath: settingsPath,
      backupFile: join(metaDir, `${metaId}.settings.bak`),
      timestamp: Date.now(),
      originalHash: "oldhash",
      injectedHash: "oldinject",
      fileExistedBefore: true,
      managedKeys: [
        "model",
        "env.ANTHROPIC_BASE_URL",
        "env.ANTHROPIC_AUTH_TOKEN",
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      ],
      originalValues: {
        model: { exists: true, value: "opus" },
        "env.ANTHROPIC_BASE_URL": { exists: false },
        "env.ANTHROPIC_AUTH_TOKEN": { exists: false },
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL": { exists: false },
      },
      managedValues: {
        model: "sonnet",
        "env.ANTHROPIC_BASE_URL": "http://127.0.0.1:4101",
        "env.ANTHROPIC_AUTH_TOKEN": "passthrough",
        "env.ANTHROPIC_DEFAULT_SONNET_MODEL": "0G-openai/gpt-oss-120b",
      },
    }, null, 2));

    mod.injectClaudeSettings(makeClaudeCfg(), "project-local");
    const removed = mod.removeClaudeSettings("project-local");
    const afterRemove = JSON.parse(readFileSync(settingsPath, "utf-8"));

    expect(removed.restored).toContain("env.ANTHROPIC_DEFAULT_OPUS_MODEL");
    expect(afterRemove.model).toBe("opus");
    expect(afterRemove.env).toMatchObject({
      KEEP_ME: "1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "manual-opus",
    });
    expect(afterRemove.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(afterRemove.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it("restore refuses to overwrite post-injection edits unless forced", () => {
    const settingsPath = mod.getSettingsPath("project-local");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      model: "opus",
      env: { KEEP_ME: "1" },
    }, null, 2));

    mod.injectClaudeSettings(makeClaudeCfg(), "project-local");

    const modified = JSON.parse(readFileSync(settingsPath, "utf-8"));
    modified.permissions = { allow: ["Bash(echo test)"] };
    writeFileSync(settingsPath, JSON.stringify(modified, null, 2));

    expect(() => mod.restoreClaudeSettings("project-local")).toThrow("modified after echoclaw injection");

    mod.restoreClaudeSettings("project-local", { force: true });

    expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
      model: "opus",
      env: { KEEP_ME: "1" },
    });
  });

  it("tracks backups per scope so project-local and user restores do not overwrite each other", () => {
    const projectSettings = mod.getSettingsPath("project-local");
    const userSettings = mod.getSettingsPath("user");

    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    mkdirSync(join(homeDir, ".claude"), { recursive: true });

    writeFileSync(projectSettings, JSON.stringify({ model: "project-opus" }, null, 2));
    writeFileSync(userSettings, JSON.stringify({ model: "user-opus" }, null, 2));

    mod.injectClaudeSettings(makeClaudeCfg(), "project-local");
    mod.injectClaudeSettings(makeClaudeCfg(), "user");

    mod.restoreClaudeSettings("user");

    expect(JSON.parse(readFileSync(userSettings, "utf-8"))).toEqual({ model: "user-opus" });
    expect(JSON.parse(readFileSync(projectSettings, "utf-8")).model).toBe("sonnet");
  });

  it("fails fast on invalid JSON instead of treating it as an empty settings file", () => {
    const settingsPath = mod.getSettingsPath("project-local");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{ definitely not valid json");

    expect(() => mod.injectClaudeSettings(makeClaudeCfg(), "project-local")).toThrow("Failed to parse");
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ definitely not valid json");
  });

  it("restore removes a settings file that did not exist before injection", () => {
    const settingsPath = mod.getSettingsPath("project-local");

    mod.injectClaudeSettings(makeClaudeCfg(), "project-local");
    expect(existsSync(settingsPath)).toBe(true);

    const restored = mod.restoreClaudeSettings("project-local");

    expect(restored.fileExistedBefore).toBe(false);
    expect(existsSync(settingsPath)).toBe(false);
  });
});
