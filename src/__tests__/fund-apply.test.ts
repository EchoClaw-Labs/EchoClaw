import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock factories ──────────────────────────────────────────

const mockLoadComputeState = vi.fn();
const mockSaveComputeState = vi.fn();
const mockLoadConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockLoadOpenclawConfig = vi.fn();
const mockPatchOpenclawConfig = vi.fn();
const mockRemoveOpenclawConfigKey = vi.fn();
const mockWriteAppEnvValue = vi.fn();
const mockCreateApiKey = vi.fn();
const mockConfigureOpenclawProvider = vi.fn();
const mockListChatServices = vi.fn();
const mockGetAuthenticatedBroker = vi.fn();

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../0g-compute/readiness.js", () => ({
  loadComputeState: (...args: any[]) => mockLoadComputeState(...args),
  saveComputeState: (...args: any[]) => mockSaveComputeState(...args),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: (...args: any[]) => mockLoadConfig(...args),
  saveConfig: (...args: any[]) => {
    mockSaveConfig(...args);
    // Reflect saved config in subsequent loadConfig calls
    if (args[0]) mockLoadConfig.mockReturnValue(args[0]);
  },
}));

vi.mock("../openclaw/config.js", () => ({
  loadOpenclawConfig: (...args: any[]) => mockLoadOpenclawConfig(...args),
  patchOpenclawConfig: (...args: any[]) => mockPatchOpenclawConfig(...args),
  removeOpenclawConfigKey: (...args: any[]) => mockRemoveOpenclawConfigKey(...args),
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: (...args: any[]) => mockWriteAppEnvValue(...args),
}));

vi.mock("../0g-compute/operations.js", () => ({
  createApiKey: (...args: any[]) => mockCreateApiKey(...args),
  configureOpenclawProvider: (...args: any[]) => mockConfigureOpenclawProvider(...args),
  listChatServices: (...args: any[]) => mockListChatServices(...args),
}));

vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: (...args: any[]) => mockGetAuthenticatedBroker(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ── Dynamic import after mocks ──────────────────────────────────────

const {
  selectFundProvider,
  createCanonicalApiKey,
  createCanonicalApiKeyFromServices,
} = await import("../commands/echo/fund-apply.js");

const { EchoError, ErrorCodes } = await import("../errors.js");

// ── Shared test data ────────────────────────────────────────────────

const SVC_A = { provider: "0xAAA", model: "model-a", serviceType: "chatbot", url: "https://a.example.com/v1", inputPrice: 100n, outputPrice: 200n };
const SVC_B = { provider: "0xBBB", model: "model-b", serviceType: "chatbot", url: "https://b.example.com/v1", inputPrice: 100n, outputPrice: 200n };
const BROKER = { id: "test-broker" };

function setupDefaults() {
  mockLoadComputeState.mockReturnValue(null);
  mockLoadConfig.mockReturnValue({});
  mockLoadOpenclawConfig.mockReturnValue(null);
  mockGetAuthenticatedBroker.mockResolvedValue(BROKER);
  mockListChatServices.mockResolvedValue([SVC_A, SVC_B]);
  mockCreateApiKey.mockResolvedValue({ tokenId: 0, rawToken: "raw-token-abc", createdAt: 1, expiresAt: 99 });
  mockConfigureOpenclawProvider.mockResolvedValue({ providerPatch: {}, modePatch: {} });
}

// ── selectFundProvider ──────────────────────────────────────────────

describe("selectFundProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  });

  it("persists selection and syncs runtimes for a live provider", async () => {
    const result = await selectFundProvider("0xAAA", [SVC_A, SVC_B]);

    expect(result.selection.provider).toBe("0xAAA");
    expect(result.selection.model).toBe("model-a");
    expect(result.selection.endpoint).toBe(SVC_A.url);
    expect(mockSaveComputeState).toHaveBeenCalledWith(expect.objectContaining({
      activeProvider: "0xAAA",
      model: "model-a",
    }));
  });

  it("clears all auth when provider changes", async () => {
    // Current selection is SVC_A
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });

    const result = await selectFundProvider("0xBBB", [SVC_A, SVC_B]);

    expect(result.wasProviderChanged).toBe(true);
    // clearAuthCredentials() called with no args → clears both
    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "");
    expect(mockRemoveOpenclawConfigKey).toHaveBeenCalledWith("models.providers.zg.apiKey");
  });

  it("does not clear healthy auth on same-provider reselection", async () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });
    // Claude has valid auth
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "http://x", proxyPort: 4101 } });
    process.env.ZG_CLAUDE_AUTH_TOKEN = "valid-token";
    // OpenClaw has valid auth
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1", apiKey: "key123" } } },
    });

    const result = await selectFundProvider("0xAAA", [SVC_A, SVC_B]);

    expect(result.wasProviderChanged).toBe(false);
    expect(mockWriteAppEnvValue).not.toHaveBeenCalled();
    expect(mockRemoveOpenclawConfigKey).not.toHaveBeenCalled();
  });

  it("selectively clears stale auth on same-provider reselection", async () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });
    // Claude configured but NO token
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "http://x", proxyPort: 4101 } });
    // OpenClaw has valid auth
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1", apiKey: "key123" } } },
    });

    await selectFundProvider("0xAAA", [SVC_A, SVC_B]);

    // Only Claude should be cleared (no token)
    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "");
    expect(mockRemoveOpenclawConfigKey).not.toHaveBeenCalled();
  });

  it("throws EchoError when provider is not live", async () => {
    await expect(selectFundProvider("0xDEAD", [SVC_A, SVC_B]))
      .rejects.toThrow(EchoError);

    await expect(selectFundProvider("0xDEAD", [SVC_A, SVC_B]))
      .rejects.toMatchObject({ code: ErrorCodes.ZG_PROVIDER_NOT_FOUND });
  });

  it("throws EchoError when services list is empty", async () => {
    await expect(selectFundProvider("0xAAA", []))
      .rejects.toThrow(EchoError);
  });

  it("fetches services from broker when not provided", async () => {
    await selectFundProvider("0xAAA");

    expect(mockGetAuthenticatedBroker).toHaveBeenCalled();
    expect(mockListChatServices).toHaveBeenCalledWith(BROKER);
  });

  it("syncs Claude config when it exists", async () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xOLD", model: "old", providerEndpoint: "http://old", proxyPort: 4101 } });

    await selectFundProvider("0xAAA", [SVC_A]);

    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      claude: expect.objectContaining({ provider: "0xAAA", model: "model-a" }),
    }));
  });

  it("syncs OpenClaw config when it exists", async () => {
    mockLoadOpenclawConfig.mockReturnValue({ models: { providers: { zg: {} } } });

    await selectFundProvider("0xAAA", [SVC_A]);

    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("models.providers.zg.baseUrl", SVC_A.url, { force: true });
    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("models.providers.zg.models", expect.any(Array), { force: true });
    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("agents.defaults.model", { primary: "zg/model-a" }, { force: true });
  });

  it("returns correct authState in result", async () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "http://x", proxyPort: 4101 } });
    // No token → requires rotation
    const result = await selectFundProvider("0xAAA", [SVC_A]);

    expect(result.authState.requiresApiKeyRotation).toBe(true);
    expect(result.authState.runtimes.claude.hasAuth).toBe(false);
  });
});

// ── createCanonicalApiKey ───────────────────────────────────────────

describe("createCanonicalApiKey", () => {
  const SELECTION = {
    provider: "0xAAA",
    model: "model-a",
    endpoint: "https://a.example.com/v1",
    source: "compute-state" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  });

  it("creates key, persists selection, and syncs runtimes", async () => {
    const result = await createCanonicalApiKey({ broker: BROKER as any, selection: SELECTION });

    expect(mockCreateApiKey).toHaveBeenCalledWith(BROKER, "0xAAA", 0);
    expect(mockSaveComputeState).toHaveBeenCalledWith(expect.objectContaining({
      activeProvider: "0xAAA",
      model: "model-a",
    }));
    expect(result.apiKey.rawToken).toBe("raw-token-abc");
    expect(result.selection).toEqual(SELECTION);
    expect(result.warnings).toEqual([]);
  });

  it("saves Claude token when saveClaudeToken is true and provider matches", async () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "http://x", proxyPort: 4101 } });

    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION, saveClaudeToken: true,
    });

    expect(result.claudeTokenSaved).toBe(true);
    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "raw-token-abc");
    expect(process.env.ZG_CLAUDE_AUTH_TOKEN).toBe("raw-token-abc");
  });

  it("initializes config.claude and saves token when no Claude config exists", async () => {
    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION, saveClaudeToken: true,
    });

    // config.claude should have been created from selection, then token saved
    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      claude: expect.objectContaining({
        provider: "0xAAA",
        model: "model-a",
        providerEndpoint: "https://a.example.com/v1",
      }),
    }));
    expect(result.claudeTokenSaved).toBe(true);
    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "raw-token-abc");
  });

  it("patches OpenClaw when patchOpenclaw is true", async () => {
    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION, patchOpenclaw: true,
    });

    expect(result.openclawPatched).toBe(true);
    expect(mockConfigureOpenclawProvider).toHaveBeenCalledWith(BROKER, "0xAAA", "raw-token-abc");
  });

  it("does not patch OpenClaw when patchOpenclaw is false", async () => {
    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION,
    });

    expect(result.openclawPatched).toBe(false);
    expect(mockConfigureOpenclawProvider).not.toHaveBeenCalled();
  });

  it("auto-patches OpenClaw when config already exists", async () => {
    mockLoadOpenclawConfig.mockReturnValue({ models: { providers: { zg: { baseUrl: "https://old.example.com/v1" } } } });

    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION,
    });

    expect(result.openclawPatched).toBe(true);
    expect(mockConfigureOpenclawProvider).toHaveBeenCalledWith(BROKER, "0xAAA", "raw-token-abc");
    expect(result.warnings).toEqual([]);
  });

  it("returns warning instead of throwing when OpenClaw patch fails after key creation", async () => {
    mockLoadOpenclawConfig.mockReturnValue({ models: { providers: { zg: { baseUrl: "https://old.example.com/v1" } } } });
    mockConfigureOpenclawProvider.mockRejectedValueOnce(new Error("openclaw write failed"));

    const result = await createCanonicalApiKey({
      broker: BROKER as any, selection: SELECTION,
    });

    expect(result.apiKey.rawToken).toBe("raw-token-abc");
    expect(result.openclawPatched).toBe(false);
    expect(result.warnings).toEqual([
      expect.stringContaining("OpenClaw config patch failed"),
    ]);
  });

  it("propagates createApiKey error without partial persist", async () => {
    mockCreateApiKey.mockRejectedValue(new Error("on-chain failure"));

    await expect(createCanonicalApiKey({ broker: BROKER as any, selection: SELECTION }))
      .rejects.toThrow("on-chain failure");

    // No persist or sync should have happened
    expect(mockSaveComputeState).not.toHaveBeenCalled();
  });

  it("uses provided tokenId", async () => {
    await createCanonicalApiKey({ broker: BROKER as any, selection: SELECTION, tokenId: 42 });

    expect(mockCreateApiKey).toHaveBeenCalledWith(BROKER, "0xAAA", 42);
  });
});

// ── createCanonicalApiKeyFromServices ───────────────────────────────

describe("createCanonicalApiKeyFromServices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("resolves selection from services and delegates to createCanonicalApiKey", async () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });

    const result = await createCanonicalApiKeyFromServices({
      broker: BROKER as any,
      services: [SVC_A, SVC_B],
      tokenId: 5,
    });

    expect(result.selection.provider).toBe("0xAAA");
    expect(mockCreateApiKey).toHaveBeenCalledWith(BROKER, "0xAAA", 5);
  });

  it("throws EchoError when no live providers", async () => {
    await expect(createCanonicalApiKeyFromServices({
      broker: BROKER as any,
      services: [],
    })).rejects.toThrow(EchoError);
  });

  it("fetches services from broker when not provided", async () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });

    await createCanonicalApiKeyFromServices({ broker: BROKER as any });

    expect(mockListChatServices).toHaveBeenCalledWith(BROKER);
  });
});
