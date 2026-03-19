/**
 * OpenClaw webhook notification client.
 *
 * Sends trade events to OpenClaw Gateway (POST /hooks/agent) so the agent
 * can deliver notifications to the user's messenger (WhatsApp, Telegram, etc.).
 *
 * Configuration via ENV vars — disabled when not set.
 * Fire-and-forget: errors are logged but never thrown.
 */

import logger from "../utils/logger.js";
import type { BotNotification } from "../bot/types.js";
import { loadOpenclawConfig } from "./config.js";

// ── Config ──────────────────────────────────────────────────────────

export interface OpenClawHooksConfig {
  baseUrl: string;
  token: string;
  agentId?: string;
  channel?: string;
  to?: string;
  includeGuardrail: boolean;
}

let cachedConfig: OpenClawHooksConfig | null | undefined;

export function loadHooksConfig(): OpenClawHooksConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const baseUrl = process.env.OPENCLAW_HOOKS_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.OPENCLAW_HOOKS_TOKEN;

  if (!baseUrl || !token) {
    cachedConfig = null;
    return null;
  }

  cachedConfig = {
    baseUrl,
    token,
    agentId: process.env.OPENCLAW_HOOKS_AGENT_ID || undefined,
    channel: process.env.OPENCLAW_HOOKS_CHANNEL || undefined,
    to: process.env.OPENCLAW_HOOKS_TO || undefined,
    includeGuardrail: process.env.OPENCLAW_HOOKS_INCLUDE_GUARDRAIL === "1",
  };
  return cachedConfig;
}

/** Test-only: resets cached ENV config so next call re-reads process.env. */
export function _resetConfigCache(): void {
  cachedConfig = undefined;
}

// ── Routing diagnostics ─────────────────────────────────────────────

/** Routing flags for webhook logs — no secret values, only presence flags. */
export function formatRoutingFlags(config: OpenClawHooksConfig): string {
  return `channel=${config.channel ?? "no"} to=${config.to ? "yes" : "no"} agentId=${config.agentId ? "yes" : "no"}`;
}

// ── Validation ──────────────────────────────────────────────────────

export interface TokenSyncResult {
  synced: boolean;
  bothPresent: boolean;
  hooksTokenSet: boolean;
  skillTokenSet: boolean;
}

/**
 * Compares hooks.token (gateway auth) with OPENCLAW_HOOKS_TOKEN (skill env)
 * in openclaw.json. Reads the config file directly — does NOT use ENV vars.
 */
export function validateHooksTokenSync(skillKey = "echoclaw"): TokenSyncResult {
  const config = loadOpenclawConfig();
  if (!config) {
    return { synced: false, bothPresent: false, hooksTokenSet: false, skillTokenSet: false };
  }

  const hooksToken = config.hooks?.token as string | undefined;
  const skillToken = config.skills?.entries?.[skillKey]?.env?.OPENCLAW_HOOKS_TOKEN as string | undefined;

  return {
    synced: !!hooksToken && !!skillToken && hooksToken === skillToken,
    bothPresent: !!hooksToken && !!skillToken,
    hooksTokenSet: !!hooksToken,
    skillTokenSet: !!skillToken,
  };
}

export interface RoutingValidationResult {
  valid: boolean;
  warnings: string[];
}

/** Checks whether channel and to are configured for reliable delivery. */
export function validateHooksRouting(config: OpenClawHooksConfig): RoutingValidationResult {
  const warnings: string[] = [];
  if (!config.channel) {
    warnings.push("channel not set — webhook will use last channel from main session (may be undefined)");
  }
  if (!config.to) {
    warnings.push("to not set — webhook will use last recipient from main session (may be undefined)");
  }
  return { valid: warnings.length === 0, warnings };
}

// ── Payload builders (dry-run simulation) ───────────────────────────

export interface WebhookPayloadPreview {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function maskToken(token: string): string {
  return token.length > 8 ? `${token.slice(0, 8)}...<redacted>` : "<redacted>";
}

/**
 * Constructs the same payload BalanceMonitor.sendWebhook() would send.
 * Does NOT send anything — for dry-run testing only.
 */
export function buildMonitorAlertPayload(
  config: OpenClawHooksConfig,
  opts?: { provider?: string; lockedOg?: number; threshold?: number; recommendedMin?: number },
): WebhookPayloadPreview {
  const provider = opts?.provider ?? "0x0000000000000000000000000000000000000000";
  const lockedOg = opts?.lockedOg ?? 0.5;
  const threshold = opts?.threshold ?? 1.0;
  const recommendedMin = opts?.recommendedMin;

  const lines = [
    `Low balance for provider ${provider.slice(0, 10)}...`,
    `Locked: ${lockedOg.toFixed(4)} 0G (threshold: ${threshold.toFixed(4)} 0G)`,
  ];
  if (recommendedMin != null) {
    lines.push(`Recommended min: ${recommendedMin.toFixed(4)} 0G`);
  }
  lines.push(`Run: echoclaw 0g-compute ledger fund --provider ${provider} --amount <amount> --yes`);

  const body: Record<string, unknown> = {
    message: lines.join("\n"),
    name: "BalanceMonitor",
    deliver: true,
    wakeMode: "now",
  };
  if (config.agentId) body.agentId = config.agentId;
  if (config.channel) body.channel = config.channel;
  if (config.to) body.to = config.to;

  return {
    url: `${config.baseUrl}/hooks/agent`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${maskToken(config.token)}`,
    },
    body,
  };
}

/**
 * Constructs the same payload postWebhookNotification() would send for a mock BUY_FILLED.
 * Does NOT send anything — for dry-run testing only.
 */
export function buildMarketMakerPayload(config: OpenClawHooksConfig): WebhookPayloadPreview {
  const mockNotification: BotNotification = {
    type: "BUY_FILLED",
    amountOg: "1.0000",
    tokenSymbol: "TEST",
    token: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://chainscan.0g.ai/tx/0x0000...mock",
    timestamp: Date.now(),
  };

  const message = formatWebhookMessage(mockNotification)!;
  const body: Record<string, unknown> = {
    message,
    name: "MarketMaker",
    deliver: true,
    wakeMode: "now",
  };
  if (config.agentId) body.agentId = config.agentId;
  if (config.channel) body.channel = config.channel;
  if (config.to) body.to = config.to;

  return {
    url: `${config.baseUrl}/hooks/agent`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${maskToken(config.token)}`,
    },
    body,
  };
}

// ── Live probe ──────────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Sends a constructed payload to /hooks/agent. Used by --probe-live only. */
export async function sendTestWebhook(
  config: OpenClawHooksConfig,
  body: Record<string, unknown>,
): Promise<ProbeResult> {
  const url = `${config.baseUrl}/hooks/agent`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Message formatting ──────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 2048;

export function formatWebhookMessage(notification: BotNotification): string | null {
  let msg: string | null;

  switch (notification.type) {
    case "BUY_FILLED":
      msg = `Bought ${notification.amountOg ?? "?"} 0G of ${notification.tokenSymbol ?? notification.token?.slice(0, 10) ?? "?"} | tx: ${notification.explorerUrl ?? notification.txHash ?? "?"}`;
      break;
    case "SELL_FILLED":
      msg = `Sold ${notification.amountTokens ?? "?"} ${notification.tokenSymbol ?? notification.token?.slice(0, 10) ?? "?"} | tx: ${notification.explorerUrl ?? notification.txHash ?? "?"}`;
      break;
    case "TRADE_FAILED":
      msg = `Trade failed: ${notification.failReason?.slice(0, 200) ?? "unknown"}`;
      break;
    case "GUARDRAIL_EXCEEDED":
      msg = `Guardrail exceeded: ${notification.failReason?.slice(0, 200) ?? "unknown"}`;
      break;
    default:
      // BOT_STARTED, BOT_STOPPED — never sent via webhook
      return null;
  }

  if (msg.length > MAX_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_MESSAGE_LENGTH);
  }
  return msg;
}

// ── Webhook delivery ────────────────────────────────────────────────

export async function postWebhookNotification(notification: BotNotification): Promise<void> {
  const config = loadHooksConfig();
  if (!config) return;

  // Filter event types
  if (notification.type === "BOT_STARTED" || notification.type === "BOT_STOPPED") return;
  if (notification.type === "GUARDRAIL_EXCEEDED" && !config.includeGuardrail) return;

  const message = formatWebhookMessage(notification);
  if (!message) return;

  const body: Record<string, unknown> = {
    message,
    name: "MarketMaker",
    deliver: true,
    wakeMode: "now",
  };
  if (config.agentId) body.agentId = config.agentId;
  if (config.channel) body.channel = config.channel;
  if (config.to) body.to = config.to;

  const url = `${config.baseUrl}/hooks/agent`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      const routing = formatRoutingFlags(config);
      if (res.ok) {
        logger.info(`[OpenClaw] webhook.sent type=${notification.type} name=MarketMaker (${routing})`);
      } else {
        logger.warn(`[OpenClaw] webhook.failed status=${res.status} type=${notification.type} (${routing})`);
      }
      // Any HTTP response (success or error) → done, no retry
      return;
    } catch (err) {
      lastError = err;
      // Only retry once on network/timeout errors
      if (attempt === 0) continue;
    }
  }

  // Both attempts failed with network error
  const routing = formatRoutingFlags(config);
  logger.warn(`[OpenClaw] webhook.failed error=${lastError instanceof Error ? lastError.message : String(lastError)} type=${notification.type} (${routing})`);
}
