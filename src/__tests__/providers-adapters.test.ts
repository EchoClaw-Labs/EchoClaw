import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

// Mock fs for detection tests
const mockExistsSync = vi.fn();
const mockLinkOpenclawSkill = vi.fn().mockReturnValue({
  source: "/mock/skills/echoclaw",
  target: join(homedir(), ".openclaw", "skills", "echoclaw"),
  linkType: "symlink",
  workspaceTarget: join(homedir(), ".openclaw", "workspace", "skills", "echoclaw"),
  workspaceLinked: true,
});
const mockGetSkillSourcePath = vi.fn().mockReturnValue("/mock/skills/echoclaw");
const mockLinkToTarget = vi.fn().mockReturnValue({ linkType: "symlink" });

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => join(homedir(), ".openclaw"),
  loadOpenclawConfig: () => null,
}));

vi.mock("../setup/openclaw-link.js", () => ({
  linkOpenclawSkill: (...args: any[]) => mockLinkOpenclawSkill(...args),
}));

vi.mock("../providers/link-utils.js", () => ({
  getSkillSourcePath: (...args: any[]) => mockGetSkillSourcePath(...args),
  linkToTarget: (...args: any[]) => mockLinkToTarget(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { OpenClawAdapter } = await import("../providers/openclaw.js");
const { ClaudeCodeAdapter } = await import("../providers/claude-code.js");
const { CodexAdapter } = await import("../providers/codex.js");
const { OtherAdapter } = await import("../providers/other.js");

describe("OpenClawAdapter", () => {
  const adapter = new OpenClawAdapter();

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockLinkOpenclawSkill.mockClear();
    mockGetSkillSourcePath.mockClear();
    mockLinkToTarget.mockClear();
  });

  it("should have correct name and displayName", () => {
    expect(adapter.name).toBe("openclaw");
    expect(adapter.displayName).toBe("OpenClaw");
  });

  it("should detect when ~/.openclaw exists", () => {
    mockExistsSync.mockReturnValue(true);
    expect(adapter.detect().detected).toBe(true);
  });

  it("should not detect when ~/.openclaw missing", () => {
    mockExistsSync.mockReturnValue(false);
    expect(adapter.detect().detected).toBe(false);
  });

  it("should return correct user skill targets", () => {
    const targets = adapter.getSkillTargets("user");
    expect(targets.userDir).toBe(join(homedir(), ".openclaw", "skills", "echoclaw"));
    expect(targets.workspaceDir).toBe(join(homedir(), ".openclaw", "workspace", "skills", "echoclaw"));
  });

  it("should return correct project skill targets", () => {
    const targets = adapter.getSkillTargets("project");
    expect(targets.projectDir).toBe(join(process.cwd(), "skills", "echoclaw"));
  });

  it("should delegate installSkill to linkOpenclawSkill", () => {
    const result = adapter.installSkill({ scope: "user", force: false });
    expect(mockLinkOpenclawSkill).toHaveBeenCalledWith("echoclaw", { force: false });
    expect(result.status).toBe("linked");
    expect(result.linkType).toBe("symlink");
    expect(result.additionalTargets).toBeDefined();
  });

  it("should install to project scope when scope=project", () => {
    const result = adapter.installSkill({ scope: "project", force: true });
    expect(mockGetSkillSourcePath).toHaveBeenCalledWith("echoclaw");
    expect(mockLinkToTarget).toHaveBeenCalledWith(
      "/mock/skills/echoclaw",
      join(process.cwd(), "skills", "echoclaw"),
      { force: true },
    );
    expect(result.target).toBe(join(process.cwd(), "skills", "echoclaw"));
    expect(result.additionalTargets).toBeUndefined();
  });

  it("should report hot-reload capability", () => {
    const info = adapter.getRestartInfo();
    expect(info.canAutomate).toBe(true);
    expect(info.instructions[0]).toContain("hot-reload");
  });
});

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  beforeEach(() => {
    mockExistsSync.mockReset();
  });

  it("should have correct name and displayName", () => {
    expect(adapter.name).toBe("claude-code");
    expect(adapter.displayName).toBe("Claude Code");
  });

  it("should detect when ~/.claude exists", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes(".claude"));
    expect(adapter.detect().detected).toBe(true);
  });

  it("should not detect when ~/.claude missing", () => {
    mockExistsSync.mockReturnValue(false);
    expect(adapter.detect().detected).toBe(false);
  });

  it("should return user skill target at ~/.claude/skills/echoclaw", () => {
    const targets = adapter.getSkillTargets("user");
    expect(targets.userDir).toBe(join(homedir(), ".claude", "skills", "echoclaw"));
  });

  it("should return project skill target at .claude/skills/echoclaw", () => {
    const targets = adapter.getSkillTargets("project");
    expect(targets.projectDir).toBe(join(process.cwd(), ".claude", "skills", "echoclaw"));
  });

  it("should require restart (no hot-reload)", () => {
    const info = adapter.getRestartInfo();
    expect(info.canAutomate).toBe(false);
    expect(info.instructions[0]).toContain("Restart Claude Code");
  });
});

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  beforeEach(() => {
    mockExistsSync.mockReset();
  });

  it("should have correct name and displayName", () => {
    expect(adapter.name).toBe("codex");
    expect(adapter.displayName).toBe("Codex");
  });

  it("should detect when ~/.agents exists", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes(".agents"));
    expect(adapter.detect().detected).toBe(true);
  });

  it("should not detect when ~/.agents missing", () => {
    mockExistsSync.mockReturnValue(false);
    expect(adapter.detect().detected).toBe(false);
  });

  it("should return user skill target at ~/.agents/skills/echoclaw", () => {
    const targets = adapter.getSkillTargets("user");
    expect(targets.userDir).toBe(join(homedir(), ".agents", "skills", "echoclaw"));
  });

  it("should return project skill target at .agents/skills/echoclaw", () => {
    const targets = adapter.getSkillTargets("project");
    expect(targets.projectDir).toBe(join(process.cwd(), ".agents", "skills", "echoclaw"));
  });

  it("should require restart", () => {
    const info = adapter.getRestartInfo();
    expect(info.canAutomate).toBe(false);
    expect(info.instructions[0]).toContain("Restart Codex");
  });
});

describe("OtherAdapter", () => {
  const adapter = new OtherAdapter();

  it("should have correct name", () => {
    expect(adapter.name).toBe("other");
  });

  it("should always detect as true", () => {
    expect(adapter.detect().detected).toBe(true);
  });

  it("should always return manual_required on installSkill", () => {
    const result = adapter.installSkill({ scope: "user", force: false });
    expect(result.status).toBe("manual_required");
    expect(result.linkType).toBe("manual");
    expect(result.message).toContain("Move or symlink");
  });

  it("should provide manual restart instructions", () => {
    const info = adapter.getRestartInfo();
    expect(info.canAutomate).toBe(false);
    expect(info.instructions[0]).toContain("Move or symlink");
  });
});
