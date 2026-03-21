/**
 * Telegram approval flow — inline keyboards + callback queries.
 *
 * When the agent requires approval for a mutating tool, we send an
 * InlineKeyboard with Approve/Reject buttons. Callback queries trigger
 * the approval flow through the same engine path as the GUI.
 */

import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import * as approvalsRepo from "../db/repos/approvals.js";
import * as telegramRepo from "../db/repos/telegram.js";
import { resumeAfterApproval, createSession } from "../engine.js";
import { hydrateSession } from "../session-hydrate.js";
import { formatApprovalMessage, formatError, formatToolResult, chunkMessage } from "./formatter.js";
import { withSessionLock } from "./session-lock.js";
import type { TelegramConfig } from "./types.js";
import type { AgentEvent } from "../types.js";
import logger from "../../utils/logger.js";

/** Send an approval request with InlineKeyboard to a Telegram chat. */
export async function sendApprovalRequest(
  bot: Bot,
  chatId: number,
  data: Record<string, unknown>,
): Promise<void> {
  const approvalId = String(data.id ?? "");
  if (!approvalId) return;

  const keyboard = new InlineKeyboard()
    .text("\u2705 Approve", `approve:${approvalId}`)
    .text("\u274C Reject", `reject:${approvalId}`);

  const text = formatApprovalMessage(data);

  await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
}

/** Register callback query handlers for approval buttons. */
export function registerApprovalCallbacks(bot: Bot, config: TelegramConfig): void {
  // Approve button
  bot.callbackQuery(/^approve:(.+)$/, async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !config.authorizedChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery({ text: "Unauthorized" });
      return;
    }

    const approvalId = ctx.match?.[1] as string | undefined;
    if (!approvalId) {
      await ctx.answerCallbackQuery({ text: "Invalid approval" });
      return;
    }

    // Atomic transition: approve() returns null if already resolved (idempotent)
    const item = await approvalsRepo.approve(approvalId);
    if (!item) {
      await ctx.answerCallbackQuery({ text: "Already resolved" });
      try { await ctx.editMessageText("Already resolved."); } catch { /* message may be old */ }
      return;
    }

    await ctx.answerCallbackQuery({ text: "Approved!" });
    try { await ctx.editMessageText(`\u2705 Approved: ${item.toolCall.command}`); } catch { /* */ }

    // Reconstruct session and execute the tool
    const sessionId = (item as unknown as { sessionId?: string }).sessionId;
    const session = (sessionId ? await hydrateSession(sessionId) : null) ?? createSession();
    if (!session) {
      await bot.api.sendMessage(chatId, formatError("Agent not ready \u2014 cannot execute approved tool."));
      return;
    }

    // Execute under session lock to prevent race with concurrent messages
    await withSessionLock(session.id, async () => {
      let textBuffer = "";
      const emit = (event: AgentEvent) => {
        handleResumeEvent(event, chatId, bot, textBuffer).then(result => {
          if (result !== undefined) textBuffer = result;
        }).catch(err => {
          logger.warn("telegram.approval.emit_failed", { type: event.type, error: err instanceof Error ? err.message : String(err) });
        });
      };

      try {
        await resumeAfterApproval(session, item.toolCall, emit, config.loopMode as "full" | "restricted" | "off", item.toolCallId);
        // Flush remaining buffer
        if (textBuffer.trim()) {
          for (const chunk of chunkMessage(textBuffer)) {
            await bot.api.sendMessage(chatId, chunk);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("telegram.approval.resume_failed", { approvalId, error: msg });
        await bot.api.sendMessage(chatId, formatError(msg));
      }
    });
  });

  // Reject button
  bot.callbackQuery(/^reject:(.+)$/, async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !config.authorizedChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery({ text: "Unauthorized" });
      return;
    }

    const approvalId = ctx.match?.[1] as string | undefined;
    if (!approvalId) {
      await ctx.answerCallbackQuery({ text: "Invalid approval" });
      return;
    }

    const item = await approvalsRepo.reject(approvalId);
    if (!item) {
      await ctx.answerCallbackQuery({ text: "Already resolved" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Rejected" });
    try { await ctx.editMessageText(`\u274C Rejected: ${item.toolCall.command}`); } catch { /* */ }
  });

  // Catch-all for any unhandled callback queries
  bot.on("callback_query:data", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
  });
}

/** Handle a single event during approval resume. Returns updated text buffer. */
async function handleResumeEvent(
  event: AgentEvent,
  chatId: number,
  bot: Bot,
  textBuffer: string,
): Promise<string | undefined> {
  switch (event.type) {
    case "status": {
      // Handle session compaction — update chat→session mapping
      const statusType = event.data.type as string;
      if (statusType === "session" && event.data.sessionId) {
        await telegramRepo.updateSessionId(chatId, event.data.sessionId as string);
      }
      return undefined;
    }

    case "text_delta":
      return textBuffer + String(event.data.text ?? "");

    case "tool_start":
      await bot.api.sendChatAction(chatId, "typing");
      return undefined;

    case "tool_result": {
      const result = formatToolResult(
        String(event.data.command ?? ""),
        event.data.success as boolean,
        String(event.data.output ?? ""),
        (event.data.durationMs as number) ?? 0,
      );
      await bot.api.sendMessage(chatId, result);
      return undefined;
    }

    case "error":
      await bot.api.sendMessage(chatId, formatError(String(event.data.message ?? "Unknown error")));
      return undefined;

    default:
      return undefined;
  }
}
