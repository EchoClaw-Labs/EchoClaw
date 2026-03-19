import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { linkOpenclawSkill } from "../../../setup/openclaw-link.js";
import { writeStderr } from "../../../utils/output.js";
import { colors } from "../../../utils/ui.js";
import type { OnboardState, OnboardStep, StepStatus, StepResult } from "../types.js";

const SKILL_NAME = "echoclaw";

function detect(state: OnboardState): StepStatus {
  const target = join(homedir(), ".openclaw", "skills", SKILL_NAME);
  if (existsSync(target)) {
    state.openclawLinked = true;
    return { configured: true, summary: `Skill linked at ${target}` };
  }
  return { configured: false, summary: "OpenClaw skill not linked" };
}

async function run(state: OnboardState): Promise<StepResult> {
  const result = linkOpenclawSkill(SKILL_NAME, { force: true });
  state.openclawLinked = true;

  writeStderr(colors.muted(`  Source: ${result.source}`));
  writeStderr(colors.muted(`  Target: ${result.target} (${result.linkType})`));
  if (result.workspaceLinked) {
    writeStderr(colors.muted(`  Workspace: ${result.workspaceTarget}`));
  }

  return {
    action: "configured",
    message: `OpenClaw skill linked (${result.linkType})`,
  };
}

export const openclawStep: OnboardStep = {
  name: "OpenClaw Skill",
  description: "Links EchoClaw into your AI agent platform. After this, your AI assistant can trade, check balances, and manage your wallet through chat.",
  detect,
  run,
};
