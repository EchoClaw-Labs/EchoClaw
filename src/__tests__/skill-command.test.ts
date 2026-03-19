import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────

const mockResolveProvider = vi.fn();
const mockAutoDetectProvider = vi.fn();
const mockDetectProviders = vi.fn();

vi.mock("../providers/registry.js", () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args),
  autoDetectProvider: (...args: any[]) => mockAutoDetectProvider(...args),
  detectProviders: (...args: any[]) => mockDetectProviders(...args),
}));

vi.mock("../providers/link-utils.js", () => ({
  getSkillSourcePath: () => "/mock/package/skills/echoclaw",
}));

let headlessMode = false;
vi.mock("../utils/output.js", () => ({
  isHeadless: () => headlessMode,
  writeStderr: vi.fn(),
}));

vi.mock("../utils/ui.js", () => ({
  colors: {
    success: (s: string) => s,
    warn: (s: string) => s,
    info: (s: string) => s,
    bold: (s: string) => s,
    muted: (s: string) => s,
  },
}));

const { handleSkillInstall } = await import("../commands/skill.js");

// Helper: capture stdout writes
function captureStdout(): { output: string; restore: () => void } {
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any) => {
    output += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  }) as any;
  return {
    get output() { return output; },
    restore: () => { process.stdout.write = original; },
  };
}

function makeAdapter(overrides: Record<string, any> = {}) {
  return {
    name: "claude-code",
    displayName: "Claude Code",
    detect: () => ({ detected: true }),
    getSkillTargets: () => ({ userDir: "/mock/.claude/skills/echoclaw" }),
    installSkill: () => ({
      source: "/mock/package/skills/echoclaw",
      target: "/mock/.claude/skills/echoclaw",
      linkType: "symlink",
      status: "linked",
    }),
    getRestartInfo: () => ({
      instructions: ["Restart Claude Code to pick up the new skill."],
      canAutomate: false,
    }),
    ...overrides,
  };
}

describe("handleSkillInstall", () => {
  beforeEach(() => {
    headlessMode = true; // default to headless for JSON output tests
    mockResolveProvider.mockReset();
    mockAutoDetectProvider.mockReset();
    mockDetectProviders.mockReset();
  });

  it("should output JSON with status 'linked' for --provider claude", async () => {
    const adapter = makeAdapter();
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "claude", scope: "user" });
    } finally {
      capture.restore();
    }

    const result = JSON.parse(capture.output.trim());
    expect(result.success).toBe(true);
    expect(result.status).toBe("linked");
    expect(result.provider).toBe("claude-code");
    expect(result.target).toBe("/mock/.claude/skills/echoclaw");
    expect(result.linkType).toBe("symlink");
    expect(result.sourcePath).toBe("/mock/package/skills/echoclaw");
    expect(result.restart).toContain("Restart Claude Code");
  });

  it("should output JSON with status 'manual_required' for --provider other", async () => {
    const adapter = makeAdapter({
      name: "other",
      installSkill: () => ({
        source: "/mock/package/skills/echoclaw",
        target: "/mock/package/skills/echoclaw",
        linkType: "manual",
        status: "manual_required",
        message: "Move or symlink this directory into your framework's skills directory.",
      }),
    });
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "other", scope: "user" });
    } finally {
      capture.restore();
    }

    const result = JSON.parse(capture.output.trim());
    expect(result.success).toBe(true);
    expect(result.status).toBe("manual_required");
    expect(result.provider).toBe("other");
    expect(result.sourcePath).toBe("/mock/package/skills/echoclaw");
    expect(result.message).toContain("Move or symlink");
  });

  it("should auto-detect provider in headless mode when no --provider given", async () => {
    const adapter = makeAdapter({ name: "openclaw" });
    mockAutoDetectProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ scope: "user" });
    } finally {
      capture.restore();
    }

    expect(mockAutoDetectProvider).toHaveBeenCalledOnce();
    const result = JSON.parse(capture.output.trim());
    expect(result.status).toBe("linked");
  });

  it("should graceful fallback on link failure", async () => {
    const adapter = makeAdapter({
      installSkill: () => { throw new Error("EPERM"); },
    });
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "claude", scope: "user" });
    } finally {
      capture.restore();
    }

    const result = JSON.parse(capture.output.trim());
    expect(result.success).toBe(true);
    expect(result.status).toBe("manual_required");
    expect(result.sourcePath).toBe("/mock/package/skills/echoclaw");
  });

  it("should pass --force to adapter", async () => {
    const installSkill = vi.fn().mockReturnValue({
      source: "/mock/package/skills/echoclaw",
      target: "/mock/.claude/skills/echoclaw",
      linkType: "symlink",
      status: "linked",
    });
    const adapter = makeAdapter({ installSkill });
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "claude", scope: "user", force: true });
    } finally {
      capture.restore();
    }

    expect(installSkill).toHaveBeenCalledWith({ scope: "user", force: true });
  });

  it("should pass --scope project to adapter", async () => {
    const installSkill = vi.fn().mockReturnValue({
      source: "/mock/package/skills/echoclaw",
      target: "/mock/.claude/skills/echoclaw",
      linkType: "symlink",
      status: "linked",
    });
    const adapter = makeAdapter({ installSkill });
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "claude", scope: "project" });
    } finally {
      capture.restore();
    }

    expect(installSkill).toHaveBeenCalledWith({ scope: "project", force: false });
  });

  it("should resolve 'codex' provider with correct target path pattern", async () => {
    const adapter = makeAdapter({
      name: "codex",
      installSkill: () => ({
        source: "/mock/package/skills/echoclaw",
        target: "/mock/.agents/skills/echoclaw",
        linkType: "symlink",
        status: "linked",
      }),
      getRestartInfo: () => ({
        instructions: ["Restart Codex CLI to pick up the new skill."],
        canAutomate: false,
      }),
    });
    mockResolveProvider.mockReturnValue(adapter);

    const capture = captureStdout();
    try {
      await handleSkillInstall({ provider: "codex", scope: "user" });
    } finally {
      capture.restore();
    }

    const result = JSON.parse(capture.output.trim());
    expect(result.provider).toBe("codex");
    expect(result.target).toBe("/mock/.agents/skills/echoclaw");
  });

  it("should reject invalid provider value", async () => {
    await expect(handleSkillInstall({ provider: "nope", scope: "user" }))
      .rejects
      .toThrow('Invalid --provider "nope"');
  });

  it("should reject invalid scope value", async () => {
    await expect(handleSkillInstall({ provider: "claude", scope: "workspace" }))
      .rejects
      .toThrow('Invalid --scope "workspace"');
  });
});
