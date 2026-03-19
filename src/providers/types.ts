export type ProviderName = "openclaw" | "claude-code" | "codex" | "other";

export interface SkillTargets {
  userDir: string;
  projectDir?: string;
  workspaceDir?: string;
}

export interface DetectionResult {
  detected: boolean;
  version?: string;
  detail?: string;
}

export interface SkillInstallResult {
  source: string;
  target: string;
  linkType: "symlink" | "junction" | "copy" | "manual";
  status: "linked" | "manual_required";
  additionalTargets?: Array<{ target: string; linked: boolean }>;
  message?: string;
}

export interface RestartInfo {
  instructions: string[];
  canAutomate: boolean;
  command?: string;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  readonly displayName: string;

  detect(): DetectionResult;
  getSkillTargets(scope: "user" | "project"): SkillTargets;
  installSkill(opts: { scope: "user" | "project"; force: boolean }): SkillInstallResult;
  getRestartInfo(): RestartInfo;
}
