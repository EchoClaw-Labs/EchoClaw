import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  getOpenclawConfigPath,
  loadOpenclawConfig,
  patchOpenclawSkillEnv,
  removeOpenclawConfigKey,
  getOpenclawHome,
} from "../openclaw/config.js";

const TEST_DIR = join(tmpdir(), `echo-test-openclaw-${Date.now()}`);
const TEST_CONFIG = join(TEST_DIR, "openclaw.json");

describe("openclaw/config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Override config path for tests
    process.env.OPENCLAW_CONFIG_PATH = TEST_CONFIG;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_HOME;
  });

  describe("getOpenclawConfigPath", () => {
    it("should use OPENCLAW_CONFIG_PATH when set", () => {
      process.env.OPENCLAW_CONFIG_PATH = "/custom/path/config.json";
      expect(getOpenclawConfigPath()).toBe("/custom/path/config.json");
    });

    it("should use OPENCLAW_HOME when set (no OPENCLAW_CONFIG_PATH)", () => {
      delete process.env.OPENCLAW_CONFIG_PATH;
      process.env.OPENCLAW_HOME = "/custom/home";
      expect(getOpenclawConfigPath()).toBe(join("/custom/home", "openclaw.json"));
    });

    it("should fall back to ~/.openclaw/openclaw.json", () => {
      delete process.env.OPENCLAW_CONFIG_PATH;
      delete process.env.OPENCLAW_HOME;
      const result = getOpenclawConfigPath();
      expect(result).toContain("openclaw.json");
      expect(result).toContain(".openclaw");
    });
  });

  describe("loadOpenclawConfig", () => {
    it("should return null when file does not exist", () => {
      expect(loadOpenclawConfig()).toBeNull();
    });

    it("should parse valid JSON", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ foo: "bar" }));
      const result = loadOpenclawConfig();
      expect(result).toEqual({ foo: "bar" });
    });

    it("should parse JSON5 with comments and trailing commas", () => {
      writeFileSync(
        TEST_CONFIG,
        `{
  // This is a comment
  "foo": "bar",
  "baz": 42,
}`
      );
      const result = loadOpenclawConfig();
      expect(result).toEqual({ foo: "bar", baz: 42 });
    });

    it("should throw EchoError on invalid JSON/JSON5", () => {
      writeFileSync(TEST_CONFIG, "not valid json at all {{{");
      expect(() => loadOpenclawConfig()).toThrow("Failed to parse");
    });
  });

  describe("patchOpenclawSkillEnv", () => {
    it("should create a new file with correct structure when none exists", () => {
      const result = patchOpenclawSkillEnv("echoclaw", { MY_KEY: "my_value" });

      expect(result.status).toBe("created");
      expect(result.keysSet).toEqual(["MY_KEY"]);
      expect(result.keysSkipped).toEqual([]);
      expect(existsSync(TEST_CONFIG)).toBe(true);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries.echoclaw.env.MY_KEY).toBe("my_value");
    });

    it("should deep merge into existing file", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({
          agents: { defaults: { model: "test" } },
          skills: { entries: { echoclaw: { env: { EXISTING: "keep" } } } },
        })
      );

      const result = patchOpenclawSkillEnv("echoclaw", { NEW_KEY: "new_val" });

      expect(result.status).toBe("updated");
      expect(result.keysSet).toEqual(["NEW_KEY"]);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries.echoclaw.env.EXISTING).toBe("keep");
      expect(data.skills.entries.echoclaw.env.NEW_KEY).toBe("new_val");
      // Preserve other sections
      expect(data.agents.defaults.model).toBe("test");
    });

    it("should skip existing keys without force", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({
          skills: { entries: { echoclaw: { env: { MY_KEY: "old_value" } } } },
        })
      );

      const result = patchOpenclawSkillEnv("echoclaw", { MY_KEY: "new_value" });

      expect(result.status).toBe("exists");
      expect(result.keysSet).toEqual([]);
      expect(result.keysSkipped).toEqual(["MY_KEY"]);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries.echoclaw.env.MY_KEY).toBe("old_value");
    });

    it("should overwrite existing keys with force", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({
          skills: { entries: { echoclaw: { env: { MY_KEY: "old_value" } } } },
        })
      );

      const result = patchOpenclawSkillEnv("echoclaw", { MY_KEY: "new_value" }, { force: true });

      expect(result.status).toBe("updated");
      expect(result.keysSet).toEqual(["MY_KEY"]);
      expect(result.keysSkipped).toEqual([]);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries.echoclaw.env.MY_KEY).toBe("new_value");
    });

    it("should handle multiple keys: some new, some existing", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({
          skills: { entries: { echoclaw: { env: { EXISTING: "keep" } } } },
        })
      );

      const result = patchOpenclawSkillEnv("echoclaw", {
        EXISTING: "new",
        NEW: "fresh",
      });

      expect(result.status).toBe("updated");
      expect(result.keysSet).toEqual(["NEW"]);
      expect(result.keysSkipped).toEqual(["EXISTING"]);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries.echoclaw.env.EXISTING).toBe("keep");
      expect(data.skills.entries.echoclaw.env.NEW).toBe("fresh");
    });

    it("should handle JSON5 input (comments are lost in output)", () => {
      writeFileSync(
        TEST_CONFIG,
        `{
  // Agent config
  "agents": { "model": "test" },
  "skills": {
    "entries": {
      "echoclaw": {
        "env": {
          "OLD": "val",
        }
      }
    }
  }
}`
      );

      const result = patchOpenclawSkillEnv("echoclaw", { NEW: "val2" });
      expect(result.status).toBe("updated");

      // Output should be valid standard JSON
      const raw = readFileSync(TEST_CONFIG, "utf-8");
      const data = JSON.parse(raw); // Should not throw
      expect(data.skills.entries.echoclaw.env.OLD).toBe("val");
      expect(data.skills.entries.echoclaw.env.NEW).toBe("val2");
    });

    it("should write atomic file (file exists after write)", () => {
      patchOpenclawSkillEnv("echoclaw", { KEY: "val" });
      expect(existsSync(TEST_CONFIG)).toBe(true);
    });

    it("should support different skill keys", () => {
      patchOpenclawSkillEnv("other-skill", { API_KEY: "secret" });

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.skills.entries["other-skill"].env.API_KEY).toBe("secret");
    });
  });

  describe("removeOpenclawConfigKey", () => {
    it("should return false when file does not exist", () => {
      expect(removeOpenclawConfigKey("some.key")).toBe(false);
    });

    it("should return false when key path does not exist", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ foo: "bar" }));
      expect(removeOpenclawConfigKey("nonexistent.deep.key")).toBe(false);
    });

    it("should return false when leaf key does not exist", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ gateway: { auth: {} } }));
      expect(removeOpenclawConfigKey("gateway.auth.token")).toBe(false);
    });

    it("should remove a nested key and preserve siblings", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({
          gateway: { auth: { token: "secret", method: "bearer" } },
          hooks: { enabled: true },
        })
      );

      const result = removeOpenclawConfigKey("gateway.auth.token");
      expect(result).toBe(true);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.gateway.auth.token).toBeUndefined();
      expect(data.gateway.auth.method).toBe("bearer");
      expect(data.hooks.enabled).toBe(true);
    });

    it("should remove a top-level key", () => {
      writeFileSync(TEST_CONFIG, JSON.stringify({ foo: "bar", baz: 42 }));

      expect(removeOpenclawConfigKey("foo")).toBe(true);

      const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
      expect(data.foo).toBeUndefined();
      expect(data.baz).toBe(42);
    });

    it("should produce valid JSON after removal", () => {
      writeFileSync(
        TEST_CONFIG,
        JSON.stringify({ a: { b: { c: "remove-me" } } })
      );

      removeOpenclawConfigKey("a.b.c");

      const raw = readFileSync(TEST_CONFIG, "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe("getOpenclawHome", () => {
    it("should use OPENCLAW_HOME when set", () => {
      process.env.OPENCLAW_HOME = "/custom/openclaw";
      expect(getOpenclawHome()).toBe("/custom/openclaw");
    });

    it("should fall back to ~/.openclaw", () => {
      delete process.env.OPENCLAW_HOME;
      expect(getOpenclawHome()).toBe(join(homedir(), ".openclaw"));
    });
  });
});
