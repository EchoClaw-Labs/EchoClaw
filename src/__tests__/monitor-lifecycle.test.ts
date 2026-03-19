import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mocks (before imports) ──────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockWriteStderr = vi.fn();
vi.mock("../utils/output.js", () => ({
  writeStderr: (...args: any[]) => mockWriteStderr(...args),
}));

vi.mock("../utils/ui.js", () => ({
  colors: { muted: (s: string) => s },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

vi.mock("../0g-compute/constants.js", () => ({
  ZG_MONITOR_PID_FILE: "/mock/monitor.pid",
  ZG_MONITOR_STATE_FILE: "/mock/monitor-state.json",
  ZG_MONITOR_SHUTDOWN_FILE: "/mock/monitor.shutdown",
}));

const mockKill = vi.fn();
const origKill = process.kill;

// ── Imports (after mocks) ───────────────────────────────────────────

const { getMonitorPid, isMonitorTrackingProvider, stopMonitorDaemon } =
  await import("../0g-compute/monitor-lifecycle.js");

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_PROVIDER = "0xBB3f5b0b5062CB5B3245222C5917afD1f6e13aF6";
const TEST_PID = 1234;

function setupAlive(pid = TEST_PID) {
  mockExistsSync.mockImplementation((path: string) => {
    if (path === "/mock/monitor.pid") return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(String(pid));
  mockKill.mockImplementation((_pid: number, signal?: string | number) => {
    if (signal === 0 || signal === undefined) return true;
  });
}

function setupAliveWithState(pid = TEST_PID, providers: string[] = [TEST_PROVIDER]) {
  mockExistsSync.mockImplementation((path: string) => {
    if (path === "/mock/monitor.pid") return true;
    if (path === "/mock/monitor-state.json") return true;
    if (path === "/mock/monitor.shutdown") return true;
    return false;
  });
  mockReadFileSync.mockImplementation((path: string) => {
    if (path === "/mock/monitor.pid") return String(pid);
    if (path === "/mock/monitor-state.json") return JSON.stringify({ providers });
    return "";
  });
  mockKill.mockImplementation((_pid: number, signal?: string | number) => {
    if (signal === 0 || signal === undefined) return true;
  });
}

function setupDead(pid = TEST_PID) {
  mockExistsSync.mockImplementation((path: string) => {
    if (path === "/mock/monitor.pid") return true;
    return false;
  });
  mockReadFileSync.mockReturnValue(String(pid));
  mockKill.mockImplementation(() => {
    throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
  });
}

function setupNoPidFile() {
  mockExistsSync.mockReturnValue(false);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("getMonitorPid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.kill = mockKill as any;
  });

  afterEach(() => {
    process.kill = origKill;
  });

  it("returns null when PID file does not exist", () => {
    setupNoPidFile();
    expect(getMonitorPid()).toBeNull();
  });

  it("returns PID when process is alive", () => {
    setupAlive(5678);
    expect(getMonitorPid()).toBe(5678);
  });

  it("returns null when process is dead (ESRCH)", () => {
    setupDead();
    expect(getMonitorPid()).toBeNull();
  });

  it("returns null when PID file contains invalid content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not-a-number");
    expect(getMonitorPid()).toBeNull();
  });
});

describe("isMonitorTrackingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.kill = mockKill as any;
  });

  afterEach(() => {
    process.kill = origKill;
  });

  it("returns false when no monitor is running", () => {
    setupNoPidFile();
    expect(isMonitorTrackingProvider(TEST_PROVIDER)).toBe(false);
  });

  it("returns true when monitor tracks the given provider", () => {
    setupAliveWithState(TEST_PID, [TEST_PROVIDER]);
    expect(isMonitorTrackingProvider(TEST_PROVIDER)).toBe(true);
  });

  it("returns false when monitor tracks a different provider", () => {
    setupAliveWithState(TEST_PID, ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    expect(isMonitorTrackingProvider(TEST_PROVIDER)).toBe(false);
  });

  it("matches provider address case-insensitively", () => {
    setupAliveWithState(TEST_PID, [TEST_PROVIDER.toLowerCase()]);
    expect(isMonitorTrackingProvider(TEST_PROVIDER.toUpperCase())).toBe(true);
  });

  it("returns false when no state file exists", () => {
    setupAlive();
    // setupAlive makes state file not exist by default
    expect(isMonitorTrackingProvider(TEST_PROVIDER)).toBe(false);
  });

  it("returns false when state file is unparseable", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return String(TEST_PID);
      if (path === "/mock/monitor-state.json") return "{{invalid json";
      return "";
    });
    mockKill.mockReturnValue(undefined);
    expect(isMonitorTrackingProvider(TEST_PROVIDER)).toBe(false);
  });
});

describe("stopMonitorDaemon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.kill = mockKill as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.kill = origKill;
  });

  it("returns stopped: true when no PID file exists", async () => {
    setupNoPidFile();
    const result = await stopMonitorDaemon();
    expect(result).toEqual({ stopped: true });
  });

  it("returns stopped: true and cleans up when PID is invalid", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("garbage");

    const result = await stopMonitorDaemon();
    expect(result).toEqual({ stopped: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/mock/monitor.pid");
  });

  it("returns stopped: true when process is already dead (ESRCH)", async () => {
    setupDead();

    const result = await stopMonitorDaemon();
    expect(result).toEqual({ stopped: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/mock/monitor.pid");
  });

  it("returns stopped: true when SIGTERM kills process on first poll", async () => {
    let pollCount = 0;
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM") return; // SIGTERM accepted
      if (signal === 0) {
        pollCount++;
        // First check (alive check) passes, second (poll) = dead
        if (pollCount >= 2) {
          throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        }
        return;
      }
    });

    const promise = stopMonitorDaemon({ silent: true });
    await vi.advanceTimersByTimeAsync(600); // past first poll interval
    const result = await promise;

    expect(result).toEqual({ stopped: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/mock/monitor.pid");
  });

  it("returns stopped: false with error on EPERM", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));
    mockKill.mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });

    const result = await stopMonitorDaemon();
    expect(result.stopped).toBe(false);
    expect(result.error).toContain("Cannot manage process");
  });

  it("falls back to SIGKILL when SIGTERM fails", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      if (path === "/mock/monitor.shutdown") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));

    let sigkillSent = false;
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM") return;
      if (signal === "SIGKILL") {
        sigkillSent = true;
        return;
      }
      if (signal === 0) {
        // Still alive until after SIGKILL
        if (sigkillSent) {
          throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        }
        return;
      }
    });

    const promise = stopMonitorDaemon({ silent: true });
    // Advance past SIGTERM polling (5s) + shutdown file polling (10s) + SIGKILL wait (1s)
    await vi.advanceTimersByTimeAsync(20000);
    const result = await promise;

    expect(result).toEqual({ stopped: true });
    expect(mockKill).toHaveBeenCalledWith(TEST_PID, "SIGKILL");
  });

  it("returns stopped: false when process is unkillable", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      if (path === "/mock/monitor.shutdown") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));

    // Process never dies
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM" || signal === "SIGKILL") return;
      // signal === 0: always alive
      return;
    });

    const promise = stopMonitorDaemon({ silent: true });
    await vi.advanceTimersByTimeAsync(20000);
    const result = await promise;

    expect(result.stopped).toBe(false);
    expect(result.error).toContain("Could not stop monitor");
  });

  it("does not call writeStderr when silent: true", async () => {
    setupDead();
    // Dead process = no writeStderr needed
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));

    // Alive then immediately dead on SIGTERM
    let firstCheck = true;
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM") return;
      if (signal === 0) {
        if (firstCheck) {
          firstCheck = false;
          return; // alive on first check
        }
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
    });

    const promise = stopMonitorDaemon({ silent: true });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(mockWriteStderr).not.toHaveBeenCalled();
  });

  it("calls writeStderr when not silent", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));

    let firstCheck = true;
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM") return;
      if (signal === 0) {
        if (firstCheck) {
          firstCheck = false;
          return;
        }
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
    });

    const promise = stopMonitorDaemon();
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(mockWriteStderr).toHaveBeenCalledWith(
      expect.stringContaining(`Stopping existing monitor (PID ${TEST_PID})`),
    );
  });

  it("writes shutdown file as fallback when SIGTERM fails", async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === "/mock/monitor.pid") return true;
      if (path === "/mock/monitor.shutdown") return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(String(TEST_PID));

    let shutdownWritten = false;
    mockWriteFileSync.mockImplementation(() => { shutdownWritten = true; });

    // Dies after shutdown file written
    mockKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM" || signal === "SIGKILL") return;
      if (signal === 0) {
        if (shutdownWritten) {
          throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        }
        return;
      }
    });

    const promise = stopMonitorDaemon({ silent: true });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result).toEqual({ stopped: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/mock/monitor.shutdown",
      expect.any(String),
      "utf-8",
    );
  });
});
