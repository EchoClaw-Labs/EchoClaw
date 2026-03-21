import type { Message } from "../types.js";

const COMPACTION_SYSTEM_PROMPT = "You are a session summarizer. Produce a structured summary.";

export function getCompactionSystemPrompt(): string {
  return COMPACTION_SYSTEM_PROMPT;
}

export function buildCompactionPrompt(messages: Message[]): string {
  const transcript = messages
    .filter(m => m.role !== "system")
    .map(m => `[${m.role}]: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  return `You are summarizing a conversation session for memory preservation.

Produce TWO sections:

## Session Summary
A concise summary of what happened in this session (max 500 words). Include:
- Key decisions made
- Trades executed and their outcomes
- Important information learned
- Current portfolio state if discussed

## Key Insights for Memory
Extract 3-10 bullet points of important learnings, patterns, or user preferences that should be permanently remembered. These will be appended to memory.md.

Format each insight as: "- [CATEGORY] insight text"
Categories: TRADING, PREFERENCE, MARKET, STRATEGY, RISK, SOCIAL, TECHNICAL

---

Session transcript:
${transcript}`;
}
