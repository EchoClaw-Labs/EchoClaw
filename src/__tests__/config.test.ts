import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the paths module before importing store
const testDir = join(tmpdir(), `echo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const testConfigFile = join(testDir, "config.json");
const testKeystoreFile = join(testDir, "keystore.json");

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: testDir,
  CONFIG_FILE: testConfigFile,
  KEYSTORE_FILE: testKeystoreFile,
}));

// Import after mocking
const { loadConfig, saveConfig, getDefaultConfig, configExists, ensureConfigDir } = await import(
  "../config/store.js"
);

describe("config store", () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("getDefaultConfig", () => {
    it("should return valid default config", () => {
      const config = getDefaultConfig();

      expect(config.version).toBe(1);
      expect(config.chain.chainId).toBe(16661);
      expect(config.chain.rpcUrl).toBe("https://evmrpc.0g.ai");
      expect(config.wallet.address).toBeNull();
      expect(config.wallet.solanaAddress).toBeNull();
    });
  });

  describe("ensureConfigDir", () => {
    it("should create config directory if not exists", () => {
      expect(existsSync(testDir)).toBe(false);

      ensureConfigDir();

      expect(existsSync(testDir)).toBe(true);
    });

    it("should not fail if directory already exists", () => {
      mkdirSync(testDir, { recursive: true });
      expect(existsSync(testDir)).toBe(true);

      // Should not throw
      ensureConfigDir();

      expect(existsSync(testDir)).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when config file does not exist", () => {
      const config = loadConfig();

      expect(config.version).toBe(1);
      expect(config.chain.chainId).toBe(16661);
    });

    it("should load existing config file", () => {
      mkdirSync(testDir, { recursive: true });

      const customConfig = {
        version: 1,
        chain: {
          chainId: 16661,
          rpcUrl: "https://custom-rpc.example.com",
          explorerUrl: "https://explorer.example.com",
        },
        protocol: getDefaultConfig().protocol,
        wallet: {
          address: "0x1234567890123456789012345678901234567890",
        },
        watchlist: {
          tokens: ["0xaabbccdd00112233445566778899aabbccdd0011"],
        },
      };

      writeFileSync(testConfigFile, JSON.stringify(customConfig), "utf-8");

      const loaded = loadConfig();

      expect(loaded.chain.rpcUrl).toBe("https://custom-rpc.example.com");
      expect(loaded.wallet.address).toBe("0x1234567890123456789012345678901234567890");
      expect("watchlist" in loaded).toBe(false);
    });

    it("should return defaults for invalid JSON", () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testConfigFile, "not valid json {{{", "utf-8");

      const config = loadConfig();

      expect(config.version).toBe(1);
      expect(config.chain.chainId).toBe(16661);
    });

    it("should return defaults for unknown version", () => {
      mkdirSync(testDir, { recursive: true });

      const futureConfig = {
        version: 999,
        someNewField: "value",
      };

      writeFileSync(testConfigFile, JSON.stringify(futureConfig), "utf-8");

      const config = loadConfig();

      expect(config.version).toBe(1);
    });
  });

  describe("saveConfig", () => {
    it("should save config to file", () => {
      const config = getDefaultConfig();
      config.chain.rpcUrl = "https://new-rpc.example.com";

      saveConfig(config);

      expect(existsSync(testConfigFile)).toBe(true);

      const raw = readFileSync(testConfigFile, "utf-8");
      const loaded = JSON.parse(raw);

      expect(loaded.chain.rpcUrl).toBe("https://new-rpc.example.com");
    });

    it("should create directory if not exists", () => {
      expect(existsSync(testDir)).toBe(false);

      saveConfig(getDefaultConfig());

      expect(existsSync(testDir)).toBe(true);
      expect(existsSync(testConfigFile)).toBe(true);
    });

    it("should overwrite existing config", () => {
      mkdirSync(testDir, { recursive: true });

      const config1 = getDefaultConfig();
      config1.chain.rpcUrl = "https://first.example.com";
      saveConfig(config1);

      const config2 = getDefaultConfig();
      config2.chain.rpcUrl = "https://second.example.com";
      saveConfig(config2);

      const loaded = loadConfig();
      expect(loaded.chain.rpcUrl).toBe("https://second.example.com");
    });
  });

  describe("configExists", () => {
    it("should return false when config does not exist", () => {
      expect(configExists()).toBe(false);
    });

    it("should return true when config exists", () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testConfigFile, "{}", "utf-8");

      expect(configExists()).toBe(true);
    });
  });
});
