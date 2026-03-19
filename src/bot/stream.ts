/**
 * TokenStream — Socket.IO connection manager for slop-backend WS.
 *
 * Maintains a single connection, handles subscribe/unsubscribe per token,
 * auto-reconnects with backoff, re-subscribes after reconnect.
 */

import { EventEmitter } from "node:events";
import { io, type Socket } from "socket.io-client";
import logger from "../utils/logger.js";
import type { TokenUpdatePayload, TokenSnapshotPayload } from "./types.js";

export interface TokenStreamOptions {
  url: string;
  reconnectBackoffMs?: number;
  reconnectMaxMs?: number;
}

export class TokenStream extends EventEmitter {
  private socket: Socket | null = null;
  private subscriptions = new Set<string>();
  private readonly url: string;
  private readonly reconnectBackoffMs: number;
  private readonly reconnectMaxMs: number;
  private destroyed = false;

  constructor(options: TokenStreamOptions) {
    super();
    this.url = options.url;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000;
  }

  connect(): void {
    if (this.socket) return;

    logger.debug(`[TokenStream] Connecting to ${this.url}`);

    this.socket = io(this.url, {
      transports: ["websocket"],
      timeout: 30000,
      reconnection: true,
      reconnectionDelay: this.reconnectBackoffMs,
      reconnectionDelayMax: this.reconnectMaxMs,
      randomizationFactor: 0.2,
    });

    this.socket.on("connect", () => {
      logger.info(`[TokenStream] Connected (id=${this.socket?.id})`);
      this.emit("connected");
      // Re-subscribe all tokens after reconnect
      for (const addr of this.subscriptions) {
        this.socket?.emit("subscribe_token", { address: addr });
        logger.debug(`[TokenStream] Re-subscribed to ${addr}`);
      }
    });

    this.socket.on("disconnect", (reason: string) => {
      logger.warn(`[TokenStream] Disconnected: ${reason}`);
      this.emit("disconnected", reason);
    });

    this.socket.on("connect_error", (err: Error) => {
      logger.error(`[TokenStream] Connection error: ${err.message}`);
      this.emit("error", err);
    });

    this.socket.on("token_snapshot", (payload: TokenSnapshotPayload) => {
      this.emit("snapshot", payload);
    });

    this.socket.on("token_update", (payload: TokenUpdatePayload) => {
      this.emit("update", payload);
    });

    this.socket.on("error", (data: { message: string }) => {
      logger.warn(`[TokenStream] Server error: ${data.message}`);
      this.emit("error", new Error(data.message));
    });
  }

  subscribe(tokenAddress: string): void {
    const addr = tokenAddress.toLowerCase();
    this.subscriptions.add(addr);
    if (this.socket?.connected) {
      this.socket.emit("subscribe_token", { address: addr });
      logger.debug(`[TokenStream] Subscribed to ${addr}`);
    }
  }

  unsubscribe(tokenAddress: string): void {
    const addr = tokenAddress.toLowerCase();
    this.subscriptions.delete(addr);
    if (this.socket?.connected) {
      this.socket.emit("unsubscribe_token", { address: addr });
      logger.debug(`[TokenStream] Unsubscribed from ${addr}`);
    }
  }

  get subscribedTokens(): string[] {
    return [...this.subscriptions];
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscriptions.clear();
    logger.debug("[TokenStream] Disconnected and cleaned up");
  }
}
