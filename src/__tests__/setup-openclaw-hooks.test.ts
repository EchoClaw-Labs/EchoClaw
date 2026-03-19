import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patchOpenclawSkillEnv } from "../openclaw/config.js";

/**
 * Tests for `echoclaw setup openclaw-hooks` logic.
 * Validates that OPENCLAW_HOOKS_* env vars are correctly patched
 * into openclaw.json at skills.entries.echoclaw.env.
 *
 * We test the underlying patchOpenclawSkillEnv() with the exact
 * key names used by the command, since the command is a thin wrapper.
 */

const TEST_DIR = join(tmpdir(), `echo-test-hooks-${Date.now()}`);
const TEST_CONFIG = join(TEST_DIR, "openclaw.json");

const HOOKS_KEYS = {
  OPENCLAW_HOOKS_BASE_URL: "http://127.0.0.1:18789",
  OPENCLAW_HOOKS_TOKEN: "test-secret-token",
};

const ALL_HOOKS_KEYS = {
  ...HOOKS_KEYS,
  OPENCLAW_HOOKS_AGENT_ID: "agent-123",
  OPENCLAW_HOOKS_CHANNEL: "whatsapp",
  OPENCLAW_HOOKS_TO: "+1234567890",
  OPENCLAW_HOOKS_INCLUDE_GUARDRAIL: "1",
};

// Save original env values
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_HOME",
  "OPENCLAW_HOOKS_BASE_URL",
  "OPENCLAW_HOOKS_TOKEN",
  "OPENCLAW_HOOKS_AGENT_ID",
  "OPENCLAW_HOOKS_CHANNEL",
  "OPENCLAW_HOOKS_TO",
  "OPENCLAW_HOOKS_INCLUDE_GUARDRAIL",
];

describe("setup openclaw-hooks", () => {
  beforeEach(() => {
    // Save and clear env
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.OPENCLAW_CONFIG_PATH = TEST_CONFIG;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    // Restore env
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("should set required hooks keys (base-url + token)", () => {
    const result = patchOpenclawSkillEnv("echoclaw", HOOKS_KEYS);

    expect(result.status).toBe("created");
    expect(result.keysSet).toContain("OPENCLAW_HOOKS_BASE_URL");
    expect(result.keysSet).toContain("OPENCLAW_HOOKS_TOKEN");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_BASE_URL).toBe("http://127.0.0.1:18789");
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_TOKEN).toBe("test-secret-token");
  });

  it("should set all hooks keys including optional ones", () => {
    const result = patchOpenclawSkillEnv("echoclaw", ALL_HOOKS_KEYS);

    expect(result.status).toBe("created");
    expect(result.keysSet).toHaveLength(6);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    const env = data.skills.entries.echoclaw.env;
    expect(env.OPENCLAW_HOOKS_BASE_URL).toBe("http://127.0.0.1:18789");
    expect(env.OPENCLAW_HOOKS_TOKEN).toBe("test-secret-token");
    expect(env.OPENCLAW_HOOKS_AGENT_ID).toBe("agent-123");
    expect(env.OPENCLAW_HOOKS_CHANNEL).toBe("whatsapp");
    expect(env.OPENCLAW_HOOKS_TO).toBe("+1234567890");
    expect(env.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL).toBe("1");
  });

  it("should skip existing keys without --force", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        skills: {
          entries: {
            echoclaw: {
              env: {
                OPENCLAW_HOOKS_BASE_URL: "http://old-url:8080",
                OPENCLAW_HOOKS_TOKEN: "old-token",
              },
            },
          },
        },
      })
    );

    const result = patchOpenclawSkillEnv("echoclaw", HOOKS_KEYS);

    expect(result.status).toBe("exists");
    expect(result.keysSet).toEqual([]);
    expect(result.keysSkipped).toContain("OPENCLAW_HOOKS_BASE_URL");
    expect(result.keysSkipped).toContain("OPENCLAW_HOOKS_TOKEN");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_BASE_URL).toBe("http://old-url:8080");
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_TOKEN).toBe("old-token");
  });

  it("should overwrite existing keys with --force", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        skills: {
          entries: {
            echoclaw: {
              env: {
                OPENCLAW_HOOKS_BASE_URL: "http://old-url:8080",
                OPENCLAW_HOOKS_TOKEN: "old-token",
              },
            },
          },
        },
      })
    );

    const result = patchOpenclawSkillEnv("echoclaw", HOOKS_KEYS, { force: true });

    expect(result.status).toBe("updated");
    expect(result.keysSet).toContain("OPENCLAW_HOOKS_BASE_URL");
    expect(result.keysSet).toContain("OPENCLAW_HOOKS_TOKEN");
    expect(result.keysSkipped).toEqual([]);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_BASE_URL).toBe("http://127.0.0.1:18789");
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_TOKEN).toBe("test-secret-token");
  });

  it("should only set provided optional keys", () => {
    // Only provide base-url + token + agent-id (no channel, to, guardrail)
    const partial = {
      OPENCLAW_HOOKS_BASE_URL: "http://127.0.0.1:18789",
      OPENCLAW_HOOKS_TOKEN: "secret",
      OPENCLAW_HOOKS_AGENT_ID: "my-agent",
    };

    const result = patchOpenclawSkillEnv("echoclaw", partial);

    expect(result.keysSet).toHaveLength(3);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    const env = data.skills.entries.echoclaw.env;
    expect(env.OPENCLAW_HOOKS_BASE_URL).toBe("http://127.0.0.1:18789");
    expect(env.OPENCLAW_HOOKS_TOKEN).toBe("secret");
    expect(env.OPENCLAW_HOOKS_AGENT_ID).toBe("my-agent");
    expect(env.OPENCLAW_HOOKS_CHANNEL).toBeUndefined();
    expect(env.OPENCLAW_HOOKS_TO).toBeUndefined();
    expect(env.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL).toBeUndefined();
  });

  it("should preserve existing non-hooks keys", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        skills: {
          entries: {
            echoclaw: {
              env: {
                ECHO_KEYSTORE_PASSWORD: "existing-pw",
                ECHO_AUTO_UPDATE: "1",
              },
            },
          },
        },
      })
    );

    const result = patchOpenclawSkillEnv("echoclaw", HOOKS_KEYS);

    expect(result.status).toBe("updated");

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    const env = data.skills.entries.echoclaw.env;
    expect(env.ECHO_KEYSTORE_PASSWORD).toBe("existing-pw");
    expect(env.ECHO_AUTO_UPDATE).toBe("1");
    expect(env.OPENCLAW_HOOKS_BASE_URL).toBe("http://127.0.0.1:18789");
    expect(env.OPENCLAW_HOOKS_TOKEN).toBe("test-secret-token");
  });

  it("should handle mixed: some keys new, some existing", () => {
    writeFileSync(
      TEST_CONFIG,
      JSON.stringify({
        skills: {
          entries: {
            echoclaw: {
              env: {
                OPENCLAW_HOOKS_BASE_URL: "http://existing:8080",
              },
            },
          },
        },
      })
    );

    const result = patchOpenclawSkillEnv("echoclaw", {
      OPENCLAW_HOOKS_BASE_URL: "http://new:9090",
      OPENCLAW_HOOKS_TOKEN: "new-token",
    });

    expect(result.status).toBe("updated");
    expect(result.keysSet).toEqual(["OPENCLAW_HOOKS_TOKEN"]);
    expect(result.keysSkipped).toEqual(["OPENCLAW_HOOKS_BASE_URL"]);

    const data = JSON.parse(readFileSync(TEST_CONFIG, "utf-8"));
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_BASE_URL).toBe("http://existing:8080");
    expect(data.skills.entries.echoclaw.env.OPENCLAW_HOOKS_TOKEN).toBe("new-token");
  });
});
