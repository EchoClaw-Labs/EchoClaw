/**
 * Telegram bot poller — grammy Bot lifecycle management.
 *
 * Uses long polling (getUpdates) — no tunnel or public IP required.
 * grammy handles reconnection automatically.
 */

import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { handleIncomingMessage, resetSession } from "./bridge.js";
import { registerApprovalCallbacks } from "./approval-handler.js";
import type { TelegramConfig } from "./types.js";
import logger from "../../utils/logger.js";

// ── Singleton state ──────────────────────────────────────────────────

let bot: Bot | null = null;
let isRunning = false;
let botUsername: string | null = null;

// Rate limit for unauthorized users (1 rejection per minute per chat)
const unauthorizedCooldown = new Map<number, number>();
const UNAUTHORIZED_COOLDOWN_MS = 60_000;

// ── Lifecycle ────────────────────────────────────────────────────────

export async function startPoller(config: TelegramConfig): Promise<void> {
  if (bot) await stopPoller();

  bot = new Bot(config.botToken);

  // Install auto-retry plugin for Telegram rate limits (429)
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 5 }));

  // ── Message handler (text messages only) ──────────────────────────

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;

    if (!config.authorizedChatIds.includes(chatId)) {
      // Rate limit unauthorized rejections
      const lastReject = unauthorizedCooldown.get(chatId) ?? 0;
      if (Date.now() - lastReject < UNAUTHORIZED_COOLDOWN_MS) return;
      unauthorizedCooldown.set(chatId, Date.now());

      await ctx.reply(
        `Unauthorized. Your chat ID (${chatId}) is not whitelisted.\n` +
        "Add it in the EchoClaw agent GUI under Telegram settings.",
      );
      logger.warn("telegram.unauthorized", { chatId, username: ctx.from.username });
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    await handleIncomingMessage(
      chatId, text, bot!,
      config,
      ctx.from.username,
      ctx.from.first_name,
    );
  });

  // ── Commands ──────────────────────────────────────────────────────

  bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!config.authorizedChatIds.includes(chatId)) return;

    const sessionId = await resetSession(chatId);
    if (sessionId) {
      await ctx.reply("Fresh session started. Previous conversation context cleared.");
    } else {
      await ctx.reply("Agent not ready \u2014 cannot create session.");
    }
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!config.authorizedChatIds.includes(chatId)) return;

    await ctx.reply(
      "EchoClaw Agent is running.\n" +
      `Mode: ${config.loopMode}\n` +
      `Bot: @${botUsername ?? "unknown"}\n` +
      "Use /new to start a fresh conversation.",
    );
  });

  // ── Approval callbacks ────────────────────────────────────────────

  registerApprovalCallbacks(bot, config);

  // ── Error handling ────────────────────────────────────────────────

  bot.catch((err) => {
    logger.error("telegram.bot.error", { error: err.message ?? String(err) });
  });

  // ── Start long polling ────────────────────────────────────────────

  // drop_pending_updates: true — messages received during downtime/restart are
  // discarded. This prevents processing stale commands (e.g. old approval clicks,
  // outdated queries) after restart. Trade-off: user messages during brief
  // downtime will be silently lost. Acceptable for a localhost agent where
  // downtime = intentional restart.
  bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      botUsername = botInfo.username;
      isRunning = true;
      logger.info("telegram.bot.started", { username: botInfo.username });
    },
  });
}

export async function stopPoller(): Promise<void> {
  if (bot) {
    try { await bot.stop(); } catch { /* already stopped */ }
    bot = null;
    isRunning = false;
    botUsername = null;
    unauthorizedCooldown.clear();
    logger.info("telegram.bot.stopped");
  }
}

export function getPollerStatus(): { connected: boolean; botUsername: string | null } {
  return { connected: isRunning, botUsername };
}
