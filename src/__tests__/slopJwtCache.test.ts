import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Temp directory for test files
const testDir = join(tmpdir(), `echo-slop-jwt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const testJwtFile = join(testDir, "slop-jwt.json");

vi.mock("../config/paths.js", () => ({
  SLOP_JWT_FILE: testJwtFile,
  CONFIG_DIR: testDir,
}));

vi.mock("../config/store.js", () => ({
  ensureConfigDir: () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  },
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const {
  loadCachedSlopJwt,
  saveCachedSlopJwt,
  clearCachedSlopJwt,
  isAccessValid,
} = await import("../slop/jwtCache.js");

/** Build a fake JWT with given payload */
function fakeJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

const WALLET = "0xabcdef1234567890abcdef1234567890abcdef12";

describe("slopJwtCache", () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe("loadCachedSlopJwt", () => {
    it("should return null when file is missing", () => {
      const result = loadCachedSlopJwt();
      expect(result).toBeNull();
    });

    it("should return cached data when access token is valid", () => {
      const cached = {
        accessToken: "access.tok",
        refreshToken: "refresh.tok",
        accessExpiresAt: Date.now() + 300_000, // 5 min from now
        refreshExpiresAt: Date.now() + 600_000,
        walletAddress: WALLET,
      };
      writeFileSync(testJwtFile, JSON.stringify(cached));

      const result = loadCachedSlopJwt();

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("access.tok");
    });

    it("should return cached data when access expired but refresh valid (caller refreshes)", () => {
      const cached = {
        accessToken: "expired.access",
        refreshToken: "valid.refresh",
        accessExpiresAt: Date.now() - 1000, // expired
        refreshExpiresAt: Date.now() + 600_000, // still valid
        walletAddress: WALLET,
      };
      writeFileSync(testJwtFile, JSON.stringify(cached));

      const result = loadCachedSlopJwt();

      expect(result).not.toBeNull();
      expect(result!.refreshToken).toBe("valid.refresh");
    });

    it("should return null and clear when both tokens expired", () => {
      const cached = {
        accessToken: "expired.access",
        refreshToken: "expired.refresh",
        accessExpiresAt: Date.now() - 120_000, // expired
        refreshExpiresAt: Date.now() - 60_000,  // expired
        walletAddress: WALLET,
      };
      writeFileSync(testJwtFile, JSON.stringify(cached));

      const result = loadCachedSlopJwt();

      expect(result).toBeNull();
      expect(existsSync(testJwtFile)).toBe(false);
    });

    it("should return null and clear on corrupt JSON", () => {
      writeFileSync(testJwtFile, "not valid json {{{");

      const result = loadCachedSlopJwt();

      expect(result).toBeNull();
      expect(existsSync(testJwtFile)).toBe(false);
    });
  });

  describe("isAccessValid", () => {
    it("should return true when access expires more than 60s from now", () => {
      const cached = {
        accessToken: "tok",
        refreshToken: "ref",
        accessExpiresAt: Date.now() + 120_000, // 2 min from now
        refreshExpiresAt: Date.now() + 600_000,
        walletAddress: WALLET,
      };
      expect(isAccessValid(cached)).toBe(true);
    });

    it("should return false when access expires within 60s buffer", () => {
      const cached = {
        accessToken: "tok",
        refreshToken: "ref",
        accessExpiresAt: Date.now() + 30_000, // 30s from now (within buffer)
        refreshExpiresAt: Date.now() + 600_000,
        walletAddress: WALLET,
      };
      expect(isAccessValid(cached)).toBe(false);
    });

    it("should return false when access is already expired", () => {
      const cached = {
        accessToken: "tok",
        refreshToken: "ref",
        accessExpiresAt: Date.now() - 1000,
        refreshExpiresAt: Date.now() + 600_000,
        walletAddress: WALLET,
      };
      expect(isAccessValid(cached)).toBe(false);
    });
  });

  describe("saveCachedSlopJwt", () => {
    it("should write cache file with correct expiry from JWT payload", () => {
      const now = Math.floor(Date.now() / 1000);
      const accessToken = fakeJwt({ sub: WALLET, exp: now + 3600 });
      const refreshToken = fakeJwt({ sub: WALLET, exp: now + 604800 });

      saveCachedSlopJwt(accessToken, refreshToken, WALLET);

      expect(existsSync(testJwtFile)).toBe(true);
      const saved = JSON.parse(readFileSync(testJwtFile, "utf-8"));
      expect(saved.accessToken).toBe(accessToken);
      expect(saved.refreshToken).toBe(refreshToken);
      expect(saved.walletAddress).toBe(WALLET);
      expect(saved.accessExpiresAt).toBeCloseTo((now + 3600) * 1000, -3);
    });

    it("should throw SLOP_AUTH_FAILED on wallet mismatch in JWT sub", () => {
      const now = Math.floor(Date.now() / 1000);
      const accessToken = fakeJwt({ sub: "0x0000000000000000000000000000000000000000", exp: now + 3600 });
      const refreshToken = fakeJwt({ sub: "0x0000000000000000000000000000000000000000", exp: now + 604800 });

      expect(() => saveCachedSlopJwt(accessToken, refreshToken, WALLET)).toThrow("Token wallet mismatch");
    });
  });

  describe("clearCachedSlopJwt", () => {
    it("should remove the cache file", () => {
      writeFileSync(testJwtFile, "{}");
      expect(existsSync(testJwtFile)).toBe(true);

      clearCachedSlopJwt();

      expect(existsSync(testJwtFile)).toBe(false);
    });

    it("should not throw when file does not exist", () => {
      expect(() => clearCachedSlopJwt()).not.toThrow();
    });
  });
});
