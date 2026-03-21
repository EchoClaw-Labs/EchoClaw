const MODE_DESCRIPTIONS = {
  off: "## Current Mode: MANUAL\nYou respond to user messages only. Execute tools when asked. No autonomous actions.",
  restricted: "## Current Mode: RESTRICTED\nYou can act proactively but mutations (trades, transfers, posts) require user approval. The UI will show an approval card for each mutation. Safe tools (balance checks, searches, file reads) execute immediately.",
  full: "## Current Mode: FULL AUTONOMOUS\nYou have full permission to execute ALL operations including trades, transfers, and posts. Act decisively based on your strategies and risk profile. Log every trade.",
} as const;

export function getModeDescription(loopMode: keyof typeof MODE_DESCRIPTIONS): string {
  return MODE_DESCRIPTIONS[loopMode];
}

export function buildCurrentDateSection(now = new Date()): string {
  return `# Current Date\n\nToday is ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString("en-US", { weekday: "long" })}). Use this for temporal awareness.`;
}

export function buildLoadedKnowledgeSection(loadedKnowledgeFiles: Map<string, string>): string | null {
  if (loadedKnowledgeFiles.size === 0) {
    return null;
  }

  const knowledgeSection = ["# Loaded Knowledge\n"];
  for (const [path, content] of loadedKnowledgeFiles) {
    knowledgeSection.push(`## ${path}\n\n${content}\n`);
  }

  return knowledgeSection.join("\n");
}
