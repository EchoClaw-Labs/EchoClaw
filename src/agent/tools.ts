/**
 * System prompt builder.
 *
 * Builds the agent's system prompt from soul.md, memory.md, loaded knowledge,
 * SKILL.md capabilities, and behavior rules.
 *
 * Tool definitions are NOT injected here — they go through the native OpenAI
 * `tools` parameter in inference.ts via tool-registry.ts.
 */

import * as soulRepo from "./db/repos/soul.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as skillsRepo from "./db/repos/skills.js";
import { getBehaviorInstructions } from "./prompts/behavior.js";
import { buildFirstConversationPrompt } from "./prompts/identity.js";
import { buildCurrentDateSection, buildLoadedKnowledgeSection, getModeDescription } from "./prompts/system.js";

// ── System prompt builder ────────────────────────────────────────────

export async function buildSystemPrompt(
  loadedKnowledgeFiles: Map<string, string> = new Map(),
  loopMode: "off" | "restricted" | "full" = "off",
): Promise<string> {
  const parts: string[] = [];

  parts.push(getModeDescription(loopMode));

  // Identity (from DB)
  const soulData = await soulRepo.getSoul();
  if (soulData?.content) {
    parts.push("# Identity\n\n" + soulData.content);
  } else {
    parts.push(buildFirstConversationPrompt());
  }

  // Memory (from DB)
  const memory = await memoryRepo.getMemoryAsText();
  if (memory) {
    parts.push("# Memory\n\n" + memory);
  }

  parts.push(buildCurrentDateSection());

  const loadedKnowledgeSection = buildLoadedKnowledgeSection(loadedKnowledgeFiles);
  if (loadedKnowledgeSection) {
    parts.push(loadedKnowledgeSection);
  }

  // Agent capabilities — full SKILL.md loaded from DB (seeded from package)
  const skillMd = await skillsRepo.getSkillReference("SKILL.md");
  if (skillMd) {
    parts.push("# Agent Capabilities (echoclaw CLI)\n\n" + skillMd);
  }

  // Behavior rules (no tool format instructions — tools go via native FC parameter)
  parts.push(getBehaviorInstructions());

  return parts.join("\n\n---\n\n");
}
