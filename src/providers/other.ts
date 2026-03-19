import type { ProviderAdapter, DetectionResult, SkillTargets, SkillInstallResult, RestartInfo } from "./types.js";
import { getSkillSourcePath } from "./link-utils.js";

export class OtherAdapter implements ProviderAdapter {
  readonly name = "other" as const;
  readonly displayName = "Other";

  detect(): DetectionResult {
    return { detected: true };
  }

  getSkillTargets(): SkillTargets {
    return { userDir: getSkillSourcePath("echoclaw") };
  }

  installSkill(): SkillInstallResult {
    const source = getSkillSourcePath("echoclaw");
    return {
      source,
      target: source,
      linkType: "manual",
      status: "manual_required",
      message: "Move or symlink this directory into your framework's skills directory.",
    };
  }

  getRestartInfo(): RestartInfo {
    return {
      instructions: ["Move or symlink the skill directory into your framework."],
      canAutomate: false,
    };
  }
}
