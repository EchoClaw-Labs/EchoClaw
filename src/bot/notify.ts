/**
 * Bot notification channels.
 *
 * V1 channels:
 * 1. stdout JSON — always (handled by daemon.ts directly)
 * 2. slop chat — reuses slop-app.ts Socket.IO auth+send pattern
 */

import { io, type Socket } from "socket.io-client";
import { type Hex, type Address } from "viem";
import { loadConfig } from "../config/store.js";
import logger from "../utils/logger.js";
import type { BotNotification } from "./types.js";
import { requireSlopAuth } from "../slop/auth.js";

/**
 * Post a bot notification to slop.money global chat.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function postChatNotification(
  notification: BotNotification,
  privateKey: Hex,
  walletAddress: Address
): Promise<void> {
  const cfg = loadConfig();

  const message = formatChatMessage(notification);
  if (!message) return;

  try {
    // Get JWT access token (cached or fresh login)
    const accessToken = await requireSlopAuth(
      privateKey,
      walletAddress,
      cfg.services.backendApiUrl
    );

    await postToChat({
      wsUrl: cfg.services.chatWsUrl,
      accessToken,
      walletAddress,
      message,
    });
    logger.debug(`[Notify] Chat notification sent: ${notification.type}`);
  } catch (err) {
    logger.warn(`[Notify] Chat notification failed: ${err instanceof Error ? err.message : err}`);
  }
}

function formatChatMessage(n: BotNotification): string | null {
  switch (n.type) {
    case "BUY_FILLED":
      return `[BOT] Bought ${n.amountOg ?? "?"} 0G of ${n.tokenSymbol ?? n.token?.slice(0, 10)} | tx: ${n.explorerUrl ?? n.txHash ?? "?"}`;
    case "SELL_FILLED":
      return `[BOT] Sold ${n.amountTokens ?? "?"} ${n.tokenSymbol ?? n.token?.slice(0, 10)} | tx: ${n.explorerUrl ?? n.txHash ?? "?"}`;
    case "TRADE_FAILED":
      return `[BOT] Trade failed: ${n.failReason?.slice(0, 100) ?? "unknown"}`;
    default:
      // Don't spam chat with start/stop/guardrail events
      return null;
  }
}

async function postToChat(params: {
  wsUrl: string;
  accessToken: string;
  walletAddress: Address;
  message: string;
}): Promise<void> {
  const { wsUrl, accessToken, walletAddress, message } = params;

  return new Promise((resolve, reject) => {
    const socket: Socket = io(wsUrl, {
      transports: ["websocket"],
      timeout: 15000,
    });

    const timeoutHandle = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Chat post timed out"));
    }, 30000);

    let authenticated = false;

    socket.on("connect", () => {
      socket.emit("chat:auth", { accessToken });
    });

    socket.on("chat:auth_ok", () => {
      authenticated = true;
      socket.emit("chat:send", { content: message, gifUrl: null });
    });

    socket.on("chat:new", (msg: { senderAddress: string | null; content: string }) => {
      if (authenticated && msg.senderAddress?.toLowerCase() === walletAddress.toLowerCase() && msg.content === message) {
        clearTimeout(timeoutHandle);
        socket.disconnect();
        resolve();
      }
    });

    socket.on("chat:auth_failed", (data: { error: string; code?: string }) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new Error(data.error || "Auth failed"));
    });

    socket.on("chat:error", (data: { error: string }) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new Error(data.error || "Chat error"));
    });

    socket.on("connect_error", (err: Error) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(err);
    });

    socket.on("disconnect", (reason: string) => {
      if (!authenticated) {
        clearTimeout(timeoutHandle);
        reject(new Error(`Disconnected: ${reason}`));
      }
    });
  });
}
