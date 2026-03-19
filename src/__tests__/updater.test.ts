import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(
  tmpdir(),
  `echo-updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: vi.fn().mockReturnValue(false),
  setJsonMode: vi.fn(),
  writeJsonSuccess: vi.fn(),
  writeJsonError: vi.fn(),
}));

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: any[]) => mockFetchJson(...args),
}));

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: testDir,
}));

vi.mock("../config/store.js", () => ({
  ensureConfigDir: () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  },
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockIsAutoUpdateEnabled = vi.fn(() => false);
vi.mock("../update/auto-update-preference.js", () => ({
  isAutoUpdateEnabled: (...args: any[]) => mockIsAutoUpdateEnabled(...args),
}));

const {
  compareSemver,
  checkForUpdates,
  fetchLatestVersion,
} = await import("../update/updater.js");

const { isHeadless } = await import("../utils/output.js");

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns 1 when a is newer", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
    expect(compareSemver("1.1.0", "1.0.0")).toBe(1);
    expect(compareSemver("1.0.1", "1.0.0")).toBe(1);
  });

  it("returns -1 when b is newer", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
  });

  it("ignores pre-release suffix for main comparison", () => {
    expect(compareSemver("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareSemver("2.0.0-alpha", "1.0.0")).toBe(1);
  });
});

describe("fetchLatestVersion", () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
  });

  it("returns version string from registry", async () => {
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });
    expect(await fetchLatestVersion()).toBe("2.0.0");
  });

  it("returns null on network error", async () => {
    mockFetchJson.mockRejectedValue(new Error("timeout"));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when response has no version field", async () => {
    mockFetchJson.mockResolvedValue({});
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe("checkForUpdates", () => {
  const origDisableCheck = process.env.ECHO_DISABLE_UPDATE_CHECK;

  beforeEach(() => {
    delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    mockFetchJson.mockReset();
    mockSpawn.mockReset();
    mockIsAutoUpdateEnabled.mockReset();
    mockIsAutoUpdateEnabled.mockReturnValue(false);
    vi.mocked(isHeadless).mockReturnValue(false);
  });

  afterEach(() => {
    if (origDisableCheck !== undefined) {
      process.env.ECHO_DISABLE_UPDATE_CHECK = origDisableCheck;
    } else {
      delete process.env.ECHO_DISABLE_UPDATE_CHECK;
    }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("returns disabled when ECHO_DISABLE_UPDATE_CHECK=1", async () => {
    process.env.ECHO_DISABLE_UPDATE_CHECK = "1";
    const result = await checkForUpdates("1.0.0");
    expect(result).toEqual({
      checked: false,
      currentVersion: "1.0.0",
      latestVersion: null,
      isNewer: false,
      action: "disabled",
    });
  });

  it("returns skipped in headless mode without explicit auto-update", async () => {
    vi.mocked(isHeadless).mockReturnValue(true);
    const result = await checkForUpdates("1.0.0");
    expect(result.action).toBe("skipped");
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("checks in headless mode when auto-update is explicitly enabled", async () => {
    vi.mocked(isHeadless).mockReturnValue(true);
    mockIsAutoUpdateEnabled.mockReturnValue(true);
    mockFetchJson.mockResolvedValue({ version: "1.0.0" });

    const result = await checkForUpdates("1.0.0", { forceCheck: true });

    expect(result.action).toBe("up-to-date");
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });

  it("returns up-to-date when versions match", async () => {
    mockFetchJson.mockResolvedValue({ version: "1.0.0" });
    const result = await checkForUpdates("1.0.0", { forceCheck: true });
    expect(result.action).toBe("up-to-date");
    expect(result.isNewer).toBe(false);
    expect(result.checked).toBe(true);
  });

  it("returns notified when newer version exists and auto-update is disabled", async () => {
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });
    const result = await checkForUpdates("1.0.0", { forceCheck: true });
    expect(result.action).toBe("notified");
    expect(result.isNewer).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("readOnly=true never triggers auto-update", async () => {
    mockIsAutoUpdateEnabled.mockReturnValue(true);
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });

    const result = await checkForUpdates("1.0.0", { forceCheck: true, readOnly: true });

    expect(result.action).toBe("notified");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("auto-update spawns npm install when newer and auto-update is enabled", async () => {
    mockIsAutoUpdateEnabled.mockReturnValue(true);
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });
    const mockChild = { pid: 12345, unref: vi.fn(), on: vi.fn() };
    mockSpawn.mockReturnValue(mockChild);

    const result = await checkForUpdates("1.0.0", { forceCheck: true });

    expect(result.action).toBe("auto-updated");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][0]).toBe("npm");
    expect(mockChild.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("returns already-notified for repeated notification of the same version", async () => {
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });

    const first = await checkForUpdates("1.0.0", { forceCheck: true });
    const second = await checkForUpdates("1.0.0", { forceCheck: true });

    expect(first.action).toBe("notified");
    expect(second.action).toBe("already-notified");
  });

  it("returns skipped on fetch failure", async () => {
    mockFetchJson.mockRejectedValue(new Error("network"));
    const result = await checkForUpdates("1.0.0", { forceCheck: true });
    expect(result.checked).toBe(true);
    expect(result.latestVersion).toBeNull();
    expect(result.action).toBe("skipped");
  });

  it("readOnly=true does not write state files", async () => {
    mockFetchJson.mockResolvedValue({ version: "2.0.0" });

    await checkForUpdates("1.0.0", { forceCheck: true, readOnly: true });

    expect(existsSync(join(testDir, "update-check.json"))).toBe(false);
  });
});
