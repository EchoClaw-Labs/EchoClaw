/**
 * BalanceMonitor — daemon that polls 0G Compute sub-account balances
 * and sends webhook alerts when they drop below a threshold.
 *
 * Supports two modes:
 *   - `fixed`:       user-supplied static threshold
 *   - `recommended`: dynamic threshold derived from provider pricing
 *
 * Follows the same lifecycle pattern as BotDaemon (pidfile, shutdown file, signals).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import type { Address } from "viem";
import { getAuthenticatedBroker } from "./broker-factory.js";
import { withSuppressedConsole } from "./bridge.js";
import { normalizeSubAccount } from "./account.js";
import { calculateProviderPricing } from "./pricing.js";
import { loadHooksConfig, formatRoutingFlags } from "../openclaw/hooks-client.js";
import {
  ZG_COMPUTE_DIR,
  ZG_MONITOR_PID_FILE,
  ZG_MONITOR_SHUTDOWN_FILE,
  ZG_MONITOR_STATE_FILE,
} from "./constants.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

// ── Anti-spam state ──────────────────────────────────────────────────

interface ProviderAlertState {
  lastAlertAt: number;
  lastAlertBalance: string; // stringified for JSON
}

interface ProviderThresholdState {
  threshold: number;
  recommendedMin: number;
}

interface MonitorState {
  providers: string[];
  mode: MonitorMode;
  threshold?: number;
  buffer?: number;
  alertRatio?: number;
  intervalSec: number;
  lastCheckAt: number;
  alerts: Record<string, ProviderAlertState>;
  providerThresholds?: Record<string, ProviderThresholdState>;
}

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const ALERT_DROP_THRESHOLD = 0.5; // alert again if balance dropped another 50%

// ── Monitor ──────────────────────────────────────────────────────────

export type MonitorMode = "fixed" | "recommended";

export interface BalanceMonitorOptions {
  providers: Address[];
  mode: MonitorMode;
  threshold?: number;      // required for fixed
  buffer?: number;         // default 0, extra 0G above recommended
  alertRatio?: number;     // default 1.2
  intervalSec: number;
}

export class BalanceMonitor {
  private readonly providers: Address[];
  private readonly mode: MonitorMode;
  private readonly threshold: number | undefined;
  private readonly buffer: number;
  private readonly alertRatio: number;
  private readonly intervalSec: number;
  private shuttingDown = false;
  private shutdownWatcher: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private state: MonitorState;

  constructor(opts: BalanceMonitorOptions) {
    this.providers = opts.providers;
    this.mode = opts.mode;
    this.threshold = opts.threshold;
    this.buffer = opts.buffer ?? 0;
    this.alertRatio = opts.alertRatio ?? 1.2;
    this.intervalSec = Math.max(60, opts.intervalSec);

    this.state = {
      providers: opts.providers,
      mode: opts.mode,
      threshold: opts.threshold,
      buffer: this.buffer,
      alertRatio: this.alertRatio,
      intervalSec: this.intervalSec,
      lastCheckAt: 0,
      alerts: {},
    };
  }

  async start(): Promise<void> {
    this.checkAndWritePid();
    this.cleanupShutdownFile();
    this.saveState(); // Write initial state so onboard detect can verify config

    logger.info(`[Monitor] Starting balance monitor`);
    logger.info(`[Monitor] Mode: ${this.mode}`);
    logger.info(`[Monitor] Providers: ${this.providers.join(", ")}`);
    if (this.mode === "fixed") {
      logger.info(`[Monitor] Threshold: ${this.threshold} 0G, interval: ${this.intervalSec}s`);
    } else {
      logger.info(`[Monitor] Buffer: ${this.buffer} 0G, alertRatio: ${this.alertRatio}, interval: ${this.intervalSec}s`);
    }

    // Preflight: validate webhook configuration
    const hooksConfig = loadHooksConfig();
    if (!hooksConfig) {
      logger.warn("[Monitor] Webhook NOT configured — alerts will be logged but not delivered");
    } else {
      const routing = formatRoutingFlags(hooksConfig);
      if (!hooksConfig.channel || !hooksConfig.to) {
        logger.warn(`[Monitor] Webhook routing incomplete (${routing}) — alerts may not be delivered`);
      } else {
        logger.info(`[Monitor] Webhook routing: ${routing}`);
      }
    }

    // Signal handlers
    const onSignal = () => this.stop();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // Shutdown file watcher (Windows fallback)
    this.shutdownWatcher = setInterval(() => {
      if (existsSync(ZG_MONITOR_SHUTDOWN_FILE)) {
        logger.info("[Monitor] Shutdown file detected, stopping...");
        this.stop();
      }
    }, 1000);

    // First check immediately
    await this.poll();

    // Then schedule recurring
    this.schedulePoll();

    logger.info("[Monitor] Running (press Ctrl+C to stop)");
  }

  private schedulePoll(): void {
    if (this.shuttingDown) return;
    this.pollTimer = setTimeout(async () => {
      if (this.shuttingDown) return;
      await this.poll();
      this.schedulePoll();
    }, this.intervalSec * 1000);
  }

  private async poll(): Promise<void> {
    try {
      const broker = await getAuthenticatedBroker();

      // In recommended mode, fetch pricing once per poll
      let providerPricingMap: Map<string, { threshold: number; recommendedMin: number }> | undefined;
      if (this.mode === "recommended") {
        providerPricingMap = new Map();
        try {
          const services = await withSuppressedConsole(() =>
            broker.inference.listServiceWithDetail()
          );
          for (const svc of services) {
            const addr = (svc.provider as string).toLowerCase();
            const pricing = calculateProviderPricing(
              svc.inputPrice as bigint,
              svc.outputPrice as bigint,
              undefined,
              this.alertRatio,
            );
            providerPricingMap.set(addr, {
              threshold: pricing.recommendedAlertLockedOg + this.buffer,
              recommendedMin: pricing.recommendedMinLockedOg,
            });
          }
        } catch (err) {
          logger.warn(`[Monitor] Failed to fetch service pricing: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const provider of this.providers) {
        try {
          const account = await withSuppressedConsole(() =>
            broker.inference.getAccount(provider)
          );

          const normalized = normalizeSubAccount(account);

          logger.debug(
            `[Monitor] ${provider.slice(0, 10)}... locked: ${normalized.lockedOg.toFixed(4)} 0G ` +
            `(total: ${normalized.totalOg.toFixed(4)}, pending: ${normalized.pendingRefundOg.toFixed(4)})`
          );

          // Determine effective threshold
          let effectiveThreshold: number;
          let recommendedMin: number | undefined;

          if (this.mode === "fixed") {
            effectiveThreshold = this.threshold!;
          } else {
            const providerKey = provider.toLowerCase();
            const pricing = providerPricingMap?.get(providerKey);
            if (pricing) {
              effectiveThreshold = pricing.threshold;
              recommendedMin = pricing.recommendedMin;
            } else {
              // Fallback: provider not found in services list, use 1.0 0G floor
              effectiveThreshold = 1.0 + this.buffer;
              recommendedMin = 1.0;
              logger.debug(`[Monitor] ${provider.slice(0, 10)}... not found in services, using floor threshold`);
            }
          }

          if (normalized.lockedOg < effectiveThreshold) {
            await this.handleLowBalance(provider, normalized.lockedOg, effectiveThreshold, recommendedMin);
          }

          // Save per-provider thresholds in state
          if (this.mode === "recommended") {
            if (!this.state.providerThresholds) this.state.providerThresholds = {};
            this.state.providerThresholds[provider] = {
              threshold: effectiveThreshold,
              recommendedMin: recommendedMin ?? effectiveThreshold,
            };
          }
        } catch (err) {
          logger.warn(`[Monitor] Failed to check ${provider.slice(0, 10)}...: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      this.state.lastCheckAt = Date.now();
      this.saveState();
    } catch (err) {
      logger.error(`[Monitor] Poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleLowBalance(
    provider: string,
    lockedOg: number,
    threshold: number,
    recommendedMin?: number,
  ): Promise<void> {
    const now = Date.now();
    const alertState = this.state.alerts[provider];

    if (alertState) {
      const timeSinceLastAlert = now - alertState.lastAlertAt;
      const lastBalance = parseFloat(alertState.lastAlertBalance);

      // Anti-spam: skip if alerted less than 1h ago AND balance hasn't dropped another 50%
      if (
        timeSinceLastAlert < ALERT_COOLDOWN_MS &&
        (lastBalance === 0 || lockedOg > lastBalance * ALERT_DROP_THRESHOLD)
      ) {
        logger.debug(`[Monitor] Suppressing alert for ${provider.slice(0, 10)}... (cooldown)`);
        return;
      }
    }

    logger.warn(
      `[Monitor] Low balance: ${provider.slice(0, 10)}... locked=${lockedOg.toFixed(4)} 0G ` +
      `(threshold: ${threshold.toFixed(4)}${recommendedMin != null ? `, recommendedMin: ${recommendedMin.toFixed(4)}` : ""})`
    );

    // Update alert state
    this.state.alerts[provider] = {
      lastAlertAt: now,
      lastAlertBalance: lockedOg.toString(),
    };
    this.saveState();

    // Send webhook
    await this.sendWebhook(provider, lockedOg, threshold, recommendedMin);
  }

  private async sendWebhook(
    provider: string,
    lockedOg: number,
    threshold: number,
    recommendedMin?: number,
  ): Promise<void> {
    const config = loadHooksConfig();
    if (!config) {
      logger.debug("[Monitor] Webhook disabled (OPENCLAW_HOOKS_* not configured)");
      return;
    }

    const lines = [
      `Low balance for provider ${provider.slice(0, 10)}...`,
      `Locked: ${lockedOg.toFixed(4)} 0G (threshold: ${threshold.toFixed(4)} 0G)`,
    ];
    if (recommendedMin != null) {
      lines.push(`Recommended min: ${recommendedMin.toFixed(4)} 0G`);
    }
    lines.push(
      `Run: echoclaw 0g-compute ledger fund --provider ${provider} --amount <amount> --yes`,
    );

    const message = lines.join("\n");

    const body = {
      message,
      name: "BalanceMonitor",
      deliver: true,
      wakeMode: "now",
      ...(config.agentId ? { agentId: config.agentId } : {}),
      ...(config.channel ? { channel: config.channel } : {}),
      ...(config.to ? { to: config.to } : {}),
    };

    const url = `${config.baseUrl}/hooks/agent`;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });

        const routing = formatRoutingFlags(config);
        if (res.ok) {
          logger.info(`[Monitor] Webhook sent for ${provider.slice(0, 10)}... (${routing})`);
        } else {
          logger.warn(`[Monitor] Webhook failed: ${res.status} for ${provider.slice(0, 10)}... (${routing})`);
        }
        return;
      } catch (err) {
        if (attempt === 0) continue;
        const routing = formatRoutingFlags(config);
        logger.warn(`[Monitor] Webhook error: ${err instanceof Error ? err.message : String(err)} (${routing})`);
      }
    }
  }

  private checkAndWritePid(): void {
    if (!existsSync(ZG_COMPUTE_DIR)) {
      mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
    }

    if (existsSync(ZG_MONITOR_PID_FILE)) {
      const existingPid = parseInt(readFileSync(ZG_MONITOR_PID_FILE, "utf-8").trim(), 10);
      try {
        process.kill(existingPid, 0);
        throw new EchoError(
          ErrorCodes.ZG_MONITOR_ALREADY_RUNNING,
          `Balance monitor already running (PID ${existingPid})`,
          "Run: echoclaw 0g-compute monitor stop"
        );
      } catch (err) {
        if (err instanceof EchoError) throw err;
        logger.debug(`[Monitor] Removing stale pidfile (PID ${existingPid})`);
        unlinkSync(ZG_MONITOR_PID_FILE);
      }
    }

    writeFileSync(ZG_MONITOR_PID_FILE, String(process.pid), "utf-8");
    logger.debug(`[Monitor] PID file written: ${process.pid}`);
  }

  private cleanupShutdownFile(): void {
    try {
      if (existsSync(ZG_MONITOR_SHUTDOWN_FILE)) {
        unlinkSync(ZG_MONITOR_SHUTDOWN_FILE);
      }
    } catch { /* ignore */ }
  }

  private saveState(): void {
    try {
      if (!existsSync(ZG_COMPUTE_DIR)) {
        mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
      }
      writeFileSync(ZG_MONITOR_STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      logger.warn(`[Monitor] Failed to save state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info("[Monitor] Shutting down...");

    if (this.shutdownWatcher) {
      clearInterval(this.shutdownWatcher);
      this.shutdownWatcher = null;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    try {
      if (existsSync(ZG_MONITOR_PID_FILE)) unlinkSync(ZG_MONITOR_PID_FILE);
    } catch { /* ignore */ }
    try {
      if (existsSync(ZG_MONITOR_SHUTDOWN_FILE)) unlinkSync(ZG_MONITOR_SHUTDOWN_FILE);
    } catch { /* ignore */ }

    logger.info("[Monitor] Stopped");
    process.exit(0);
  }
}
