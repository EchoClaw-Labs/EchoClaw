/**
 * BotDaemon — Core daemon logic for real-time trading bot.
 *
 * Foreground process (user runs in tmux/screen):
 * - Connects to slop-backend WS via TokenStream
 * - Evaluates triggers on token_update events
 * - Executes trades via executor (NonceQueue serialization)
 * - Graceful shutdown: SIGINT/SIGTERM + file-based fallback (Windows)
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { type Address, type Hex, parseUnits, formatUnits } from "viem";
import { TokenStream } from "./stream.js";
import { NonceQueue } from "./nonce-queue.js";
import { evaluateTrigger } from "./triggers.js";
import {
  loadOrders,
  saveOrders,
  getArmedOrdersForToken,
  markFilled,
  markFailed,
  setLastProcessedTxHash,
} from "./orders.js";
import {
  executeBuy,
  executeSell,
  getTokenBalance,
  getOgBalance,
  requireWalletAndKeystore,
} from "./executor.js";
import { loadState, saveState, logExecution, recordSpend, recordTx } from "./state.js";
import { loadConfig } from "../config/store.js";
import { BOT_PID_FILE, BOT_SHUTDOWN_FILE, BOT_DIR } from "../config/paths.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";
import { writeStdout } from "../utils/output.js";
import { postChatNotification } from "./notify.js";
import { postWebhookNotification } from "../openclaw/hooks-client.js";
import type {
  BotOrder,
  BotGuardrails,
  TokenUpdatePayload,
  TokenSnapshotPayload,
  ExecutionEvent,
  BotNotification,
  SizeSpec,
} from "./types.js";
import { DEFAULT_GUARDRAILS } from "./types.js";
import { mkdirSync } from "node:fs";

export class BotDaemon {
  private readonly privateKey: Hex;
  private readonly walletAddress: Address;
  private readonly guardrails: BotGuardrails;
  private readonly stream: TokenStream;
  private readonly nonceQueue = new NonceQueue();
  private shuttingDown = false;
  private shutdownWatcher: ReturnType<typeof setInterval> | null = null;
  // In-memory lock: orders currently executing (prevents double-fire)
  private executingOrders = new Set<string>();
  // Per-order cooldown tracking (order.id → last fired timestamp)
  private orderLastFiredAt = new Map<string, number>();

  constructor(
    privateKey: Hex,
    walletAddress: Address,
    guardrails?: Partial<BotGuardrails>
  ) {
    this.privateKey = privateKey;
    this.walletAddress = walletAddress;
    this.guardrails = { ...DEFAULT_GUARDRAILS, ...guardrails };

    const cfg = loadConfig();
    this.stream = new TokenStream({ url: cfg.services.slopWsUrl });
  }

  async start(): Promise<void> {
    // 1. Check pidfile (stale detection)
    this.checkAndWritePid();

    // 2. Clean up stale shutdown file from previous crash
    try {
      if (existsSync(BOT_SHUTDOWN_FILE)) {
        unlinkSync(BOT_SHUTDOWN_FILE);
        logger.debug("[Daemon] Cleaned up stale shutdown file");
      }
    } catch (err) {
      logger.warn(`[Daemon] Could not remove stale shutdown file: ${err}`);
    }

    // 3. Load armed orders → group by token
    const orders = loadOrders();
    const armedOrders = orders.orders.filter((o) => o.state === "armed");
    const tokenSet = new Set(armedOrders.map((o) => o.token.toLowerCase()));

    logger.info(`[Daemon] Starting with ${armedOrders.length} armed orders across ${tokenSet.size} tokens`);
    logger.info(`[Daemon] Wallet: ${this.walletAddress}`);

    // 4. Wire up stream events
    this.stream.on("snapshot", (payload: TokenSnapshotPayload) => this.onTokenSnapshot(payload));
    this.stream.on("update", (payload: TokenUpdatePayload) => this.onTokenUpdate(payload));
    this.stream.on("connected", () => {
      logger.info("[Daemon] WS connected");
    });
    this.stream.on("disconnected", (reason: string) => {
      logger.warn(`[Daemon] WS disconnected: ${reason}`);
    });
    this.stream.on("error", (err: Error) => {
      logger.error(`[Daemon] WS error: ${err.message}`);
    });

    // 5. Connect and subscribe
    this.stream.connect();
    for (const token of tokenSet) {
      this.stream.subscribe(token);
    }

    // 6. Register signal handlers
    const onSignal = () => this.stop();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // 7. Start shutdown-file watcher (Windows fallback)
    this.shutdownWatcher = setInterval(() => {
      if (existsSync(BOT_SHUTDOWN_FILE)) {
        logger.info("[Daemon] Shutdown file detected, stopping...");
        this.stop();
      }
    }, 1000);

    // 8. Emit started notification
    this.notify({
      type: "BOT_STARTED",
      timestamp: Date.now(),
    });

    logger.info("[Daemon] Bot daemon running (press Ctrl+C to stop)");
  }

  private onTokenSnapshot(payload: TokenSnapshotPayload): void {
    const addr = payload.data.address?.toLowerCase();
    if (!addr) return;

    // Seed: set lastProcessedTxHash for all armed orders on this token
    // This prevents false triggers after daemon restart
    const lastTrade = payload.data.last_trade;
    if (!lastTrade?.tx_hash) return;

    const armedOrders = getArmedOrdersForToken(addr);
    for (const order of armedOrders) {
      if (!order.lastProcessedTxHash) {
        setLastProcessedTxHash(order.id, lastTrade.tx_hash);
        logger.debug(`[Daemon] Seeded order ${order.id.slice(0, 8)} with tx ${lastTrade.tx_hash.slice(0, 10)}..`);
      }
    }
  }

  private onTokenUpdate(update: TokenUpdatePayload): void {
    if (this.shuttingDown) return;

    const addr = update.address?.toLowerCase();
    if (!addr) return;

    const armedOrders = getArmedOrdersForToken(addr);
    if (armedOrders.length === 0) return;

    for (const order of armedOrders) {
      // Skip if already executing
      if (this.executingOrders.has(order.id)) continue;

      const result = evaluateTrigger(order.trigger, update, order);
      if (!result.fired) continue;

      // Per-order cooldown
      const now = Date.now();
      const lastFired = this.orderLastFiredAt.get(order.id) ?? 0;
      if (now - lastFired < order.cooldownMs) {
        logger.debug(`[Daemon] Per-order cooldown not elapsed for ${order.id.slice(0, 8)}`);
        continue;
      }

      logger.info(`[Daemon] Trigger fired for order ${order.id.slice(0, 8)}: ${result.reason}`);

      // Update lastProcessedTxHash immediately (anti-duplicate)
      if (update.lastTrade?.tx_hash) {
        setLastProcessedTxHash(order.id, update.lastTrade.tx_hash);
      }

      // Check guardrails
      if (!this.checkGuardrails(order)) continue;

      // Mark as executing (in-memory) + record per-order cooldown
      this.executingOrders.add(order.id);
      this.orderLastFiredAt.set(order.id, Date.now());

      // Enqueue trade
      this.nonceQueue.enqueue(async () => {
        try {
          await this.executeTrade(order, update);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.error(`[Daemon] Trade failed for order ${order.id.slice(0, 8)}: ${reason}`);
          markFailed(order.id, reason);

          const event: ExecutionEvent = {
            orderId: order.id,
            token: order.token,
            side: order.side,
            triggerType: order.trigger.type,
            status: "failed",
            failReason: reason,
            timestamp: Date.now(),
          };
          logExecution(event);

          this.notify({
            type: "TRADE_FAILED",
            orderId: order.id,
            token: order.token,
            side: order.side,
            failReason: reason,
            trigger: order.trigger as unknown as Record<string, unknown>,
            timestamp: Date.now(),
          });
        } finally {
          this.executingOrders.delete(order.id);
        }
      });
    }
  }

  private checkGuardrails(order: BotOrder): boolean {
    if (order.slippageBps > this.guardrails.maxSlippageBps) {
      logger.warn(`[Daemon] Order ${order.id.slice(0, 8)} slippage ${order.slippageBps}bps exceeds max ${this.guardrails.maxSlippageBps}bps`);
      return false;
    }
    return true;
  }

  private async executeTrade(order: BotOrder, update: TokenUpdatePayload): Promise<void> {
    const cfg = loadConfig();

    // Resolve size
    const amountWei = await this.resolveSize(order);
    if (amountWei <= 0n) {
      logger.warn(`[Daemon] Resolved amount is 0 for order ${order.id.slice(0, 8)}, skipping`);
      return;
    }

    recordTx();

    let result: { txHash: Hex; explorerUrl: string };

    if (order.side === "buy") {
      result = await executeBuy({
        token: order.token,
        amountOgWei: amountWei,
        slippageBps: order.slippageBps,
        privateKey: this.privateKey,
      });

      // Track daily spend
      const ogSpent = parseFloat(formatUnits(amountWei, 18));
      recordSpend(ogSpent);
    } else {
      result = await executeSell({
        token: order.token,
        amountTokenWei: amountWei,
        slippageBps: order.slippageBps,
        privateKey: this.privateKey,
      });
    }

    // Mark filled
    markFilled(order.id, result.txHash);

    // Log execution
    const event: ExecutionEvent = {
      orderId: order.id,
      token: order.token,
      side: order.side,
      triggerType: order.trigger.type,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      amountOg: order.side === "buy" ? formatUnits(amountWei, 18) : undefined,
      amountTokens: order.side === "sell" ? formatUnits(amountWei, 18) : undefined,
      status: "filled",
      timestamp: Date.now(),
    };
    logExecution(event);

    // Notify
    this.notify({
      type: order.side === "buy" ? "BUY_FILLED" : "SELL_FILLED",
      orderId: order.id,
      token: order.token,
      tokenSymbol: update.symbol,
      side: order.side,
      amountOg: order.side === "buy" ? formatUnits(amountWei, 18) : undefined,
      amountTokens: order.side === "sell" ? formatUnits(amountWei, 18) : undefined,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      trigger: order.trigger as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    });

    logger.info(`[Daemon] Order ${order.id.slice(0, 8)} filled: ${result.txHash}`);
  }

  private async resolveSize(order: BotOrder): Promise<bigint> {
    const size = order.size;

    switch (size.mode) {
      case "absolute":
        return parseUnits(size.amountOg, 18);

      case "absoluteTokens":
        return parseUnits(size.amountTokens, 18);

      case "all": {
        // Sell all tokens
        return getTokenBalance(order.token, this.walletAddress);
      }

      case "percent": {
        if (order.side === "buy") {
          const balance = await getOgBalance(this.walletAddress);
          const raw = (balance * BigInt(Math.round(size.percent * 100))) / 10000n;
          // Reserve gas for the transaction (0.01 0G)
          const MIN_GAS_RESERVE = parseUnits("0.01", 18);
          const adjusted = raw > MIN_GAS_RESERVE ? raw - MIN_GAS_RESERVE : 0n;
          if (adjusted <= 0n) {
            logger.warn(`[Daemon] Percent buy amount after gas reserve is 0, skipping`);
          }
          return adjusted;
        } else {
          const balance = await getTokenBalance(order.token, this.walletAddress);
          return (balance * BigInt(Math.round(size.percent * 100))) / 10000n;
        }
      }

      default:
        return 0n;
    }
  }

  private notify(notification: BotNotification): void {
    // Always write JSON to stdout
    writeStdout(JSON.stringify(notification));

    // Fire-and-forget chat notification (errors logged, never thrown)
    postChatNotification(notification, this.privateKey, this.walletAddress).catch(() => {});

    // Fire-and-forget OpenClaw webhook (disabled if ENV not set)
    postWebhookNotification(notification).catch(() => {});
  }

  private checkAndWritePid(): void {
    if (!existsSync(BOT_DIR)) {
      mkdirSync(BOT_DIR, { recursive: true });
    }

    if (existsSync(BOT_PID_FILE)) {
      const existingPid = parseInt(readFileSync(BOT_PID_FILE, "utf-8").trim(), 10);
      try {
        process.kill(existingPid, 0); // Check if alive
        throw new EchoError(
          ErrorCodes.BOT_ALREADY_RUNNING,
          `Bot daemon already running (PID ${existingPid})`,
          "Run: echoclaw marketmaker stop"
        );
      } catch (err) {
        if (err instanceof EchoError) throw err;
        // Stale pidfile — remove it
        logger.debug(`[Daemon] Removing stale pidfile (PID ${existingPid})`);
        unlinkSync(BOT_PID_FILE);
      }
    }

    writeFileSync(BOT_PID_FILE, String(process.pid), "utf-8");
    logger.debug(`[Daemon] PID file written: ${process.pid}`);
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info("[Daemon] Shutting down...");

    this.notify({
      type: "BOT_STOPPED",
      timestamp: Date.now(),
    });

    // Stop shutdown watcher
    if (this.shutdownWatcher) {
      clearInterval(this.shutdownWatcher);
      this.shutdownWatcher = null;
    }

    // Drain pending txs
    await this.nonceQueue.drain(30000);

    // Disconnect stream
    this.stream.disconnect();

    // Cleanup files
    try {
      if (existsSync(BOT_PID_FILE)) unlinkSync(BOT_PID_FILE);
    } catch { /* ignore */ }
    try {
      if (existsSync(BOT_SHUTDOWN_FILE)) unlinkSync(BOT_SHUTDOWN_FILE);
    } catch { /* ignore */ }

    logger.info("[Daemon] Stopped");
    process.exit(0);
  }
}
