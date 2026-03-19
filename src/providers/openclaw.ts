import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter, DetectionResult, SkillTargets, SkillInstallResult, RestartInfo } from "./types.js";
import { linkOpenclawSkill } from "../setup/openclaw-link.js";
import { getOpenclawHome, loadOpenclawConfig } from "../openclaw/config.js";
import { getSkillSourcePath, linkToTarget } from "./link-utils.js";

export class OpenClawAdapter implements ProviderAdapter {
  readonly name = "openclaw" as const;
  readonly displayName = "OpenClaw";

  detect(): DetectionResult {
    const home = getOpenclawHome();
    if (!existsSync(home)) {
      return { detected: false };
    }

    // Check for openclaw.json or the binary
    const configExists = existsSync(join(home, "openclaw.json"));
    let version: string | undefined;
    try {
      const config = loadOpenclawConfig();
      version = config?.version as string | undefined;
    } catch {
      // ignore
    }

    return {
      detected: configExists || existsSync(home),
      version,
      detail: configExists ? "openclaw.json found" : "~/.openclaw/ directory found",
    };
  }

  getSkillTargets(scope: "user" | "project"): SkillTargets {
    if (scope === "project") {
      return {
        userDir: join(homedir(), ".openclaw", "skills", "echoclaw"),
        projectDir: join(process.cwd(), "skills", "echoclaw"),
      };
    }
    return {
      userDir: join(homedir(), ".openclaw", "skills", "echoclaw"),
      workspaceDir: join(homedir(), ".openclaw", "workspace", "skills", "echoclaw"),
    };
  }

  installSkill(opts: { scope: "user" | "project"; force: boolean }): SkillInstallResult {
    if (opts.scope === "project") {
      const source = getSkillSourcePath("echoclaw");
      const targets = this.getSkillTargets("project");
      const target = targets.projectDir ?? targets.userDir;
      const { linkType } = linkToTarget(source, target, { force: opts.force });

      return {
        source,
        target,
        linkType,
        status: "linked",
      };
    }

    // Delegate to existing linkOpenclawSkill (proven, tested)
    const result = linkOpenclawSkill("echoclaw", { force: opts.force });
    return {
      source: result.source,
      target: result.target,
      linkType: result.linkType,
      status: "linked",
      additionalTargets: [
        { target: result.workspaceTarget, linked: result.workspaceLinked },
      ],
    };
  }

  getRestartInfo(): RestartInfo {
    return {
      instructions: ["OpenClaw will hot-reload the skill automatically."],
      canAutomate: true,
    };
  }
}
