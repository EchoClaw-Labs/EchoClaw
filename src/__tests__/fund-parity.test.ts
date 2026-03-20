import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { RouteParams } from "../launcher/types.js";

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<void>>();

let capturedComputeState: Record<string, unknown> | null = null;
let capturedClaudeConfig: Record<string, unknown> | null = null;
const capturedOpenclawPatches: Array<{ path: string; value: unknown }> = [];
let capturedClearedAuth = { claude: false, openclaw: false };
let capturedOpenclawBinding: { provider: string; apiKey: string } | null = null;
let capturedWorkflow: Record<string, unknown> | null = null;

const mockLoadComputeState = vi.fn();
const mockSaveComputeState = vi.fn().mockImplementation((state: Record<string, unknown>) => {
  capturedComputeState = state;
});
const mockLoadConfig = vi.fn();
const mockSaveConfig = vi.fn().mockImplementation((cfg: { claude?: Record<string, unknown> }) => {
  capturedClaudeConfig = cfg.claude ?? null;
});
const mockLoadOpenclawConfig = vi.fn();
const mockPatchOpenclawConfig = vi.fn().mockImplementation((path: string, value: unknown) => {
  capturedOpenclawPatches.push({ path, value });
});
const mockRemoveOpenclawConfigKey = vi.fn().mockImplementation((key: string) => {
  if (key === "models.providers.zg.apiKey") capturedClearedAuth.openclaw = true;
});
const mockWriteAppEnvValue = vi.fn().mockImplementation((key: string, value: string) => {
  if (key === "ZG_CLAUDE_AUTH_TOKEN" && value === "") capturedClearedAuth.claude = true;
  if (key === "ZG_CLAUDE_AUTH_TOKEN") process.env.ZG_CLAUDE_AUTH_TOKEN = value;
});
const mockCreateApiKey = vi.fn();
const mockConfigureOpenclawProvider = vi.fn().mockImplementation((_broker: unknown, provider: string, apiKey: string) => {
  capturedOpenclawBinding = { provider, apiKey };
  return { providerPatch: {}, modePatch: {} };
});
const mockListChatServices = vi.fn();
const mockDepositToLedger = vi.fn();
const mockFundProvider = vi.fn();
const mockAckWithReadback = vi.fn();
const mockGetLedgerBalance = vi.fn();
const mockGetSubAccountBalance = vi.fn();
const mockIsProviderAcked = vi.fn();
const mockGetAuthenticatedBroker = vi.fn();
const mockGetBalance = vi.fn();

vi.mock("../launcher/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: (...args: unknown[]) => Promise<void>) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: Record<string, unknown>, status: number, body: unknown) => {
    res._status = status;
    res._body = body;
  }),
  errorResponse: vi.fn((res: Record<string, unknown>, status: number, code: string, message: string, hint?: string) => {
    res._status = status;
    res._body = { error: { code, message, ...(hint ? { hint } : {}) } };
  }),
}));

vi.mock("../0g-compute/readiness.js", () => ({
  loadComputeState: (...args: unknown[]) => mockLoadComputeState(...args),
  saveComputeState: (...args: unknown[]) => mockSaveComputeState(...args),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../openclaw/config.js", () => ({
  loadOpenclawConfig: (...args: unknown[]) => mockLoadOpenclawConfig(...args),
  patchOpenclawConfig: (...args: unknown[]) => mockPatchOpenclawConfig(...args),
  removeOpenclawConfigKey: (...args: unknown[]) => mockRemoveOpenclawConfigKey(...args),
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: (...args: unknown[]) => mockWriteAppEnvValue(...args),
}));

vi.mock("../0g-compute/operations.js", () => ({
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
  configureOpenclawProvider: (...args: unknown[]) => mockConfigureOpenclawProvider(...args),
  listChatServices: (...args: unknown[]) => mockListChatServices(...args),
  depositToLedger: (...args: unknown[]) => mockDepositToLedger(...args),
  fundProvider: (...args: unknown[]) => mockFundProvider(...args),
  ackWithReadback: (...args: unknown[]) => mockAckWithReadback(...args),
  getLedgerBalance: (...args: unknown[]) => mockGetLedgerBalance(...args),
  getSubAccountBalance: (...args: unknown[]) => mockGetSubAccountBalance(...args),
  isProviderAcked: (...args: unknown[]) => mockIsProviderAcked(...args),
}));

vi.mock("../0g-compute/pricing.js", () => ({
  calculateProviderPricing: vi.fn(() => ({ recommendedMinLockedOg: 1, recommendedAlertLockedOg: 1.2 })),
  formatPricePerMTokens: vi.fn(() => "1.00"),
}));

vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: (...args: unknown[]) => mockGetAuthenticatedBroker(...args),
  resetAuthenticatedBroker: vi.fn(),
}));

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../commands/echo/assessment.js", async () => {
  const actual = await vi.importActual<typeof import("../commands/echo/assessment.js")>("../commands/echo/assessment.js");
  return actual;
});

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../commands/echo/protocol.js", () => ({
  writeEchoWorkflow: vi.fn((payload: Record<string, unknown>) => {
    capturedWorkflow = payload;
  }),
}));

vi.mock("../wallet/client.js", () => ({
  getPublicClient: () => ({ getBalance: mockGetBalance }),
}));

vi.mock("../bot/executor.js", () => ({
  requireWalletAndKeystore: () => ({ address: "0xwallet" }),
}));

vi.mock("../0g-compute/monitor-lifecycle.js", () => ({
  getMonitorPid: vi.fn(() => null),
  isMonitorTrackingProvider: vi.fn(() => false),
  stopMonitorDaemon: vi.fn(),
}));

const { registerFundRoutes } = await import("../launcher/handlers/fund.js");
const { runHeadlessFund } = await import("../commands/echo/fund.js");
registerFundRoutes();

const BROKER = { id: "broker" };
const SERVICE_A = { provider: "0xAAA", model: "model-a", serviceType: "chatbot", url: "https://a.example.com/v1", inputPrice: 100n, outputPrice: 200n };
const SERVICE_B = { provider: "0xBBB", model: "model-b", serviceType: "chatbot", url: "https://b.example.com/v1", inputPrice: 100n, outputPrice: 200n };

function makeRes(): Record<string, unknown> {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown> | null = null): RouteParams {
  return { segments: {}, query: {}, body };
}

function resetCaptures(): void {
  capturedComputeState = null;
  capturedClaudeConfig = null;
  capturedOpenclawPatches.length = 0;
  capturedClearedAuth = { claude: false, openclaw: false };
  capturedOpenclawBinding = null;
  capturedWorkflow = null;
}

function setupScenario(opts: {
  currentProvider: string;
  currentModel: string;
  claudeConfigured: boolean;
  openclawConfigured: boolean;
}): void {
  mockLoadComputeState.mockReturnValue({
    activeProvider: opts.currentProvider,
    model: opts.currentModel,
    configuredAt: 1,
  });
  mockGetAuthenticatedBroker.mockResolvedValue(BROKER);
  mockListChatServices.mockResolvedValue([SERVICE_A, SERVICE_B]);
  mockCreateApiKey.mockResolvedValue({ tokenId: 3, rawToken: "fresh-token", createdAt: 1, expiresAt: 99 });
  mockDepositToLedger.mockResolvedValue(undefined);
  mockFundProvider.mockResolvedValue(undefined);
  mockAckWithReadback.mockResolvedValue(true);
  mockGetLedgerBalance.mockResolvedValue({ availableOg: 1, reservedOg: 0, totalOg: 1 });
  mockGetSubAccountBalance.mockResolvedValue({ lockedOg: 1 });
  mockIsProviderAcked.mockResolvedValue(true);
  mockGetBalance.mockResolvedValue(0n);

  if (opts.claudeConfigured) {
    mockLoadConfig.mockReturnValue({
      claude: {
        provider: opts.currentProvider,
        model: opts.currentModel,
        providerEndpoint: `https://${opts.currentModel}.old.example.com/v1`,
        proxyPort: 4101,
      },
    });
  } else {
    mockLoadConfig.mockReturnValue({});
  }

  if (opts.openclawConfigured) {
    mockLoadOpenclawConfig.mockReturnValue({
      models: {
        providers: {
          zg: {
            baseUrl: `https://${opts.currentModel}.old.example.com/v1`,
            apiKey: "old-key",
          },
        },
      },
    });
  } else {
    mockLoadOpenclawConfig.mockReturnValue(null);
  }
}

describe("fund parity: launcher handler vs CLI headless", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetCaptures();
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  });

  it("provider switch ends in identical canonical state", async () => {
    const handler = registeredHandlers.get("POST /api/fund/select-provider");
    const launcherRes = makeRes();

    setupScenario({ currentProvider: "0xAAA", currentModel: "model-a", claudeConfigured: true, openclawConfigured: true });
    await handler?.({} as IncomingMessage, launcherRes, makeParams({ provider: SERVICE_B.provider }));
    const launcherState = { compute: capturedComputeState, claude: capturedClaudeConfig, patches: [...capturedOpenclawPatches], cleared: { ...capturedClearedAuth } };

    resetCaptures();
    vi.clearAllMocks();

    setupScenario({ currentProvider: "0xAAA", currentModel: "model-a", claudeConfigured: true, openclawConfigured: true });
    await runHeadlessFund({ apply: true, provider: SERVICE_B.provider });
    const cliState = { compute: capturedComputeState, claude: capturedClaudeConfig, patches: [...capturedOpenclawPatches], cleared: { ...capturedClearedAuth } };

    expect(launcherRes._status).toBe(200);
    expect(launcherState).toEqual(cliState);

    const baseUrlPatch = cliState.patches.find((p) => p.path === "models.providers.zg.baseUrl");
    expect(baseUrlPatch?.value).toBe(SERVICE_B.url);
    const modelsPatch = cliState.patches.find((p) => p.path === "models.providers.zg.models");
    expect(modelsPatch?.value).toEqual([
      expect.objectContaining({
        id: "model-b",
        name: "model-b (0G Compute)",
        contextWindow: 128000,
        maxTokens: 8192,
      }),
    ]);
    const defaultModelPatch = cliState.patches.find((p) => p.path === "agents.defaults.model");
    expect(defaultModelPatch?.value).toEqual({ primary: "zg/model-b" });
    expect(cliState.cleared).toEqual({ claude: true, openclaw: true });
    expect((capturedWorkflow?.appliedActions as string[]) ?? []).toContain("select_provider");
  });

  it("API key flow rebinds Claude and OpenClaw identically", async () => {
    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const launcherRes = makeRes();

    setupScenario({ currentProvider: "0xBBB", currentModel: "model-b", claudeConfigured: true, openclawConfigured: true });
    await handler?.({} as IncomingMessage, launcherRes, makeParams({ tokenId: 3, saveClaudeToken: true }));
    const launcherState = {
      compute: capturedComputeState,
      claude: capturedClaudeConfig,
      patches: [...capturedOpenclawPatches],
      binding: capturedOpenclawBinding,
    };

    resetCaptures();
    vi.clearAllMocks();

    setupScenario({ currentProvider: "0xBBB", currentModel: "model-b", claudeConfigured: true, openclawConfigured: true });
    await runHeadlessFund({ apply: true, tokenId: "3", saveClaudeToken: true, emitSecrets: true });
    const cliState = {
      compute: capturedComputeState,
      claude: capturedClaudeConfig,
      patches: [...capturedOpenclawPatches],
      binding: capturedOpenclawBinding,
    };

    expect(launcherRes._status).toBe(200);
    expect(launcherState).toEqual(cliState);
    expect(cliState.binding).toEqual({ provider: "0xBBB", apiKey: "fresh-token" });
    expect((capturedWorkflow?.apiKey as Record<string, unknown>)?.storedForClaude).toBe(true);

    const modelsPatch = cliState.patches.find((p) => p.path === "models.providers.zg.models");
    expect(modelsPatch?.value).toEqual([
      expect.objectContaining({
        id: "model-b",
        name: "model-b (0G Compute)",
        contextWindow: 128000,
        maxTokens: 8192,
      }),
    ]);
    const defaultModelPatch = cliState.patches.find((p) => p.path === "agents.defaults.model");
    expect(defaultModelPatch?.value).toEqual({ primary: "zg/model-b" });
  });
});
