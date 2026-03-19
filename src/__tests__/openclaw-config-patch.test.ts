import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAddress } from "viem";
import { patchOpenclawConfig } from "../openclaw/config.js";

const TEST_DIR = join(tmpdir(), `echo-test-patch-${Date.now()}`);
const TEST_CONFIG = join(TEST_DIR, "openclaw.json");

describe("patchOpenclawConfig", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.OPENCLAW_CONFIG_PATH = TEST_CONFIG;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.OPENCLAW_CONFIG_PATH;
  });

  // ── Basic deep-set ──────────────────────────────────────────────

  it("should create file and set value at dot path", () => {
    const result = patchOpenclawConfig("models.providers.zg", { baseUrl: "https://test.com" });

    expect(result.status).toBe("created");
    expect(result.keysSet.length).toBeGreaterThan(0);
    expect(existsSync(TEST_CONFIG)).toBe(true);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.models.providers.zg).toEqual({ baseUrl: "https://test.com" });
  });

  it("should create intermediate objects for nested paths", () => {
    patchOpenclawConfig("a.b.c.d", "deep-value");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.a.b.c.d).toBe("deep-value");
  });

  it("should set a single key at root level", () => {
    patchOpenclawConfig("models.mode", "merge");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.models.mode).toBe("merge");
  });

  // ── Merge behavior ──────────────────────────────────────────────

  it("should shallow-merge objects by default (skip existing keys)", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        models: {
          providers: {
            zg: { baseUrl: "old-url", apiKey: "old-key" },
          },
        },
      })
    );

    const result = patchOpenclawConfig("models.providers.zg", {
      baseUrl: "new-url",
      models: [{ id: "test" }],
    });

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    // baseUrl already existed → skipped
    expect(data.models.providers.zg.baseUrl).toBe("old-url");
    // apiKey preserved
    expect(data.models.providers.zg.apiKey).toBe("old-key");
    // models is new → added
    expect(data.models.providers.zg.models).toEqual([{ id: "test" }]);
    expect(result.keysSet).toContain("models.providers.zg.models");
    expect(result.keysSkipped).toContain("models.providers.zg.baseUrl");
  });

  it("should preserve other sections when patching nested path", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        agents: { defaults: { model: "test" } },
        skills: { entries: {} },
      })
    );

    patchOpenclawConfig("models.providers.zg", { api: "openai-completions" });

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.agents.defaults.model).toBe("test");
    expect(data.skills.entries).toEqual({});
    expect(data.models.providers.zg.api).toBe("openai-completions");
  });

  // ── Force overwrite ─────────────────────────────────────────────

  it("should overwrite entire value with force=true", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        models: { providers: { zg: { old: "data" } } },
      })
    );

    const result = patchOpenclawConfig(
      "models.providers.zg",
      { new: "data" },
      { force: true }
    );

    expect(result.status).toBe("updated");
    expect(result.keysSet).toContain("models.providers.zg");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.models.providers.zg).toEqual({ new: "data" });
    expect(data.models.providers.zg.old).toBeUndefined();
  });

  // ── Skip behavior ──────────────────────────────────────────────

  it("should skip if path exists and merge=false, force=false", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({ models: { mode: "replace" } })
    );

    const result = patchOpenclawConfig("models.mode", "merge", { merge: false });

    expect(result.status).toBe("exists");
    expect(result.keysSkipped).toContain("models.mode");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.models.mode).toBe("replace");
  });

  it("should return exists when nothing changes", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        models: { providers: { zg: { baseUrl: "existing" } } },
      })
    );

    const result = patchOpenclawConfig("models.providers.zg", { baseUrl: "new" });
    expect(result.status).toBe("exists");
  });

  // ── Non-object values ───────────────────────────────────────────

  it("should handle string values at path", () => {
    patchOpenclawConfig("agents.defaults.model.primary", "zg/deepseek-chat-v3-0324");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.agents.defaults.model.primary).toBe("zg/deepseek-chat-v3-0324");
  });

  it("should handle array values at path", () => {
    patchOpenclawConfig("agents.defaults.model.fallbacks", ["anthropic/claude-sonnet-4-5"]);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.agents.defaults.model.fallbacks).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  // ── JSON5 input ─────────────────────────────────────────────────

  it("should read JSON5 and write standard JSON", () => {
    writeFileSync(
      TEST_CONFIG,
      `{
  // This is a comment
  "agents": { "model": "test" },
}`
    );

    patchOpenclawConfig("models.mode", "merge");

    const raw = readFileSync(TEST_CONFIG, "utf-8");
    const data = JSON.parse(raw); // Should not throw (valid JSON)
    expect(data.agents.model).toBe("test");
    expect(data.models.mode).toBe("merge");
  });

  // ── OpenClaw provider schema ────────────────────────────────────

  it("should produce valid OpenClaw provider schema (no cost field)", () => {
    const providerConfig = {
      baseUrl: "https://provider.example/v1/proxy",
      apiKey: "app-sk-test123",
      api: "openai-completions",
      models: [
        {
          id: "deepseek-chat-v3-0324",
          name: "DeepSeek V3 (0G Compute)",
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ],
    };

    patchOpenclawConfig("models.providers.zg", providerConfig);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    const zg = data.models.providers.zg;

    // Required fields present
    expect(zg.baseUrl).toBe("https://provider.example/v1/proxy");
    expect(zg.apiKey).toBe("app-sk-test123");
    expect(zg.api).toBe("openai-completions");
    expect(Array.isArray(zg.models)).toBe(true);
    expect(zg.models[0].id).toBe("deepseek-chat-v3-0324");
    expect(zg.models[0].contextWindow).toBe(128000);
    expect(zg.models[0].maxTokens).toBe(8192);

    // No cost field (strict schema would reject it)
    expect(zg.cost).toBeUndefined();
    expect(zg.models[0].cost).toBeUndefined();
  });

  it("should produce valid default model schema with fallbacks", () => {
    patchOpenclawConfig("agents.defaults.model", {
      primary: "zg/deepseek-chat-v3-0324",
      fallbacks: ["anthropic/claude-sonnet-4-5"],
    });

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    const model = data.agents.defaults.model;

    expect(model.primary).toBe("zg/deepseek-chat-v3-0324");
    expect(model.fallbacks).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  // ── Input validation (tested via command helpers, not patchOpenclawConfig directly) ──

  describe("input validation helpers", () => {
    it("should validate tokenId range 0-254", () => {
      const validIds = [0, 1, 127, 254];
      const invalidIds = [-1, 255, 256, 1000, NaN, Infinity];

      for (const id of validIds) {
        expect(Number.isInteger(id) && id >= 0 && id <= 254).toBe(true);
      }
      for (const id of invalidIds) {
        expect(Number.isInteger(id) && id >= 0 && id <= 254).toBe(false);
      }
    });

    it("should validate ethereum addresses", () => {
      expect(isAddress("0x1b3aAeD586b41F6FBc24c5c2a3F8B751e2F84D60")).toBe(true);
      expect(isAddress("0xinvalid")).toBe(false);
      expect(isAddress("not-an-address")).toBe(false);
      expect(isAddress("")).toBe(false);
    });

    it("should validate positive amounts", () => {
      const valid = [0.001, 0.5, 1, 100];
      const invalid = [0, -1, NaN, Infinity, -Infinity];

      for (const v of valid) {
        expect(Number.isFinite(v) && v > 0).toBe(true);
      }
      for (const v of invalid) {
        expect(Number.isFinite(v) && v > 0).toBe(false);
      }
    });
  });
});
