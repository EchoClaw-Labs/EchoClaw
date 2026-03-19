import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { BotNotification } from "../bot/types.js";

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  loadOpenclawConfig: vi.fn(),
}));

import logger from "../utils/logger.js";
import { loadOpenclawConfig } from "../openclaw/config.js";
import {
  loadHooksConfig,
  formatWebhookMessage,
  formatRoutingFlags,
  postWebhookNotification,
  _resetConfigCache,
  validateHooksTokenSync,
  validateHooksRouting,
  buildMonitorAlertPayload,
  buildMarketMakerPayload,
  sendTestWebhook,
  type OpenClawHooksConfig,
} from "../openclaw/hooks-client.js";

const HOOKS_ENV_KEYS = [
  "OPENCLAW_HOOKS_BASE_URL",
  "OPENCLAW_HOOKS_TOKEN",
  "OPENCLAW_HOOKS_AGENT_ID",
  "OPENCLAW_HOOKS_CHANNEL",
  "OPENCLAW_HOOKS_TO",
  "OPENCLAW_HOOKS_INCLUDE_GUARDRAIL",
];

function setEnv(overrides: Partial<Record<string, string>> = {}): void {
  process.env.OPENCLAW_HOOKS_BASE_URL = "http://127.0.0.1:18789";
  process.env.OPENCLAW_HOOKS_TOKEN = "test-token";
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
}

function makeBuyFilled(overrides: Partial<BotNotification> = {}): BotNotification {
  return {
    type: "BUY_FILLED",
    amountOg: "1.5",
    tokenSymbol: "SLOP",
    token: "0xabc123",
    explorerUrl: "https://explorer.example.com/tx/0x123",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("openclaw/hooks-client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetConfigCache();
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of HOOKS_ENV_KEYS) {
      delete process.env[key];
    }
    vi.unstubAllGlobals();
  });

  // ── loadHooksConfig ─────────────────────────────────────────────

  describe("loadHooksConfig", () => {
    it("returns null when BASE_URL missing", () => {
      process.env.OPENCLAW_HOOKS_TOKEN = "tok";
      expect(loadHooksConfig()).toBeNull();
    });

    it("returns null when TOKEN missing", () => {
      process.env.OPENCLAW_HOOKS_BASE_URL = "http://localhost";
      expect(loadHooksConfig()).toBeNull();
    });

    it("returns config when both required vars set", () => {
      setEnv();
      const cfg = loadHooksConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.baseUrl).toBe("http://127.0.0.1:18789");
      expect(cfg!.token).toBe("test-token");
      expect(cfg!.includeGuardrail).toBe(false);
    });

    it("includes optional agentId/channel/to when set", () => {
      setEnv({
        OPENCLAW_HOOKS_AGENT_ID: "agent-1",
        OPENCLAW_HOOKS_CHANNEL: "whatsapp",
        OPENCLAW_HOOKS_TO: "+1234567890",
      });
      const cfg = loadHooksConfig()!;
      expect(cfg.agentId).toBe("agent-1");
      expect(cfg.channel).toBe("whatsapp");
      expect(cfg.to).toBe("+1234567890");
    });

    it("strips trailing slashes from baseUrl", () => {
      setEnv({ OPENCLAW_HOOKS_BASE_URL: "http://localhost:18789///" });
      const cfg = loadHooksConfig()!;
      expect(cfg.baseUrl).toBe("http://localhost:18789");
    });
  });

  // ── formatRoutingFlags ─────────────────────────────────────────

  describe("formatRoutingFlags", () => {
    it("shows all fields when set", () => {
      const flags = formatRoutingFlags({
        baseUrl: "http://localhost",
        token: "t",
        includeGuardrail: false,
        agentId: "agent-1",
        channel: "telegram",
        to: "+123",
      });
      expect(flags).toBe("channel=telegram to=yes agentId=yes");
    });

    it("shows 'no' for missing fields", () => {
      const flags = formatRoutingFlags({
        baseUrl: "http://localhost",
        token: "t",
        includeGuardrail: false,
      });
      expect(flags).toBe("channel=no to=no agentId=no");
    });
  });

  // ── formatWebhookMessage ────────────────────────────────────────

  describe("formatWebhookMessage", () => {
    it("BUY_FILLED → message with amount and explorer URL", () => {
      const msg = formatWebhookMessage(makeBuyFilled());
      expect(msg).toContain("Bought");
      expect(msg).toContain("1.5");
      expect(msg).toContain("0G");
      expect(msg).toContain("SLOP");
      expect(msg).toContain("explorer.example.com");
    });

    it("SELL_FILLED → message with token amount and symbol", () => {
      const msg = formatWebhookMessage({
        type: "SELL_FILLED",
        amountTokens: "500",
        tokenSymbol: "SLOP",
        explorerUrl: "https://explorer.example.com/tx/0x456",
        timestamp: Date.now(),
      });
      expect(msg).toContain("Sold");
      expect(msg).toContain("500");
      expect(msg).toContain("SLOP");
    });

    it("TRADE_FAILED → message with reason", () => {
      const msg = formatWebhookMessage({
        type: "TRADE_FAILED",
        failReason: "insufficient balance",
        timestamp: Date.now(),
      });
      expect(msg).toContain("Trade failed");
      expect(msg).toContain("insufficient balance");
    });

    it("GUARDRAIL_EXCEEDED → message with reason", () => {
      const msg = formatWebhookMessage({
        type: "GUARDRAIL_EXCEEDED",
        failReason: "daily spend limit",
        timestamp: Date.now(),
      });
      expect(msg).toContain("Guardrail exceeded");
      expect(msg).toContain("daily spend limit");
    });

    it("BOT_STARTED → null", () => {
      expect(formatWebhookMessage({ type: "BOT_STARTED", timestamp: Date.now() })).toBeNull();
    });

    it("BOT_STOPPED → null", () => {
      expect(formatWebhookMessage({ type: "BOT_STOPPED", timestamp: Date.now() })).toBeNull();
    });
  });

  // ── postWebhookNotification ─────────────────────────────────────

  describe("postWebhookNotification", () => {
    it("skips silently when ENV not configured", async () => {
      await postWebhookNotification(makeBuyFilled());
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips silently for BOT_STARTED", async () => {
      setEnv();
      _resetConfigCache();
      await postWebhookNotification({ type: "BOT_STARTED", timestamp: Date.now() });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips GUARDRAIL_EXCEEDED when INCLUDE_GUARDRAIL not set", async () => {
      setEnv();
      _resetConfigCache();
      await postWebhookNotification({
        type: "GUARDRAIL_EXCEEDED",
        failReason: "limit hit",
        timestamp: Date.now(),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends GUARDRAIL_EXCEEDED when INCLUDE_GUARDRAIL=1", async () => {
      setEnv({ OPENCLAW_HOOKS_INCLUDE_GUARDRAIL: "1" });
      _resetConfigCache();
      await postWebhookNotification({
        type: "GUARDRAIL_EXCEEDED",
        failReason: "limit hit",
        timestamp: Date.now(),
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends correct POST with headers/body on BUY_FILLED", async () => {
      setEnv();
      _resetConfigCache();
      await postWebhookNotification(makeBuyFilled());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:18789/hooks/agent");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe("Bearer test-token");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.message).toContain("Bought");
      expect(body.name).toBe("MarketMaker");
      expect(body.deliver).toBe(true);
      expect(body.wakeMode).toBe("now");
      expect(body.agentId).toBeUndefined();
    });

    it("includes agentId in body when AGENT_ID configured", async () => {
      setEnv({ OPENCLAW_HOOKS_AGENT_ID: "agent-42" });
      _resetConfigCache();
      await postWebhookNotification(makeBuyFilled());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.agentId).toBe("agent-42");
    });

    it("includes channel/to in body when configured", async () => {
      setEnv({
        OPENCLAW_HOOKS_CHANNEL: "telegram",
        OPENCLAW_HOOKS_TO: "@user",
      });
      _resetConfigCache();
      await postWebhookNotification(makeBuyFilled());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.channel).toBe("telegram");
      expect(body.to).toBe("@user");

      // Routing flags logged
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("channel=telegram"));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("to=yes"));
    });

    it("logs info on successful response with routing flags", async () => {
      setEnv();
      _resetConfigCache();
      mockFetch.mockResolvedValue({ ok: true, status: 202 });
      await postWebhookNotification(makeBuyFilled());
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("webhook.sent"));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("channel=no"));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("to=no"));
    });

    it("logs warn on 401 (no retry)", async () => {
      setEnv();
      _resetConfigCache();
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      await postWebhookNotification(makeBuyFilled());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("status=401"));
    });

    it("retries once on network error, logs warn on final failure", async () => {
      setEnv();
      _resetConfigCache();
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await postWebhookNotification(makeBuyFilled());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });

    it("does NOT retry on 500 (logs warn immediately)", async () => {
      setEnv();
      _resetConfigCache();
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      await postWebhookNotification(makeBuyFilled());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("status=500"));
    });

    it("truncates message over 2048 chars", async () => {
      setEnv();
      _resetConfigCache();
      const longReason = "x".repeat(3000);
      await postWebhookNotification({
        type: "TRADE_FAILED",
        failReason: longReason,
        timestamp: Date.now(),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message.length).toBeLessThanOrEqual(2048);
    });
  });

  // ── validateHooksTokenSync ──────────────────────────────────────

  describe("validateHooksTokenSync", () => {
    const mockLoadConfig = vi.mocked(loadOpenclawConfig);

    it("returns synced=false when config does not exist", () => {
      mockLoadConfig.mockReturnValue(null);
      const result = validateHooksTokenSync();
      expect(result.synced).toBe(false);
      expect(result.bothPresent).toBe(false);
      expect(result.hooksTokenSet).toBe(false);
      expect(result.skillTokenSet).toBe(false);
    });

    it("returns synced=true when both tokens match", () => {
      mockLoadConfig.mockReturnValue({
        hooks: { token: "shared-secret" },
        skills: { entries: { echoclaw: { env: { OPENCLAW_HOOKS_TOKEN: "shared-secret" } } } },
      });
      const result = validateHooksTokenSync();
      expect(result.synced).toBe(true);
      expect(result.bothPresent).toBe(true);
    });

    it("returns synced=false when tokens differ", () => {
      mockLoadConfig.mockReturnValue({
        hooks: { token: "gateway-token" },
        skills: { entries: { echoclaw: { env: { OPENCLAW_HOOKS_TOKEN: "skill-token" } } } },
      });
      const result = validateHooksTokenSync();
      expect(result.synced).toBe(false);
      expect(result.bothPresent).toBe(true);
      expect(result.hooksTokenSet).toBe(true);
      expect(result.skillTokenSet).toBe(true);
    });

    it("returns synced=false when only hooks.token is set", () => {
      mockLoadConfig.mockReturnValue({
        hooks: { token: "gateway-token" },
        skills: { entries: { echoclaw: { env: {} } } },
      });
      const result = validateHooksTokenSync();
      expect(result.synced).toBe(false);
      expect(result.hooksTokenSet).toBe(true);
      expect(result.skillTokenSet).toBe(false);
    });

    it("returns synced=false when only skill token is set", () => {
      mockLoadConfig.mockReturnValue({
        hooks: {},
        skills: { entries: { echoclaw: { env: { OPENCLAW_HOOKS_TOKEN: "skill-token" } } } },
      });
      const result = validateHooksTokenSync();
      expect(result.synced).toBe(false);
      expect(result.hooksTokenSet).toBe(false);
      expect(result.skillTokenSet).toBe(true);
    });
  });

  // ── validateHooksRouting ────────────────────────────────────────

  describe("validateHooksRouting", () => {
    const baseConfig: OpenClawHooksConfig = {
      baseUrl: "http://localhost",
      token: "tok",
      includeGuardrail: false,
    };

    it("returns valid=true when channel and to are set", () => {
      const result = validateHooksRouting({ ...baseConfig, channel: "telegram", to: "123" });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("returns warning when channel missing", () => {
      const result = validateHooksRouting({ ...baseConfig, to: "123" });
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("channel");
    });

    it("returns warning when to missing", () => {
      const result = validateHooksRouting({ ...baseConfig, channel: "telegram" });
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("to");
    });

    it("returns two warnings when both missing", () => {
      const result = validateHooksRouting(baseConfig);
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(2);
    });
  });

  // ── buildMonitorAlertPayload ────────────────────────────────────

  describe("buildMonitorAlertPayload", () => {
    const config: OpenClawHooksConfig = {
      baseUrl: "http://127.0.0.1:18789",
      token: "secret-token-value",
      channel: "telegram",
      to: "123456",
      includeGuardrail: false,
    };

    it("builds payload matching BalanceMonitor.sendWebhook format", () => {
      const p = buildMonitorAlertPayload(config, {
        provider: "0xABCD1234",
        lockedOg: 0.5,
        threshold: 1.0,
        recommendedMin: 2.0,
      });

      expect(p.url).toBe("http://127.0.0.1:18789/hooks/agent");
      expect(p.body.name).toBe("BalanceMonitor");
      expect(p.body.deliver).toBe(true);
      expect(p.body.wakeMode).toBe("now");
      expect(p.body.channel).toBe("telegram");
      expect(p.body.to).toBe("123456");
      expect(p.body.message).toContain("Low balance for provider");
      expect(p.body.message).toContain("0.5000 0G");
      expect(p.body.message).toContain("Recommended min: 2.0000");
    });

    it("masks token in headers", () => {
      const p = buildMonitorAlertPayload(config);
      expect(p.headers.Authorization).not.toContain("secret-token-value");
      expect(p.headers.Authorization).toContain("<redacted>");
    });

    it("uses default mock values when no opts provided", () => {
      const p = buildMonitorAlertPayload(config);
      expect(p.body.message).toContain("0x00000000");
    });
  });

  // ── buildMarketMakerPayload ─────────────────────────────────────

  describe("buildMarketMakerPayload", () => {
    const config: OpenClawHooksConfig = {
      baseUrl: "http://127.0.0.1:18789",
      token: "secret-token-value",
      channel: "telegram",
      to: "123456",
      agentId: "agent-1",
      includeGuardrail: false,
    };

    it("builds payload matching postWebhookNotification format", () => {
      const p = buildMarketMakerPayload(config);
      expect(p.url).toBe("http://127.0.0.1:18789/hooks/agent");
      expect(p.body.name).toBe("MarketMaker");
      expect(p.body.deliver).toBe(true);
      expect(p.body.wakeMode).toBe("now");
      expect(p.body.channel).toBe("telegram");
      expect(p.body.to).toBe("123456");
      expect(p.body.agentId).toBe("agent-1");
      expect(p.body.message).toContain("Bought");
      expect(p.body.message).toContain("TEST");
    });

    it("masks token in headers", () => {
      const p = buildMarketMakerPayload(config);
      expect(p.headers.Authorization).not.toContain("secret-token-value");
      expect(p.headers.Authorization).toContain("<redacted>");
    });
  });

  // ── sendTestWebhook ─────────────────────────────────────────────

  describe("sendTestWebhook", () => {
    const config: OpenClawHooksConfig = {
      baseUrl: "http://127.0.0.1:18789",
      token: "test-token",
      includeGuardrail: false,
    };
    const body = { message: "test", name: "probe", deliver: true };

    it("returns ok=true on 202 response", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 202 });
      const result = await sendTestWebhook(config, body);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(202);
    });

    it("returns ok=false on 401 response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      const result = await sendTestWebhook(config, body);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain("401");
    });

    it("returns ok=false with error on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await sendTestWebhook(config, body);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("sends correct auth header", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 202 });
      await sendTestWebhook(config, body);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:18789/hooks/agent");
      expect(opts.headers.Authorization).toBe("Bearer test-token");
    });
  });
});
