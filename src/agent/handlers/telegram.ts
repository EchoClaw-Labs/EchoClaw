/**
 * Telegram configuration API endpoints.
 *
 * Routes for managing the Telegram bot integration from the GUI.
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import { parseTelegramConfigRequest, RequestValidationError } from "../validation.js";
import * as telegramRepo from "../db/repos/telegram.js";
import { startTelegram, stopTelegram, restartTelegram, getTelegramStatus } from "../telegram/index.js";
import { getPollerStatus } from "../telegram/poller.js";
import logger from "../../utils/logger.js";

export function registerTelegramRoutes(): void {
  // ── Status ──────────────────────────────────────────────────────────

  registerRoute("GET", "/api/agent/telegram/status", async (_req, res) => {
    const status = await getTelegramStatus();
    jsonResponse(res, 200, status);
  });

  // ── Configure ───────────────────────────────────────────────────────

  registerRoute("POST", "/api/agent/telegram/configure", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseTelegramConfigRequest>;
    try {
      parsed = parseTelegramConfigRequest(params.body);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { botToken, chatIds, loopMode } = parsed;

    // Validate token with Telegram API before saving (prevents overwriting
    // a working config with an invalid token)
    let botUsername: string | undefined;
    try {
      const { Bot } = await import("grammy");
      const probe = new Bot(botToken);
      const me = await probe.api.getMe();
      botUsername = me.username;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("telegram.configure.token_rejected", { error: msg });
      errorResponse(res, 400, "INVALID_TOKEN", `Telegram rejected this token: ${msg}`);
      return;
    }

    await telegramRepo.saveConfig(botToken, chatIds, loopMode);
    await telegramRepo.setEnabled(true);

    const started = await restartTelegram();

    logger.info("telegram.configured", { chatIds, loopMode, botUsername, started });
    jsonResponse(res, 200, {
      ok: true,
      enabled: true,
      connected: started,
      botUsername: botUsername ?? null,
    });
  });

  // ── Enable ──────────────────────────────────────────────────────────

  registerRoute("POST", "/api/agent/telegram/enable", async (_req, res) => {
    const config = await telegramRepo.getConfig();
    if (!config.botToken) {
      errorResponse(res, 400, "NOT_CONFIGURED", "Bot token not configured — use /configure first");
      return;
    }

    await telegramRepo.setEnabled(true);
    const started = await startTelegram();

    jsonResponse(res, 200, { ok: true, started });
  });

  // ── Disable ─────────────────────────────────────────────────────────

  registerRoute("POST", "/api/agent/telegram/disable", async (_req, res) => {
    await telegramRepo.setEnabled(false);
    await stopTelegram();
    jsonResponse(res, 200, { ok: true });
  });

  // ── Test message ────────────────────────────────────────────────────

  registerRoute("POST", "/api/agent/telegram/test", async (_req, res) => {
    const config = await telegramRepo.getConfig();
    if (!config.botToken) {
      errorResponse(res, 400, "NOT_CONFIGURED", "Bot token not configured");
      return;
    }

    const poller = getPollerStatus();
    if (!poller.connected) {
      errorResponse(res, 400, "NOT_CONNECTED", "Telegram bot is not connected — enable it first");
      return;
    }

    // Import grammy Bot to send test message via the existing poller's token
    const { Bot } = await import("grammy");
    const testBot = new Bot(config.botToken);

    const results: Array<{ chatId: number; ok: boolean; error?: string }> = [];
    for (const chatId of config.authorizedChatIds) {
      try {
        await testBot.api.sendMessage(
          chatId,
          `\u2705 EchoClaw Telegram integration is working!\n\nBot: @${poller.botUsername ?? "unknown"}\nMode: ${config.loopMode}`,
        );
        results.push({ chatId, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ chatId, ok: false, error: msg });
      }
    }

    jsonResponse(res, 200, { ok: true, results });
  });

  // ── Disconnect (clear config) ───────────────────────────────────────

  registerRoute("POST", "/api/agent/telegram/disconnect", async (_req, res) => {
    await stopTelegram();
    await telegramRepo.clearConfig();
    jsonResponse(res, 200, { ok: true });
  });
}
