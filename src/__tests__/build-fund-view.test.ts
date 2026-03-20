import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock factories ──────────────────────────────────────────

const mockGetAuthenticatedBroker = vi.fn();
const mockResetAuthenticatedBroker = vi.fn();
const mockGetSubAccountBalance = vi.fn();
const mockIsProviderAcked = vi.fn();
const mockListChatServices = vi.fn();
const mockGetLedgerBalance = vi.fn();
const mockGetMonitorPid = vi.fn();
const mockIsMonitorTrackingProvider = vi.fn();
const mockCalculateProviderPricing = vi.fn();
const mockFormatPricePerMTokens = vi.fn();
const mockLoadComputeState = vi.fn();
const mockGetPublicClient = vi.fn();
const mockRequireWalletAndKeystore = vi.fn();
const mockLoadConfig = vi.fn();
const mockCheckAuthState = vi.fn();
const mockResolvePreferredComputeSelection = vi.fn();

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: mockGetAuthenticatedBroker,
  resetAuthenticatedBroker: mockResetAuthenticatedBroker,
}));

vi.mock("../0g-compute/operations.js", () => ({
  getSubAccountBalance: mockGetSubAccountBalance,
  isProviderAcked: mockIsProviderAcked,
  listChatServices: mockListChatServices,
  getLedgerBalance: mockGetLedgerBalance,
  createApiKey: vi.fn(),
  depositToLedger: vi.fn(),
  fundProvider: vi.fn(),
  ackWithReadback: vi.fn(),
}));

vi.mock("../0g-compute/monitor-lifecycle.js", () => ({
  getMonitorPid: mockGetMonitorPid,
  isMonitorTrackingProvider: mockIsMonitorTrackingProvider,
  stopMonitorDaemon: vi.fn(),
}));

vi.mock("../0g-compute/pricing.js", () => ({
  calculateProviderPricing: mockCalculateProviderPricing,
  formatPricePerMTokens: mockFormatPricePerMTokens,
}));

vi.mock("../0g-compute/readiness.js", () => ({
  loadComputeState: mockLoadComputeState,
  saveComputeState: vi.fn(),
}));

vi.mock("../wallet/client.js", () => ({
  getPublicClient: mockGetPublicClient,
}));

vi.mock("../bot/executor.js", () => ({
  requireWalletAndKeystore: mockRequireWalletAndKeystore,
}));

vi.mock("../config/store.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../utils/ui.js", () => ({
  successBox: vi.fn(),
  warnBox: vi.fn(),
  infoBox: vi.fn(),
  colors: {
    address: (v: string) => v,
    muted: (v: string) => v,
    success: (v: string) => v,
    warn: (v: string) => v,
  },
}));

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: vi.fn(),
}));

vi.mock("../utils/daemon-spawn.js", () => ({
  spawnDetached: vi.fn(),
}));

vi.mock("../commands/echo/fund-assessment.js", () => ({
  buildFundPayload: vi.fn(),
}));

vi.mock("../commands/echo/protocol.js", () => ({
  writeEchoWorkflow: vi.fn(),
}));

vi.mock("../commands/echo/catalog.js", () => ({
  PROVIDER_LABELS: {
    openclaw: "EchoClaw Agent",
    "claude-code": "Claude Code",
    codex: "Codex",
    other: "Other",
  },
}));

vi.mock("../commands/echo/compute-selection.js", () => ({
  checkAuthState: mockCheckAuthState,
  resolvePreferredComputeSelection: mockResolvePreferredComputeSelection,
}));

vi.mock("../0g-compute/constants.js", () => ({
  ZG_COMPUTE_DIR: "/tmp/zg-test",
  ZG_MONITOR_LOG_FILE: "/tmp/zg-test/monitor.log",
}));

vi.mock("../errors.js", () => ({
  EchoError: class extends Error { constructor(public code: string, msg: string) { super(msg); } },
  ErrorCodes: {},
}));

// ── Dynamic import after mocks ──────────────────────────────────────

const { buildFundView, readProviderSelection } = await import("../commands/echo/fund.js");

// ── Shared defaults ─────────────────────────────────────────────────

const DUMMY_BROKER = { fake: "broker" };
const PROVIDER_ADDR = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
const SERVICE = {
  provider: PROVIDER_ADDR,
  model: "test-model",
  inputPrice: 100n,
  outputPrice: 200n,
  url: "https://test-provider.example.com/v1",
};

function setupDefaults() {
  mockGetAuthenticatedBroker.mockResolvedValue(DUMMY_BROKER);
  mockGetLedgerBalance.mockResolvedValue({ availableOg: 5, reservedOg: 0, totalOg: 5 });
  mockListChatServices.mockResolvedValue([SERVICE]);
  mockGetMonitorPid.mockReturnValue(null);
  mockIsMonitorTrackingProvider.mockReturnValue(false);
  mockCalculateProviderPricing.mockReturnValue({ recommendedMinLockedOg: 1.0 });
  mockFormatPricePerMTokens.mockReturnValue("0.100");
  mockLoadComputeState.mockReturnValue(null);
  mockLoadConfig.mockReturnValue({});
  mockCheckAuthState.mockReturnValue({ requiresApiKeyRotation: false, selectionWarning: null });
  mockResolvePreferredComputeSelection.mockReturnValue({ provider: PROVIDER_ADDR, model: "test-model", endpoint: SERVICE.url, source: "live-fallback" });
  mockGetPublicClient.mockReturnValue({
    getBalance: vi.fn().mockResolvedValue(0n),
  });
  mockRequireWalletAndKeystore.mockReturnValue({ address: "0x0000000000000000000000000000000000000001" });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("buildFundView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("provider selected + no sub-account -> isProviderAcked NOT called, acknowledged === null, subAccountExists === false", async () => {
    mockGetSubAccountBalance.mockResolvedValue(null);

    const view = await buildFundView({ provider: PROVIDER_ADDR });

    expect(mockGetSubAccountBalance).toHaveBeenCalledWith(DUMMY_BROKER, PROVIDER_ADDR);
    expect(mockIsProviderAcked).not.toHaveBeenCalled();
    expect(view.acknowledged).toBeNull();
    expect(view.subAccountExists).toBe(false);
  });

  it("provider selected + sub-account exists + not ACKed -> acknowledged === false, subAccountExists === true", async () => {
    mockGetSubAccountBalance.mockResolvedValue({ lockedOg: 1.5, pendingRefundOg: 0 });
    mockIsProviderAcked.mockResolvedValue(false);

    const view = await buildFundView({ provider: PROVIDER_ADDR });

    expect(mockIsProviderAcked).toHaveBeenCalledWith(DUMMY_BROKER, PROVIDER_ADDR);
    expect(view.acknowledged).toBe(false);
    expect(view.subAccountExists).toBe(true);
    expect(view.currentLockedOg).toBe(1.5);
  });

  it("provider selected + sub-account exists + ACKed -> acknowledged === true, subAccountExists === true", async () => {
    mockGetSubAccountBalance.mockResolvedValue({ lockedOg: 2.0, pendingRefundOg: 0 });
    mockIsProviderAcked.mockResolvedValue(true);

    const view = await buildFundView({ provider: PROVIDER_ADDR });

    expect(mockIsProviderAcked).toHaveBeenCalledWith(DUMMY_BROKER, PROVIDER_ADDR);
    expect(view.acknowledged).toBe(true);
    expect(view.subAccountExists).toBe(true);
  });

  it("no provider available -> getSubAccountBalance and isProviderAcked NOT called", async () => {
    mockListChatServices.mockResolvedValue([]);

    const view = await buildFundView({});

    expect(mockGetSubAccountBalance).not.toHaveBeenCalled();
    expect(mockIsProviderAcked).not.toHaveBeenCalled();
    expect(view.provider).toBeNull();
    expect(view.subAccountExists).toBe(false);
    expect(view.acknowledged).toBeNull();
  });

  it("returns requiresApiKeyRotation and selectionWarning from checkAuthState", async () => {
    mockGetSubAccountBalance.mockResolvedValue(null);
    mockCheckAuthState.mockReturnValue({
      requiresApiKeyRotation: true,
      selectionWarning: "Create a new API key — Claude Code needs a valid key for this provider.",
    });

    const view = await buildFundView({ provider: PROVIDER_ADDR });

    expect(view.requiresApiKeyRotation).toBe(true);
    expect(view.selectionWarning).toBe("Create a new API key — Claude Code needs a valid key for this provider.");
    expect(mockCheckAuthState).toHaveBeenCalledWith(PROVIDER_ADDR, expect.any(String));
  });

  it("no provider -> requiresApiKeyRotation false and selectionWarning null", async () => {
    mockListChatServices.mockResolvedValue([]);

    const view = await buildFundView({});

    expect(view.requiresApiKeyRotation).toBe(false);
    expect(view.selectionWarning).toBeNull();
    expect(mockCheckAuthState).not.toHaveBeenCalled();
  });

  it("no explicit provider -> uses resolvePreferredComputeSelection", async () => {
    mockGetSubAccountBalance.mockResolvedValue(null);

    const view = await buildFundView({});

    expect(mockResolvePreferredComputeSelection).toHaveBeenCalledWith([SERVICE]);
    expect(view.provider).toBe(PROVIDER_ADDR);
  });

  it("explicit provider matching live service -> resolver NOT called", async () => {
    mockGetSubAccountBalance.mockResolvedValue(null);

    const view = await buildFundView({ provider: PROVIDER_ADDR });

    expect(mockResolvePreferredComputeSelection).not.toHaveBeenCalled();
    expect(view.provider).toBe(PROVIDER_ADDR);
  });

  it("explicit provider NOT matching any service -> falls through to resolver", async () => {
    mockGetSubAccountBalance.mockResolvedValue(null);
    mockResolvePreferredComputeSelection.mockReturnValue({ provider: PROVIDER_ADDR, model: "test-model", endpoint: SERVICE.url, source: "compute-state" });

    const view = await buildFundView({ provider: "0xDEAD" });

    expect(mockResolvePreferredComputeSelection).toHaveBeenCalledWith([SERVICE]);
    expect(view.provider).toBe(PROVIDER_ADDR);
  });

  it("resolver returns second service when compute-state points to it", async () => {
    const SVC_B = { provider: "0xBBB", model: "model-b", inputPrice: 50n, outputPrice: 100n, url: "https://b.example.com/v1" };
    mockListChatServices.mockResolvedValue([SERVICE, SVC_B]);
    mockGetSubAccountBalance.mockResolvedValue(null);
    mockResolvePreferredComputeSelection.mockReturnValue({ provider: "0xBBB", model: "model-b", endpoint: SVC_B.url, source: "compute-state" });

    const view = await buildFundView({});

    expect(view.provider).toBe("0xBBB");
    expect(view.model).toBe("model-b");
  });
});

describe("readProviderSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("prefers compute-state over cfg.claude", () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "m1", configuredAt: 1 });
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xBBB", model: "m2", providerEndpoint: "http://x", proxyPort: 4101 } });

    expect(readProviderSelection()).toBe("0xAAA");
  });

  it("falls back to cfg.claude when compute-state is null", () => {
    mockLoadComputeState.mockReturnValue(null);
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xBBB", model: "m2", providerEndpoint: "http://x", proxyPort: 4101 } });

    expect(readProviderSelection()).toBe("0xBBB");
  });

  it("returns null when neither source has a provider", () => {
    mockLoadComputeState.mockReturnValue(null);
    mockLoadConfig.mockReturnValue({});

    expect(readProviderSelection()).toBeNull();
  });
});
