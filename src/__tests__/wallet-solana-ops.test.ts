import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { ErrorCodes } from "../errors.js";

const { testDir, testConfigFile, testKeystoreFile, testSolanaKeystoreFile } = vi.hoisted(() => {
  const { join: _join } = require("node:path");
  const { tmpdir: _tmpdir } = require("node:os");
  const _testDir = _join(_tmpdir(), `echo-sol-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return {
    testDir: _testDir,
    testConfigFile: _join(_testDir, "config.json"),
    testKeystoreFile: _join(_testDir, "keystore.json"),
    testSolanaKeystoreFile: _join(_testDir, "solana-keystore.json"),
  };
});

vi.mock("../config/paths.js", () => {
  const { join: _join } = require("node:path");
  return {
    CONFIG_DIR: testDir,
    CONFIG_FILE: testConfigFile,
    KEYSTORE_FILE: testKeystoreFile,
    SOLANA_KEYSTORE_FILE: testSolanaKeystoreFile,
    ENV_FILE: _join(testDir, ".env"),
    BACKUPS_DIR: _join(testDir, "backups"),
  };
});

vi.mock("../utils/env.js", () => ({
  requireKeystorePassword: vi.fn(() => "test-password-123"),
  getKeystorePassword: vi.fn(() => "test-password-123"),
}));

vi.mock("../commands/wallet/index.js", () => ({
  autoBackup: vi.fn(async () => {}),
}));

vi.mock("../utils/logger.js", () => ({
  default: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { loadConfig, saveConfig, getDefaultConfig } = await import("../config/store.js");
const { encodeSolanaSecretKey } = await import("../wallet/solana-keystore.js");

describe("Solana wallet operations", () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    saveConfig(getDefaultConfig());
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("createSolanaWallet", () => {
    it("creates a new Solana wallet and saves to config", async () => {
      const { createSolanaWallet } = await import("../wallet/solana-create.js");
      const result = await createSolanaWallet();

      expect(result.address).toBeTruthy();
      expect(result.address.length).toBeGreaterThanOrEqual(32);
      expect(result.overwritten).toBe(false);

      const cfg = loadConfig();
      expect(cfg.wallet.solanaAddress).toBe(result.address);
    });

    it("throws KEYSTORE_ALREADY_EXISTS when keystore exists and force is false", async () => {
      const { createSolanaWallet } = await import("../wallet/solana-create.js");

      await createSolanaWallet();

      await expect(createSolanaWallet()).rejects.toMatchObject({
        code: ErrorCodes.KEYSTORE_ALREADY_EXISTS,
      });
    });

    it("overwrites existing keystore when force is true", async () => {
      const { createSolanaWallet } = await import("../wallet/solana-create.js");

      await createSolanaWallet();
      const second = await createSolanaWallet({ force: true });

      expect(second.overwritten).toBe(true);
      expect(second.address).toBeTruthy();
    });
  });

  describe("importSolanaWallet", () => {
    it("imports a base58 secret key", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");
      const keypair = Keypair.generate();
      const base58Key = encodeSolanaSecretKey(keypair.secretKey);

      const result = await importSolanaWallet(base58Key);

      expect(result.address).toBe(keypair.publicKey.toBase58());
      expect(result.overwritten).toBe(false);

      const cfg = loadConfig();
      expect(cfg.wallet.solanaAddress).toBe(keypair.publicKey.toBase58());
    });

    it("imports a JSON byte array secret key", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");
      const keypair = Keypair.generate();
      const jsonKey = JSON.stringify(Array.from(keypair.secretKey));

      const result = await importSolanaWallet(jsonKey);

      expect(result.address).toBe(keypair.publicKey.toBase58());
      expect(result.overwritten).toBe(false);
    });

    it("throws KEYSTORE_ALREADY_EXISTS when keystore exists and force is false", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();

      await importSolanaWallet(encodeSolanaSecretKey(keypair1.secretKey));

      await expect(
        importSolanaWallet(encodeSolanaSecretKey(keypair2.secretKey)),
      ).rejects.toMatchObject({
        code: ErrorCodes.KEYSTORE_ALREADY_EXISTS,
      });
    });

    it("overwrites existing keystore when force is true", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();

      await importSolanaWallet(encodeSolanaSecretKey(keypair1.secretKey));
      const result = await importSolanaWallet(encodeSolanaSecretKey(keypair2.secretKey), { force: true });

      expect(result.address).toBe(keypair2.publicKey.toBase58());
      expect(result.overwritten).toBe(true);
    });

    it("throws INVALID_PRIVATE_KEY for invalid base58 input", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");

      await expect(
        importSolanaWallet("not-a-valid-key!!!"),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PRIVATE_KEY,
      });
    });

    it("throws INVALID_PRIVATE_KEY for empty input", async () => {
      const { importSolanaWallet } = await import("../wallet/solana-import.js");

      await expect(
        importSolanaWallet(""),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PRIVATE_KEY,
      });
    });
  });
});
