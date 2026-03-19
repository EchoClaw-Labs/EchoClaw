import { describe, it, expect, vi } from "vitest";

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
  detectProviders: () => ({
    openclaw: { detected: true },
    "claude-code": { detected: false },
    codex: { detected: false },
    other: { detected: true },
  }),
  resolveProvider: (name: string) => ({
    name,
    displayName: name,
    installSkill: () => ({ source: "/mock", target: "/mock" }),
    getSkillTargets: () => ({ userDir: "/mock", projectDir: null }),
    getRestartInfo: () => ({ instructions: [] }),
  }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
}));

const { defaultScopeForRuntime } = await import("../commands/echo/assessment.js");

describe("defaultScopeForRuntime", () => {
  it('returns "user" for openclaw', () => {
    expect(defaultScopeForRuntime("openclaw")).toBe("user");
  });

  it('returns "project" for claude-code', () => {
    expect(defaultScopeForRuntime("claude-code")).toBe("project");
  });

  it('returns "project" for codex', () => {
    expect(defaultScopeForRuntime("codex")).toBe("project");
  });

  it('returns "project" for other', () => {
    expect(defaultScopeForRuntime("other")).toBe("project");
  });
});
