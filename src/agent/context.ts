/**
 * Context window management.
 *
 * Tracks token usage, decides when to compact, handles session rotation.
 * Full conversation history is preserved until compaction threshold.
 */

import { COMPACTION_THRESHOLD, DEFAULT_CONTEXT_LIMIT } from "./constants.js";
import type { Message } from "./types.js";
import logger from "../utils/logger.js";

// ── Token estimation ─────────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Uses word-based heuristic (~1.3 tokens per word for English + code).
 * Adapted from translate.ts estimateTokenCount().
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const charCount = text.length;
  // Heuristic: max of word-based and char-based estimates
  return Math.max(1, Math.ceil(Math.max(wordCount * 1.3, charCount / 3.5)));
}

/**
 * Estimate total tokens for a message array.
 * Includes per-message overhead (~4 tokens per message for role/formatting).
 */
export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // role + formatting overhead
    total += estimateTokens(msg.content);
  }
  return total;
}

// ── Context budget ───────────────────────────────────────────────────

export interface ContextBudget {
  /** Total context window size (tokens). */
  contextLimit: number;
  /** Tokens used by system prompt (soul + memory + tools + knowledge). */
  systemTokens: number;
  /** Tokens used by conversation messages. */
  messageTokens: number;
  /** Total tokens used. */
  totalTokens: number;
  /** Remaining tokens before compaction. */
  remainingTokens: number;
  /** Whether compaction should trigger. */
  shouldCompact: boolean;
  /** Usage as fraction (0.0–1.0). */
  usageFraction: number;
}

export function calculateBudget(
  systemPrompt: string,
  messages: Message[],
  contextLimit: number = DEFAULT_CONTEXT_LIMIT,
): ContextBudget {
  const systemTokens = estimateTokens(systemPrompt);
  const messageTokens = estimateMessagesTokens(messages);
  const totalTokens = systemTokens + messageTokens;
  const threshold = Math.floor(contextLimit * COMPACTION_THRESHOLD);
  const remainingTokens = Math.max(0, threshold - totalTokens);
  const usageFraction = totalTokens / contextLimit;
  const shouldCompact = totalTokens >= threshold;

  return {
    contextLimit,
    systemTokens,
    messageTokens,
    totalTokens,
    remainingTokens,
    shouldCompact,
    usageFraction,
  };
}

// ── Hybrid budget (real snapshot + heuristic delta) ──────────────────

/**
 * Calculate context budget using real prompt_tokens from the last inference
 * plus a heuristic estimate for messages added since that snapshot.
 *
 * Falls back to full heuristic (`calculateBudget`) when no snapshot exists.
 */
export function calculateHybridBudget(
  lastPromptTokens: number | undefined,
  systemPrompt: string,
  messages: Message[],
  newMessagesSinceSnapshot: number,
  contextLimit: number = DEFAULT_CONTEXT_LIMIT,
): ContextBudget {
  if (lastPromptTokens !== undefined && lastPromptTokens > 0) {
    // Hybrid: real snapshot covers system + all messages at snapshot time.
    // Only estimate the delta (new messages added since last inference).
    const clampedNew = Math.min(newMessagesSinceSnapshot, messages.length);
    const newMessagesSlice = clampedNew > 0 ? messages.slice(-clampedNew) : [];
    const newMessagesEstimate = estimateMessagesTokens(newMessagesSlice);
    const totalTokens = lastPromptTokens + newMessagesEstimate;
    const threshold = Math.floor(contextLimit * COMPACTION_THRESHOLD);
    const remainingTokens = Math.max(0, threshold - totalTokens);
    const usageFraction = totalTokens / contextLimit;
    const shouldCompact = totalTokens >= threshold;

    logger.debug(
      `[context] hybrid budget: snapshot=${lastPromptTokens} + delta=${newMessagesEstimate} (${clampedNew} msgs) = ${totalTokens} / ${contextLimit} (${(usageFraction * 100).toFixed(1)}%)`,
    );

    return {
      contextLimit,
      systemTokens: 0, // not separated in hybrid mode
      messageTokens: totalTokens,
      totalTokens,
      remainingTokens,
      shouldCompact,
      usageFraction,
    };
  }

  // Fallback: full heuristic when no snapshot available
  return calculateBudget(systemPrompt, messages, contextLimit);
}

// ── Compaction ────────────────────────────────────────────────────────

/**
 * Build a compaction summary prompt.
 * Sent to the model to summarize the current conversation.
 */
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

/**
 * Parse compaction result into summary and insights.
 */
export function parseCompactionResult(response: string): {
  summary: string;
  insights: string;
} {
  const summaryMatch = response.match(/##\s*Session Summary\s*\n([\s\S]*?)(?=##\s*Key Insights|$)/i);
  const insightsMatch = response.match(/##\s*Key Insights.*?\n([\s\S]*?)$/i);

  return {
    summary: summaryMatch?.[1]?.trim() ?? response.slice(0, 1000),
    insights: insightsMatch?.[1]?.trim() ?? "",
  };
}
