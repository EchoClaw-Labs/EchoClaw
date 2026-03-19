import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before importing
const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: any[]) => mockFetchJson(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockLoadCachedSlopJwt = vi.fn();
const mockSaveCachedSlopJwt = vi.fn();
const mockClearCachedSlopJwt = vi.fn();
const mockIsAccessValid = vi.fn();

vi.mock("../slop/jwtCache.js", () => ({
  loadCachedSlopJwt: () => mockLoadCachedSlopJwt(),
  saveCachedSlopJwt: (...args: any[]) => mockSaveCachedSlopJwt(...args),
  clearCachedSlopJwt: () => mockClearCachedSlopJwt(),
  isAccessValid: (...args: any[]) => mockIsAccessValid(...args),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    signMessage: vi.fn().mockResolvedValue("0xmocksignature"),
  }),
}));

const { requireSlopAuth, slopRefresh } = await import("../slop/auth.js");

const PRIVATE_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WALLET = "0xabcdef1234567890abcdef1234567890abcdef12";
const BASE_URL = "http://localhost:3501/api";

describe("requireSlopAuth", () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
    mockLoadCachedSlopJwt.mockReset();
    mockSaveCachedSlopJwt.mockReset();
    mockClearCachedSlopJwt.mockReset();
    mockIsAccessValid.mockReset();
  });

  it("should return cached token when access is valid (cache hit)", async () => {
    const cached = {
      accessToken: "cached.access.token",
      refreshToken: "cached.refresh.token",
      accessExpiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 600_000,
      walletAddress: WALLET,
    };
    mockLoadCachedSlopJwt.mockReturnValue(cached);
    mockIsAccessValid.mockReturnValue(true);

    const token = await requireSlopAuth(PRIVATE_KEY, WALLET, BASE_URL);

    expect(token).toBe("cached.access.token");
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("should refresh when access expired but refresh is valid", async () => {
    const cached = {
      accessToken: "expired.access.token",
      refreshToken: "valid.refresh.token",
      accessExpiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 600_000,
      walletAddress: WALLET,
    };
    mockLoadCachedSlopJwt.mockReturnValue(cached);
    mockIsAccessValid.mockReturnValue(false);

    // Refresh succeeds
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "new.access.token",
        refreshToken: "new.refresh.token",
        accessExpiresIn: 3600,
        refreshExpiresIn: 604800,
      },
    });

    const token = await requireSlopAuth(PRIVATE_KEY, WALLET, BASE_URL);

    expect(token).toBe("new.access.token");
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson.mock.calls[0][0]).toContain("/auth/refresh");
    expect(mockSaveCachedSlopJwt).toHaveBeenCalled();
  });

  it("should do full login when both tokens expired (cache returns null)", async () => {
    mockLoadCachedSlopJwt.mockReturnValue(null);

    // Nonce request
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: { nonce: "test-nonce", message: "I am signing in to slop.money\n\nWallet: ..." },
    });
    // Verify request
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "fresh.access.token",
        refreshToken: "fresh.refresh.token",
        accessExpiresIn: 3600,
        refreshExpiresIn: 604800,
      },
    });

    const token = await requireSlopAuth(PRIVATE_KEY, WALLET, BASE_URL);

    expect(token).toBe("fresh.access.token");
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
    expect(mockFetchJson.mock.calls[0][0]).toContain("/auth/nonce");
    expect(mockFetchJson.mock.calls[1][0]).toContain("/auth/verify");
  });

  it("should clear cache and do full login on wallet mismatch", async () => {
    const cached = {
      accessToken: "other.access.token",
      refreshToken: "other.refresh.token",
      accessExpiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 600_000,
      walletAddress: "0x0000000000000000000000000000000000000000",
    };
    mockLoadCachedSlopJwt.mockReturnValue(cached);

    // Full login: nonce + verify
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: { nonce: "nonce-x", message: "sign msg" },
    });
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "correct.access.token",
        refreshToken: "correct.refresh.token",
        accessExpiresIn: 3600,
        refreshExpiresIn: 604800,
      },
    });

    const token = await requireSlopAuth(PRIVATE_KEY, WALLET, BASE_URL);

    expect(token).toBe("correct.access.token");
    expect(mockClearCachedSlopJwt).toHaveBeenCalled();
  });

  it("should fall back to full login when refresh fails", async () => {
    const cached = {
      accessToken: "expired.access.token",
      refreshToken: "bad.refresh.token",
      accessExpiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 600_000,
      walletAddress: WALLET,
    };
    mockLoadCachedSlopJwt.mockReturnValue(cached);
    mockIsAccessValid.mockReturnValue(false);

    // Refresh fails
    mockFetchJson.mockResolvedValueOnce({ success: false, error: "Token refresh failed" });
    // Full login succeeds
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: { nonce: "nonce-y", message: "sign msg" },
    });
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "fallback.access.token",
        refreshToken: "fallback.refresh.token",
        accessExpiresIn: 3600,
        refreshExpiresIn: 604800,
      },
    });

    const token = await requireSlopAuth(PRIVATE_KEY, WALLET, BASE_URL);

    expect(token).toBe("fallback.access.token");
  });
});

describe("slopRefresh", () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
    mockSaveCachedSlopJwt.mockReset();
    mockClearCachedSlopJwt.mockReset();
  });

  it("should save new tokens and return access token on success", async () => {
    mockFetchJson.mockResolvedValueOnce({
      success: true,
      data: {
        accessToken: "refreshed.access",
        refreshToken: "refreshed.refresh",
        accessExpiresIn: 3600,
        refreshExpiresIn: 604800,
      },
    });

    const token = await slopRefresh("old.refresh", WALLET, BASE_URL);

    expect(token).toBe("refreshed.access");
    expect(mockSaveCachedSlopJwt).toHaveBeenCalledWith("refreshed.access", "refreshed.refresh", WALLET);
  });

  it("should clear cache and throw SLOP_REFRESH_FAILED on failure", async () => {
    mockFetchJson.mockResolvedValueOnce({ success: false, error: "Refresh token expired" });

    await expect(slopRefresh("bad.refresh", WALLET, BASE_URL)).rejects.toThrow("Refresh token expired");
    expect(mockClearCachedSlopJwt).toHaveBeenCalled();
  });
});
