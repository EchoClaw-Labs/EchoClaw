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

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("../0g-compute/readiness.js", () => ({
  loadComputeState: mockLoadComputeState,
  saveComputeState: mockSaveComputeState,
}));

vi.mock("../config/store.js", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("../openclaw/config.js", () => ({
  loadOpenclawConfig: mockLoadOpenclawConfig,
  patchOpenclawConfig: mockPatchOpenclawConfig,
  removeOpenclawConfigKey: mockRemoveOpenclawConfigKey,
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: mockWriteAppEnvValue,
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ── Dynamic import after mocks ──────────────────────────────────────

const {
  resolvePreferredComputeSelection,
  persistComputeSelection,
  syncConfiguredRuntimes,
  clearAuthCredentials,
  checkAuthState,
} = await import("../commands/echo/compute-selection.js");

// ── Shared test data ────────────────────────────────────────────────

const SVC_A = { provider: "0xAAA", model: "model-a", serviceType: "chat", url: "https://a.example.com/v1", inputPrice: 100n, outputPrice: 200n };
const SVC_B = { provider: "0xBBB", model: "model-b", serviceType: "chat", url: "https://b.example.com/v1", inputPrice: 100n, outputPrice: 200n };
const SVC_C = { provider: "0xCCC", model: "model-c", serviceType: "chat", url: "https://c.example.com/v1", inputPrice: 100n, outputPrice: 200n };

function setupDefaults() {
  mockLoadComputeState.mockReturnValue(null);
  mockLoadConfig.mockReturnValue({});
  mockLoadOpenclawConfig.mockReturnValue(null);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("resolvePreferredComputeSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("returns null for empty services", () => {
    expect(resolvePreferredComputeSelection([])).toBeNull();
  });

  it("prefers compute-state when provider is live", () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });

    const result = resolvePreferredComputeSelection([SVC_A, SVC_B]);
    expect(result).toEqual({ provider: "0xAAA", model: "model-a", endpoint: SVC_A.url, source: "compute-state" });
  });

  it("skips compute-state when provider is dead, falls through to cfg.claude", () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xDEAD", model: "dead", configuredAt: 1 });
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xBBB", model: "model-b", providerEndpoint: "http://x", proxyPort: 4101 } });

    const result = resolvePreferredComputeSelection([SVC_A, SVC_B]);
    expect(result).toEqual({ provider: "0xBBB", model: "model-b", endpoint: SVC_B.url, source: "claude-config" });
  });

  it("uses cfg.claude when compute-state is null", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "http://x", proxyPort: 4101 } });

    const result = resolvePreferredComputeSelection([SVC_A, SVC_B]);
    expect(result).toEqual({ provider: "0xAAA", model: "model-a", endpoint: SVC_A.url, source: "claude-config" });
  });

  it("uses OpenClaw baseUrl match when compute-state and claude are empty", () => {
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://b.example.com/v1" } } },
    });

    const result = resolvePreferredComputeSelection([SVC_A, SVC_B]);
    expect(result).toEqual({ provider: "0xBBB", model: "model-b", endpoint: SVC_B.url, source: "openclaw-config" });
  });

  it("falls back to first service when nothing matches", () => {
    const result = resolvePreferredComputeSelection([SVC_C, SVC_A]);
    expect(result).toEqual({ provider: "0xCCC", model: "model-c", endpoint: SVC_C.url, source: "live-fallback" });
  });

  it("compute-state wins over cfg.claude when both match different live services", () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xAAA", model: "model-a", configuredAt: 1 });
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xBBB", model: "model-b", providerEndpoint: "http://x", proxyPort: 4101 } });

    const result = resolvePreferredComputeSelection([SVC_A, SVC_B]);
    expect(result!.source).toBe("compute-state");
    expect(result!.provider).toBe("0xAAA");
  });

  it("matches providers case-insensitively", () => {
    mockLoadComputeState.mockReturnValue({ activeProvider: "0xaaa", model: "model-a", configuredAt: 1 });

    const result = resolvePreferredComputeSelection([SVC_A]);
    expect(result).toEqual({ provider: "0xAAA", model: "model-a", endpoint: SVC_A.url, source: "compute-state" });
  });

  it("OpenClaw baseUrl match normalises trailing slashes", () => {
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1/" } } },
    });

    const result = resolvePreferredComputeSelection([SVC_A]);
    expect(result!.source).toBe("openclaw-config");
    expect(result!.provider).toBe("0xAAA");
  });
});

describe("persistComputeSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls saveComputeState with correct shape", () => {
    persistComputeSelection("0xAAA", "model-a");

    expect(mockSaveComputeState).toHaveBeenCalledWith({
      activeProvider: "0xAAA",
      model: "model-a",
      configuredAt: expect.any(Number),
    });
  });
});

describe("syncConfiguredRuntimes", () => {
  const selection = { provider: "0xAAA", model: "model-a", endpoint: "https://a.example.com/v1", source: "compute-state" as const };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("updates cfg.claude when it exists", () => {
    const cfgObj = { claude: { provider: "0xOLD", model: "old", providerEndpoint: "http://old", proxyPort: 4101 } };
    mockLoadConfig.mockReturnValue(cfgObj);

    syncConfiguredRuntimes(selection);

    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      claude: { provider: "0xAAA", model: "model-a", providerEndpoint: "https://a.example.com/v1", proxyPort: 4101 },
    }));
  });

  it("does not create cfg.claude when it does not exist", () => {
    mockLoadConfig.mockReturnValue({});

    syncConfiguredRuntimes(selection);

    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it("patches OpenClaw config when it exists", () => {
    mockLoadOpenclawConfig.mockReturnValue({ models: { providers: { zg: {} } } });

    syncConfiguredRuntimes(selection);

    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("models.providers.zg.baseUrl", "https://a.example.com/v1", { force: true });
    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("models.providers.zg.models", expect.any(Array), { force: true });
    expect(mockPatchOpenclawConfig).toHaveBeenCalledWith("agents.defaults.model", { primary: "zg/model-a" }, { force: true });
  });

  it("does not patch OpenClaw when config is null", () => {
    mockLoadOpenclawConfig.mockReturnValue(null);

    syncConfiguredRuntimes(selection);

    expect(mockPatchOpenclawConfig).not.toHaveBeenCalled();
  });

  it("skips Claude when skipClaude is true", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xOLD", model: "old", providerEndpoint: "http://old", proxyPort: 4101 } });
    mockLoadOpenclawConfig.mockReturnValue({ models: {} });

    syncConfiguredRuntimes(selection, { skipClaude: true });

    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(mockPatchOpenclawConfig).toHaveBeenCalled();
  });

  it("skips OpenClaw when skipOpenclaw is true", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xOLD", model: "old", providerEndpoint: "http://old", proxyPort: 4101 } });
    mockLoadOpenclawConfig.mockReturnValue({ models: {} });

    syncConfiguredRuntimes(selection, { skipOpenclaw: true });

    expect(mockSaveConfig).toHaveBeenCalled();
    expect(mockPatchOpenclawConfig).not.toHaveBeenCalled();
  });
});

describe("clearAuthCredentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears Claude auth token from env file and process.env", () => {
    process.env.ZG_CLAUDE_AUTH_TOKEN = "old-token";

    clearAuthCredentials();

    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "");
    expect(process.env.ZG_CLAUDE_AUTH_TOKEN).toBeUndefined();
  });

  it("removes OpenClaw apiKey", () => {
    clearAuthCredentials();

    expect(mockRemoveOpenclawConfigKey).toHaveBeenCalledWith("models.providers.zg.apiKey");
  });

  it("can clear only Claude auth", () => {
    process.env.ZG_CLAUDE_AUTH_TOKEN = "old-token";

    clearAuthCredentials({ claude: true });

    expect(mockWriteAppEnvValue).toHaveBeenCalledWith("ZG_CLAUDE_AUTH_TOKEN", "");
    expect(mockRemoveOpenclawConfigKey).not.toHaveBeenCalled();
    expect(process.env.ZG_CLAUDE_AUTH_TOKEN).toBeUndefined();
  });

  it("can clear only OpenClaw auth", () => {
    process.env.ZG_CLAUDE_AUTH_TOKEN = "old-token";

    clearAuthCredentials({ openclaw: true });

    expect(mockWriteAppEnvValue).not.toHaveBeenCalled();
    expect(mockRemoveOpenclawConfigKey).toHaveBeenCalledWith("models.providers.zg.apiKey");
    expect(process.env.ZG_CLAUDE_AUTH_TOKEN).toBe("old-token");
  });
});

describe("checkAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    delete process.env.ZG_CLAUDE_AUTH_TOKEN;
  });

  it("no runtimes configured -> no rotation needed", () => {
    mockLoadConfig.mockReturnValue({});
    mockLoadOpenclawConfig.mockReturnValue(null);

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(false);
    expect(state.selectionWarning).toBeNull();
    expect(state.runtimes.claude.configured).toBe(false);
    expect(state.runtimes.openclaw.configured).toBe(false);
  });

  it("Claude configured + token present + provider matches -> no rotation", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "m", providerEndpoint: "http://x", proxyPort: 4101 } });
    process.env.ZG_CLAUDE_AUTH_TOKEN = "valid-token";

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(false);
    expect(state.runtimes.claude).toEqual({ configured: true, hasAuth: true, providerMatch: true });
  });

  it("Claude configured + no token -> rotation needed", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "m", providerEndpoint: "http://x", proxyPort: 4101 } });

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(true);
    expect(state.selectionWarning).toContain("Claude Code");
    expect(state.runtimes.claude.hasAuth).toBe(false);
  });

  it("Claude configured + token present + provider mismatch -> rotation needed", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xBBB", model: "m", providerEndpoint: "http://x", proxyPort: 4101 } });
    process.env.ZG_CLAUDE_AUTH_TOKEN = "valid-token";

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(true);
    expect(state.runtimes.claude.providerMatch).toBe(false);
  });

  it("OpenClaw configured + apiKey present + endpoint matches -> no rotation", () => {
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1", apiKey: "key123" } } },
    });

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(false);
    expect(state.runtimes.openclaw).toEqual({ configured: true, hasAuth: true, providerMatch: true });
  });

  it("OpenClaw configured + no apiKey -> rotation needed", () => {
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1" } } },
    });

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(true);
    expect(state.selectionWarning).toContain("OpenClaw");
  });

  it("OpenClaw configured + apiKey present + endpoint mismatch -> rotation needed", () => {
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://old.example.com/v1", apiKey: "key123" } } },
    });

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(true);
    expect(state.runtimes.openclaw.providerMatch).toBe(false);
  });

  it("both runtimes stale -> warning lists both", () => {
    mockLoadConfig.mockReturnValue({ claude: { provider: "0xAAA", model: "m", providerEndpoint: "http://x", proxyPort: 4101 } });
    mockLoadOpenclawConfig.mockReturnValue({
      models: { providers: { zg: { baseUrl: "https://a.example.com/v1" } } },
    });

    const state = checkAuthState("0xAAA", "https://a.example.com/v1");

    expect(state.requiresApiKeyRotation).toBe(true);
    expect(state.selectionWarning).toContain("Claude Code");
    expect(state.selectionWarning).toContain("OpenClaw");
  });
});
