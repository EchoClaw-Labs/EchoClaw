import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter, DetectionResult, SkillTargets, SkillInstallResult, RestartInfo } from "./types.js";
import { getSkillSourcePath, linkToTarget } from "./link-utils.js";

export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex" as const;
  readonly displayName = "Codex";

  detect(): DetectionResult {
    const agentsDir = join(homedir(), ".agents");
    return {
      detected: existsSync(agentsDir),
      detail: existsSync(agentsDir) ? "~/.agents/ directory found" : undefined,
    };
  }

  getSkillTargets(scope: "user" | "project"): SkillTargets {
    if (scope === "project") {
      return {
        userDir: join(homedir(), ".agents", "skills", "echoclaw"),
        projectDir: join(process.cwd(), ".agents", "skills", "echoclaw"),
      };
    }
    return {
      userDir: join(homedir(), ".agents", "skills", "echoclaw"),
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
      instructions: ["Restart Codex CLI to pick up the new skill."],
      canAutomate: false,
    };
  }
}
