import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OpenClawHooksConfig } from "../openclaw/hooks-client.js"; // used in makeConfig

// ── Mocks (before imports) ──────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockLoadHooksConfig = vi.fn();
const mockFormatRoutingFlags = vi.fn();

vi.mock("../openclaw/hooks-client.js", () => ({
  loadHooksConfig: () => mockLoadHooksConfig(),
  formatRoutingFlags: (config: any) => mockFormatRoutingFlags(config),
}));

// Mock 0g-compute transitive deps that rollup cannot parse
vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: vi.fn(),
}));
vi.mock("../0g-compute/bridge.js", () => ({
  withSuppressedConsole: vi.fn(),
}));
vi.mock("../0g-compute/account.js", () => ({
  normalizeSubAccount: vi.fn(),
}));
vi.mock("../0g-compute/pricing.js", () => ({
  calculateProviderPricing: vi.fn(),
}));

import logger from "../utils/logger.js";
import { BalanceMonitor } from "../0g-compute/monitor.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<OpenClawHooksConfig> = {}): OpenClawHooksConfig {
  return {
    baseUrl: "http://127.0.0.1:18789",
    token: "test-token",
    includeGuardrail: false,
    ...overrides,
  };
}

function makeMonitor(): BalanceMonitor {
  return new BalanceMonitor({
    providers: ["0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`],
    mode: "fixed",
    threshold: 1.0,
    intervalSec: 300,
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("BalanceMonitor.sendWebhook", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", mockFetch);
    mockFormatRoutingFlags.mockReturnValue("channel=no to=no agentId=no");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when hooks not configured", async () => {
    mockLoadHooksConfig.mockReturnValue(null);
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("not configured"));
  });

  it("sends POST with correct body structure", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig());
    mockFormatRoutingFlags.mockReturnValue("channel=no to=no agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18789/hooks/agent");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");

    const body = JSON.parse(opts.body);
    expect(body.name).toBe("BalanceMonitor");
    expect(body.deliver).toBe(true);
    expect(body.wakeMode).toBe("now");
    expect(body.message).toContain("Low balance");
  });

  it("includes `to` in body when config.to is set", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig({ to: "@user" }));
    mockFormatRoutingFlags.mockReturnValue("channel=no to=yes agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.to).toBe("@user");
  });

  it("omits `to` from body when config.to is undefined", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig());
    mockFormatRoutingFlags.mockReturnValue("channel=no to=no agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.to).toBeUndefined();
  });

  it("includes agentId/channel/to together when all set", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig({
      agentId: "agent-42",
      channel: "telegram",
      to: "+1234567890",
    }));
    mockFormatRoutingFlags.mockReturnValue("channel=telegram to=yes agentId=yes");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agentId).toBe("agent-42");
    expect(body.channel).toBe("telegram");
    expect(body.to).toBe("+1234567890");
  });

  it("logs routing flags on success", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig({ to: "@user" }));
    mockFormatRoutingFlags.mockReturnValue("channel=no to=yes agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("to=yes"));
  });

  it("logs routing flags on HTTP failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    mockLoadHooksConfig.mockReturnValue(makeConfig());
    mockFormatRoutingFlags.mockReturnValue("channel=no to=no agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("502"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("to=no"));
  });

  it("includes recommendedMin in message when provided", async () => {
    mockLoadHooksConfig.mockReturnValue(makeConfig());
    mockFormatRoutingFlags.mockReturnValue("channel=no to=no agentId=no");
    const monitor = makeMonitor();
    await (monitor as any).sendWebhook("0x1234567890", 0.5, 1.0, 2.0);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message).toContain("Recommended min: 2.0000 0G");
  });
});
