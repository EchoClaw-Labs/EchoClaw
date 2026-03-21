/**
 * Telegram integration — public API.
 *
 * Manages the lifecycle of the Telegram bot poller.
 * Called by server.ts on boot (auto-start) and by HTTP handlers (configure/enable/disable).
 */

import { startPoller, stopPoller, getPollerStatus } from "./poller.js";
import * as telegramRepo from "../db/repos/telegram.js";
import type { TelegramConfig, TelegramStatus } from "./types.js";
import logger from "../../utils/logger.js";

/** Start the Telegram bot from DB config. No-op if not configured. */
export async function startTelegram(): Promise<boolean> {
  const row = await telegramRepo.getConfig();
  if (!row.botToken) {
    logger.info("telegram.start.skipped", { reason: "no bot token configured" });
    return false;
  }

  const config: TelegramConfig = {
    enabled: row.enabled,
    botToken: row.botToken,
    authorizedChatIds: row.authorizedChatIds,
    loopMode: (row.loopMode as TelegramConfig["loopMode"]) ?? "restricted",
  };

  try {
    await startPoller(config);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("telegram.start.failed", { error: msg });
    return false;
  }
}

/** Stop the Telegram bot. */
export async function stopTelegram(): Promise<void> {
  await stopPoller();
}

/** Restart (stop + start). Used after config changes. */
export async function restartTelegram(): Promise<boolean> {
  await stopPoller();
  return startTelegram();
}

/** Get current Telegram status for the API. */
export async function getTelegramStatus(): Promise<TelegramStatus> {
  const row = await telegramRepo.getConfig();
  const poller = getPollerStatus();

  return {
    configured: !!row.botToken && !row.decryptionFailed,
    enabled: row.enabled,
    connected: poller.connected,
    botUsername: poller.botUsername,
    authorizedChatIds: row.authorizedChatIds,
    loopMode: row.loopMode,
    decryptionFailed: row.decryptionFailed,
  };
}
