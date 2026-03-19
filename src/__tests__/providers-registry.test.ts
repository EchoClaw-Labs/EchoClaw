import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs to control detection
const mockExistsSync = vi.fn();
vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, existsSync: (...args: any[]) => mockExistsSync(...args) };
});

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { resolveProvider, detectProviders, autoDetectProvider } = await import("../providers/registry.js");

describe("resolveProvider", () => {
  it("should resolve 'openclaw'", () => {
    const adapter = resolveProvider("openclaw");
    expect(adapter.name).toBe("openclaw");
    expect(adapter.displayName).toBe("OpenClaw");
  });

  it("should resolve 'claude' as alias for 'claude-code'", () => {
    const adapter = resolveProvider("claude");
    expect(adapter.name).toBe("claude-code");
    expect(adapter.displayName).toBe("Claude Code");
  });

  it("should resolve 'claude-code'", () => {
    const adapter = resolveProvider("claude-code");
    expect(adapter.name).toBe("claude-code");
  });

  it("should resolve 'codex'", () => {
    const adapter = resolveProvider("codex");
    expect(adapter.name).toBe("codex");
  });

  it("should resolve 'other'", () => {
    const adapter = resolveProvider("other");
    expect(adapter.name).toBe("other");
  });

  it("should throw on unknown provider", () => {
    expect(() => resolveProvider("unknown")).toThrow("Unknown provider");
  });
});

describe("detectProviders", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
  });

  it("should return detection results for all providers", () => {
    mockExistsSync.mockReturnValue(false);
    const results = detectProviders();
    expect(results).toHaveProperty("openclaw");
    expect(results).toHaveProperty("claude-code");
    expect(results).toHaveProperty("codex");
    expect(results).toHaveProperty("other");
  });

  it("should detect 'other' as always detected", () => {
    mockExistsSync.mockReturnValue(false);
    const results = detectProviders();
    expect(results.other.detected).toBe(true);
  });
});

describe("autoDetectProvider", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
  });

  it("should return openclaw when ~/.openclaw exists", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes(".openclaw"));
    const adapter = autoDetectProvider();
    expect(adapter.name).toBe("openclaw");
  });

  it("should return claude-code when only ~/.claude exists", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes(".claude"));
    const adapter = autoDetectProvider();
    expect(adapter.name).toBe("claude-code");
  });

  it("should return codex when only ~/.agents exists", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes(".agents"));
    const adapter = autoDetectProvider();
    expect(adapter.name).toBe("codex");
  });

  it("should return other when nothing detected", () => {
    mockExistsSync.mockReturnValue(false);
    const adapter = autoDetectProvider();
    expect(adapter.name).toBe("other");
  });
});
