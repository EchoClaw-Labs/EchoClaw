/**
 * Telegram message formatter.
 *
 * Converts AgentEvent data to Telegram-ready messages.
 * Uses MarkdownV2 where safe, falls back to plain text.
 *
 * Telegram limits: 4096 chars per message, 1-64 bytes callback data.
 * MarkdownV2 escape chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */

const TELEGRAM_MSG_LIMIT = 4096;
const CHUNK_LIMIT = 3800; // leave room for MarkdownV2 overhead
const TOOL_OUTPUT_LIMIT = 500;

// Characters that must be escaped in MarkdownV2 outside of formatting entities
const MD_V2_ESCAPE_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/** Escape text for Telegram MarkdownV2 (outside code blocks). */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_V2_ESCAPE_RE, "\\$1");
}

/**
 * Format agent text for Telegram.
 * Sends as plain text to avoid MarkdownV2 parsing failures —
 * LLM output contains arbitrary Markdown that would need full AST conversion.
 */
export function formatTextForTelegram(text: string): string {
  return text.trim();
}

/** Format tool_start event as a compact status message. */
export function formatToolStart(command: string, args: Record<string, unknown>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  const argsDisplay = argStr.length > 80 ? argStr.slice(0, 77) + "..." : argStr;
  return `Running: ${command} ${argsDisplay}`.trim();
}

/** Format tool_result event with truncated output. */
export function formatToolResult(
  command: string, success: boolean, output: string, durationMs: number,
): string {
  const icon = success ? "\u2705" : "\u274C";
  const truncated = output.length > TOOL_OUTPUT_LIMIT
    ? output.slice(0, TOOL_OUTPUT_LIMIT) + "..."
    : output;
  const duration = durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`;
  return `${icon} ${command} (${duration})\n${truncated}`;
}

/** Format approval_required event for Telegram. */
export function formatApprovalMessage(data: Record<string, unknown>): string {
  const command = String(data.command ?? "unknown");
  const args = data.args as Record<string, unknown> | undefined;
  const reasoning = String(data.reasoning ?? "");

  const argsStr = args
    ? Object.entries(args).map(([k, v]) => `  ${k}: ${String(v)}`).join("\n")
    : "";

  return [
    "\u26A0\uFE0F Approval Required",
    "",
    `Command: ${command}`,
    argsStr ? `Args:\n${argsStr}` : "",
    reasoning ? `\nReason: ${reasoning}` : "",
    "",
    "Tap Approve or Reject below.",
  ].filter(Boolean).join("\n");
}

/** Format error message. */
export function formatError(message: string): string {
  return `\u274C Error: ${message}`;
}

/**
 * Split a long message into chunks that fit Telegram's 4096 char limit.
 * Splits on paragraph boundaries when possible.
 */
export function chunkMessage(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split on double newline (paragraph)
    let splitIdx = remaining.lastIndexOf("\n\n", limit);
    if (splitIdx < limit * 0.3) {
      // Paragraph boundary too early — try single newline
      splitIdx = remaining.lastIndexOf("\n", limit);
    }
    if (splitIdx < limit * 0.3) {
      // No good newline — try space
      splitIdx = remaining.lastIndexOf(" ", limit);
    }
    if (splitIdx < limit * 0.3) {
      // Hard cut
      splitIdx = limit;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

export { TELEGRAM_MSG_LIMIT, CHUNK_LIMIT, TOOL_OUTPUT_LIMIT };
