import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getSkillHooksEnv: vi.fn().mockReturnValue({}),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockOpenSync = vi.fn().mockReturnValue(42);
const mockCloseSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  openSync: (...args: any[]) => mockOpenSync(...args),
  closeSync: (...args: any[]) => mockCloseSync(...args),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock("../0g-compute/constants.js", () => ({
  ZG_COMPUTE_DIR: "/mock/0g-compute",
  ZG_MONITOR_LOG_FILE: "/mock/0g-compute/monitor.log",
  ZG_MONITOR_PID_FILE: "/mock/0g-compute/monitor.pid",
}));

vi.mock("../claude/constants.js", () => ({
  CLAUDE_PROXY_DIR: "/mock/config/claude-proxy",
  CLAUDE_PROXY_LOG_FILE: "/mock/config/claude-proxy/proxy.log",
  CLAUDE_PROXY_PID_FILE: "/mock/config/claude-proxy/proxy.pid",
}));

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: "/mock/config",
  BOT_DIR: "/mock/bot",
  BOT_LOG_FILE: "/mock/bot/bot.log",
  BOT_PID_FILE: "/mock/bot/bot.pid",
}));

const mockKill = vi.fn();
const origKill = process.kill;

const { spawnMonitorFromState, spawnBotDaemon, spawnClaudeProxy } =
  await import("../utils/daemon-spawn.js");

function resetMocks(): void {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockOpenSync.mockReset().mockReturnValue(42);
  mockCloseSync.mockReset();
  mockSpawn.mockReset();
  mockKill.mockReset();
  process.kill = mockKill as any;
}

function setupAlive(pid = 1234): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(String(pid));
  mockKill.mockReturnValue(undefined);
}

function setupNoPidFile(): void {
  mockExistsSync.mockImplementation((path: string) => !path.endsWith(".pid"));
}

function setupMockChild(pid = 5678) {
  const child = { pid, unref: vi.fn() };
  mockSpawn.mockReturnValue(child);
  return child;
}

describe("spawnClaudeProxy", () => {
  beforeEach(resetMocks);
  afterEach(() => {
    process.kill = origKill;
  });

  it("returns already_running when proxy is alive", () => {
    setupAlive();
    const result = spawnClaudeProxy();
    expect(result).toEqual({ status: "already_running" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns detached Claude proxy when not running", () => {
    setupNoPidFile();
    const child = setupMockChild(6789);

    const result = spawnClaudeProxy();

    expect(result).toEqual({
      status: "spawned",
      pid: child.pid,
      logFile: "/mock/config/claude-proxy/proxy.log",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toEqual(expect.arrayContaining(["echo", "claude", "proxy", "--daemon-child"]));
  });
});

describe("spawnMonitorFromState", () => {
  beforeEach(resetMocks);
  afterEach(() => {
    process.kill = origKill;
  });

  it("returns already_running when monitor is alive", () => {
    setupAlive();
    const result = spawnMonitorFromState();
    expect(result).toEqual({ status: "already_running" });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("spawns with correct args and no --daemon flag", () => {
    setupNoPidFile();
    const child = setupMockChild();

    const result = spawnMonitorFromState();

    expect(result).toEqual({
      status: "spawned",
      pid: child.pid,
      logFile: "/mock/0g-compute/monitor.log",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toEqual(
      expect.arrayContaining(["0g-compute", "monitor", "start", "--from-state"]),
    );
    expect(spawnArgs).not.toContain("--daemon");
  });
});

describe("spawnBotDaemon", () => {
  beforeEach(resetMocks);
  afterEach(() => {
    process.kill = origKill;
  });

  it("returns already_running when bot is alive", () => {
    setupAlive();
    const result = spawnBotDaemon();
    expect(result).toEqual({ status: "already_running" });
  });

  it("spawns with correct args", () => {
    setupNoPidFile();
    const child = setupMockChild();

    const result = spawnBotDaemon();

    expect(result).toEqual({
      status: "spawned",
      pid: child.pid,
      logFile: "/mock/bot/bot.log",
    });

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toEqual(expect.arrayContaining(["marketmaker", "start"]));
  });

  it("creates log dir if missing", () => {
    mockExistsSync.mockReturnValue(false);
    setupMockChild();

    spawnBotDaemon();

    expect(mockMkdirSync).toHaveBeenCalledWith("/mock/bot", { recursive: true });
  });

  it("passes ECHO_NO_RESURRECT=1 in child env", () => {
    setupNoPidFile();
    setupMockChild();

    spawnBotDaemon();

    const spawnOpts = mockSpawn.mock.calls[0][2] as { env: Record<string, string> };
    expect(spawnOpts.env.ECHO_NO_RESURRECT).toBe("1");
  });
});
