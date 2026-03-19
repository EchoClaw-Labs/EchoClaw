import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mocks (before imports) ──────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

const mockKill = vi.fn();
const origKill = process.kill;

// ── Imports (after mocks) ───────────────────────────────────────────

const { maybeResurrectDaemons } = await import("../utils/daemon-resurrect.js");

import type { DaemonResurrectConfig } from "../utils/daemon-resurrect.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<DaemonResurrectConfig>): DaemonResurrectConfig {
  return {
    name: "TestDaemon",
    pidFile: "/tmp/test.pid",
    shouldBeRunning: () => true,
    resurrect: vi.fn(),
    ...overrides,
  };
}

/** Simulate a running process by having existsSync + readFileSync + process.kill succeed */
function setupAlive(pid = 1234) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(String(pid));
  mockKill.mockReturnValue(undefined); // signal 0 succeeds = alive
}

/** Simulate a dead process (PID file exists but kill throws ESRCH) */
function setupDead(pid = 9999) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(String(pid));
  mockKill.mockImplementation(() => { throw new Error("ESRCH"); });
}

/** Simulate no PID file */
function setupNoPidFile() {
  mockExistsSync.mockReturnValue(false);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("maybeResurrectDaemons", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockKill.mockReset();
    process.kill = mockKill as any;
  });

  afterEach(() => {
    process.kill = origKill;
  });

  it("skips daemon when it is alive", () => {
    setupAlive();
    const cfg = makeConfig();

    maybeResurrectDaemons([cfg]);

    expect(cfg.resurrect).not.toHaveBeenCalled();
  });

  it("resurrects daemon when dead and shouldBeRunning returns true", () => {
    setupDead();
    const cfg = makeConfig({ shouldBeRunning: () => true });

    maybeResurrectDaemons([cfg]);

    expect(cfg.resurrect).toHaveBeenCalledTimes(1);
  });

  it("skips daemon when dead but shouldBeRunning returns false", () => {
    setupDead();
    const cfg = makeConfig({ shouldBeRunning: () => false });

    maybeResurrectDaemons([cfg]);

    expect(cfg.resurrect).not.toHaveBeenCalled();
  });

  it("resurrects when PID file does not exist and shouldBeRunning is true", () => {
    setupNoPidFile();
    const cfg = makeConfig({ shouldBeRunning: () => true });

    maybeResurrectDaemons([cfg]);

    expect(cfg.resurrect).toHaveBeenCalledTimes(1);
  });

  it("does not throw when resurrect throws", () => {
    setupDead();
    const cfg = makeConfig({
      resurrect: vi.fn(() => { throw new Error("spawn failed"); }),
    });

    expect(() => maybeResurrectDaemons([cfg])).not.toThrow();
  });

  it("does not throw when shouldBeRunning throws", () => {
    setupDead();
    const cfg = makeConfig({
      shouldBeRunning: () => { throw new Error("fs error"); },
    });

    expect(() => maybeResurrectDaemons([cfg])).not.toThrow();
    expect(cfg.resurrect).not.toHaveBeenCalled();
  });

  it("processes multiple configs independently", () => {
    const cfg1 = makeConfig({ name: "D1", pidFile: "/tmp/d1.pid", resurrect: vi.fn() });
    const cfg2 = makeConfig({ name: "D2", pidFile: "/tmp/d2.pid", resurrect: vi.fn() });
    const cfg3 = makeConfig({ name: "D3", pidFile: "/tmp/d3.pid", shouldBeRunning: () => false, resurrect: vi.fn() });

    // All PID files missing → all "dead"
    setupNoPidFile();

    maybeResurrectDaemons([cfg1, cfg2, cfg3]);

    expect(cfg1.resurrect).toHaveBeenCalledTimes(1);
    expect(cfg2.resurrect).toHaveBeenCalledTimes(1);
    expect(cfg3.resurrect).not.toHaveBeenCalled(); // shouldBeRunning=false
  });

  it("continues processing after one config throws", () => {
    setupNoPidFile();
    const cfg1 = makeConfig({
      name: "D1",
      resurrect: vi.fn(() => { throw new Error("boom"); }),
    });
    const cfg2 = makeConfig({ name: "D2", resurrect: vi.fn() });

    maybeResurrectDaemons([cfg1, cfg2]);

    expect(cfg1.resurrect).toHaveBeenCalledTimes(1);
    expect(cfg2.resurrect).toHaveBeenCalledTimes(1);
  });

  it("handles empty config array", () => {
    expect(() => maybeResurrectDaemons([])).not.toThrow();
  });
});

describe("ECHO_NO_RESURRECT guard (contract)", () => {
  it("function itself does not check env — guard is caller's responsibility (cli.ts)", () => {
    // spawnDetached sets ECHO_NO_RESURRECT=1 on child processes.
    // cli.ts preAction checks this env var and skips calling maybeResurrectDaemons.
    // The function itself does not filter — verify it still runs when env is set.
    process.kill = mockKill as any;
    setupNoPidFile();
    const cfg = makeConfig({ shouldBeRunning: () => true });

    const origVal = process.env.ECHO_NO_RESURRECT;
    process.env.ECHO_NO_RESURRECT = "1";
    try {
      maybeResurrectDaemons([cfg]);
      // Function still calls resurrect — guard must be at call site
      expect(cfg.resurrect).toHaveBeenCalledTimes(1);
    } finally {
      if (origVal !== undefined) process.env.ECHO_NO_RESURRECT = origVal;
      else delete process.env.ECHO_NO_RESURRECT;
      process.kill = origKill;
    }
  });
});
