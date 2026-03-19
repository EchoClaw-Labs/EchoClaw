import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter, DetectionResult, SkillTargets, SkillInstallResult, RestartInfo } from "./types.js";
import { getSkillSourcePath, linkToTarget } from "./link-utils.js";

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly name = "claude-code" as const;
  readonly displayName = "Claude Code";

  detect(): DetectionResult {
    const claudeDir = join(homedir(), ".claude");
    return {
      detected: existsSync(claudeDir),
      detail: existsSync(claudeDir) ? "~/.claude/ directory found" : undefined,
    };
  }

  getSkillTargets(scope: "user" | "project"): SkillTargets {
    if (scope === "project") {
      return {
        userDir: join(homedir(), ".claude", "skills", "echoclaw"),
        projectDir: join(process.cwd(), ".claude", "skills", "echoclaw"),
      };
    }
    return {
      userDir: join(homedir(), ".claude", "skills", "echoclaw"),
    };
  }

  installSkill(opts: { scope: "user" | "project"; force: boolean }): SkillInstallResult {
    const source = getSkillSourcePath("echoclaw");
    const targets = this.getSkillTargets(opts.scope);
    const target = opts.scope === "project" && targets.projectDir
      ? targets.projectDir
      : targets.userDir;

    const { linkType } = linkToTarget(source, target, { force: opts.force });

    return {
      source,
      target,
      linkType,
      status: "linked",
    };
  }

  getRestartInfo(): RestartInfo {
    return {
      instructions: ["Restart Claude Code to pick up the new skill."],
      canAutomate: false,
    };
  }
}
