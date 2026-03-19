import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendToDotenvFile,
  loadDotenvFileIntoProcess,
  readDotenvFileValue,
} from "../utils/dotenv.js";

const TEST_DIR = join(tmpdir(), `echoclaw-dotenv-${Date.now()}`);
const TEST_ENV = join(TEST_DIR, ".env");

describe("utils/dotenv", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env._TEST_LOAD_A;
    delete process.env._TEST_LOAD_B;
    delete process.env._TEST_LOAD_QUOTED;
    delete process.env._TEST_LOAD_ESCAPED;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("appendToDotenvFile", () => {
    it("creates a new .env file with the key", () => {
      const result = appendToDotenvFile("MY_KEY", "my_value", TEST_ENV);

      expect(result).toBe(TEST_ENV);
      expect(existsSync(TEST_ENV)).toBe(true);

      const content = readFileSync(TEST_ENV, "utf-8");
      expect(content).toContain('MY_KEY="my_value"');
    });

    it("appends to existing .env file", () => {
      writeFileSync(TEST_ENV, 'EXISTING="keep"\n');

      appendToDotenvFile("NEW_KEY", "new_val", TEST_ENV);

      const content = readFileSync(TEST_ENV, "utf-8");
      expect(content).toContain('EXISTING="keep"');
      expect(content).toContain('NEW_KEY="new_val"');
    });

    it("overwrites an existing key", () => {
      writeFileSync(TEST_ENV, 'MY_KEY="old"\nOTHER="keep"\n');

      appendToDotenvFile("MY_KEY", "new", TEST_ENV);

      const content = readFileSync(TEST_ENV, "utf-8");
      expect(content).toContain('MY_KEY="new"');
      expect(content).toContain('OTHER="keep"');
      expect(content).not.toContain('"old"');
    });

    it("handles values with special chars", () => {
      appendToDotenvFile("COMPLEX", 'pass#word=with"quotes', TEST_ENV);

      const content = readFileSync(TEST_ENV, "utf-8");
      expect(content).toContain('COMPLEX="pass#word=with\\"quotes"');
    });

    it("handles values with backslashes", () => {
      appendToDotenvFile("PATH_VAL", "C:\\Users\\test", TEST_ENV);

      const content = readFileSync(TEST_ENV, "utf-8");
      expect(content).toContain('PATH_VAL="C:\\\\Users\\\\test"');
    });

    it.skipIf(process.platform === "win32")("sets file permissions to 600", () => {
      appendToDotenvFile("SECRET", "value", TEST_ENV);

      const stats = statSync(TEST_ENV);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("loadDotenvFileIntoProcess", () => {
    it("loads vars from .env into process.env", () => {
      writeFileSync(TEST_ENV, '_TEST_LOAD_A="hello"\n_TEST_LOAD_B="world"\n');

      loadDotenvFileIntoProcess(TEST_ENV);

      expect(process.env._TEST_LOAD_A).toBe("hello");
      expect(process.env._TEST_LOAD_B).toBe("world");
    });

    it("does not overwrite existing process.env values", () => {
      process.env._TEST_LOAD_A = "original";
      writeFileSync(TEST_ENV, '_TEST_LOAD_A="overwritten"\n');

      loadDotenvFileIntoProcess(TEST_ENV);

      expect(process.env._TEST_LOAD_A).toBe("original");
    });

    it("handles quoted values with escapes", () => {
      writeFileSync(TEST_ENV, '_TEST_LOAD_QUOTED="pass\\"word"\n_TEST_LOAD_ESCAPED="C:\\\\Users"\n');

      loadDotenvFileIntoProcess(TEST_ENV);

      expect(process.env._TEST_LOAD_QUOTED).toBe('pass"word');
      expect(process.env._TEST_LOAD_ESCAPED).toBe("C:\\Users");
    });

    it("is a no-op when .env does not exist", () => {
      expect(() => loadDotenvFileIntoProcess(TEST_ENV)).not.toThrow();
    });
  });

  describe("readDotenvFileValue", () => {
    it("returns null when file does not exist", () => {
      expect(readDotenvFileValue("MISSING", TEST_ENV)).toBeNull();
    });

    it("returns null when key is missing", () => {
      writeFileSync(TEST_ENV, 'OTHER="val"\n');

      expect(readDotenvFileValue("MISSING_KEY", TEST_ENV)).toBeNull();
    });

    it("reads a simple unquoted value", () => {
      writeFileSync(TEST_ENV, "MY_KEY=simple_value\n");

      expect(readDotenvFileValue("MY_KEY", TEST_ENV)).toBe("simple_value");
    });

    it("reads a quoted value", () => {
      writeFileSync(TEST_ENV, 'MY_KEY="quoted value"\n');

      expect(readDotenvFileValue("MY_KEY", TEST_ENV)).toBe("quoted value");
    });

    it("returns null for empty value", () => {
      writeFileSync(TEST_ENV, 'EMPTY=""\n');

      expect(readDotenvFileValue("EMPTY", TEST_ENV)).toBeNull();
    });

    it("roundtrips special chars with appendToDotenvFile", () => {
      appendToDotenvFile("PASSWORD", 'my#pass=with"quotes\\slash', TEST_ENV);

      expect(readDotenvFileValue("PASSWORD", TEST_ENV)).toBe('my#pass=with"quotes\\slash');
    });
  });
});
