import { describe, it, expect, vi } from "vitest";

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
}));

const { runtimeLabel, RUNTIME_OPTIONS } = await import(
  "../launcher/ui/src/utils/runtime-meta.js"
);

describe("runtimeLabel", () => {
  it('returns "OpenClaw" for openclaw', () => {
    expect(runtimeLabel("openclaw")).toBe("OpenClaw");
  });

  it('returns "EchoClaw Agent" for echoclaw', () => {
    expect(runtimeLabel("echoclaw")).toBe("EchoClaw Agent");
  });

  it('returns "Claude Code" for claude-code', () => {
    expect(runtimeLabel("claude-code")).toBe("Claude Code");
  });

  it('returns "Codex" for codex', () => {
    expect(runtimeLabel("codex")).toBe("Codex");
  });

  it('returns "Other" for other', () => {
    expect(runtimeLabel("other")).toBe("Other");
  });

  it("returns capitalized fallback for unknown keys", () => {
    const result = runtimeLabel("unknown-thing");
    expect(result.charAt(0)).toMatch(/[A-Z]/);
    expect(result).toBe("Unknown-thing");
  });
});

describe("RUNTIME_OPTIONS", () => {
  it("has exactly 4 entries", () => {
    expect(RUNTIME_OPTIONS).toHaveLength(4);
  });

  it("first entry is openclaw", () => {
    expect(RUNTIME_OPTIONS[0].key).toBe("openclaw");
  });

  it("all entries have descriptions", () => {
    for (const opt of RUNTIME_OPTIONS) {
      expect(opt.description.length).toBeGreaterThan(0);
    }
  });
});
