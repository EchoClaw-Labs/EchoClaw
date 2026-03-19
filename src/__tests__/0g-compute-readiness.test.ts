import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// ── Mock modules ────────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("../bot/executor.js", () => ({
  requireWalletAndKeystore: vi.fn(),
}));

vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: vi.fn(),
}));

vi.mock("../0g-compute/bridge.js", () => ({
  withSuppressedConsole: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../openclaw/config.js", () => ({
  loadOpenclawConfig: vi.fn(),
  patchOpenclawConfig: vi.fn(() => ({ status: "created", path: "/test", keysSet: [], keysSkipped: [] })),
}));

vi.mock("../0g-compute/constants.js", () => ({
  ZG_COMPUTE_DIR: "/tmp/test-echoclaw-0g-compute",
  ZG_COMPUTE_STATE_FILE: "/tmp/test-echoclaw-0g-compute/compute-state.json",
  ZG_MONITOR_STATE_FILE: "/tmp/test-echoclaw-0g-compute/monitor-state.json",
  ZG_MONITOR_PID_FILE: "/tmp/test-echoclaw-0g-compute/monitor.pid",
}));

vi.mock("../utils/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { checkComputeReadiness } from "../0g-compute/readiness.js";
import { requireWalletAndKeystore } from "../bot/executor.js";
import { getAuthenticatedBroker } from "../0g-compute/broker-factory.js";
import { loadOpenclawConfig } from "../openclaw/config.js";

// ── Helpers ─────────────────────────────────────────────────────────

const mockWallet = requireWalletAndKeystore as ReturnType<typeof vi.fn>;
const mockBroker = getAuthenticatedBroker as ReturnType<typeof vi.fn>;
const mockConfig = loadOpenclawConfig as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

const TEST_PROVIDER = "0x1234567890abcdef1234567890abcdef12345678";

function makeBroker(overrides: {
  ledger?: boolean;
  subAccount?: { balance: bigint; pendingRefund: bigint } | null;
  acked?: boolean;
  services?: Array<{ provider: string; inputPrice: bigint; outputPrice: bigint }>;
  serviceMetadata?: { endpoint?: string; model?: string };
} = {}) {
  return {
    ledger: {
      getLedger: overrides.ledger === false
        ? () => { throw new Error("no ledger"); }
        : () => ({}),
      getLedgerWithDetail: () => ({ infers: [] }),
    },
    inference: {
      getAccount: overrides.subAccount === null
        ? () => { throw new Error("no account"); }
        : () => ({
            balance: overrides.subAccount?.balance ?? 5_000000000000000000n,
            pendingRefund: overrides.subAccount?.pendingRefund ?? 0n,
          }),
      acknowledged: () => overrides.acked ?? true,
      listServiceWithDetail: () => overrides.services ?? [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
        serviceType: "chatbot",
      }],
      getServiceMetadata: () => overrides.serviceMetadata ?? {
        endpoint: "https://provider.example.com",
        model: "test-model",
      },
    },
  };
}

function setupComputeState(provider = TEST_PROVIDER): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify({
    activeProvider: provider,
    model: "test-model",
    configuredAt: Date.now(),
  }));
}

function makeOpenclawConfig(hasZg = true) {
  if (!hasZg) return {};
  return {
    models: {
      providers: {
        zg: {
          baseUrl: "https://provider.example.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [{ id: "test-model", name: "Test Model" }],
        },
      },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("checkComputeReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: compute-state.json not found
    mockExistsSync.mockReturnValue(false);
  });

  it("should fail when wallet is not configured", async () => {
    mockWallet.mockImplementation(() => { throw new Error("No wallet"); });

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.wallet.ok).toBe(false);
    expect(result.checks.wallet.detail).toContain("No wallet");
  });

  it("should fail when broker init fails", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockRejectedValue(new Error("RPC unreachable"));

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.wallet.ok).toBe(true);
    expect(result.checks.broker.ok).toBe(false);
    expect(result.checks.broker.detail).toContain("RPC unreachable");
  });

  it("should fail when no ledger exists", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({ ledger: false }));

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.wallet.ok).toBe(true);
    expect(result.checks.broker.ok).toBe(true);
    expect(result.checks.ledger.ok).toBe(false);
  });

  it("should fail when sub-account balance is below threshold", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      subAccount: {
        balance: 100000000000000000n, // 0.1 0G — below 1.0 minimum
        pendingRefund: 0n,
      },
      services: [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
      }],
    }));
    setupComputeState();

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.subAccount.ok).toBe(false);
  });

  it("should fail when ACK is false", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({ acked: false }));
    setupComputeState();
    mockConfig.mockReturnValue(makeOpenclawConfig());

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.ack.ok).toBe(false);
  });

  it("should fail when OpenClaw config is missing zg provider", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker());
    setupComputeState();
    mockConfig.mockReturnValue(makeOpenclawConfig(false));

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.openclawConfig.ok).toBe(false);
  });

  it("should return ready=true when all checks pass", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      services: [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
      }],
    }));
    setupComputeState();
    mockConfig.mockReturnValue(makeOpenclawConfig());

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.provider).toBe(TEST_PROVIDER);
    expect(Object.values(result.checks).every(c => c.ok)).toBe(true);
  });

  it("should recover provider from sub-account scan when no compute-state.json", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });

    const brokerInstance = makeBroker();
    // Override getLedgerWithDetail to return a sub-account with balance
    brokerInstance.ledger.getLedgerWithDetail = () => ({
      infers: [[TEST_PROVIDER, 5_000000000000000000n, 0n]],
    });
    mockBroker.mockResolvedValue(brokerInstance);
    mockConfig.mockReturnValue(makeOpenclawConfig());
    // existsSync returns false → no compute-state.json
    mockExistsSync.mockReturnValue(false);

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.provider).toBe(TEST_PROVIDER);
  });

  it("should recover provider from OpenClaw config baseUrl when no compute-state and no ledger detail", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });

    const brokerInstance = makeBroker({
      serviceMetadata: { endpoint: "https://provider.example.com", model: "test-model" },
    });
    // getLedgerWithDetail returns empty infers
    brokerInstance.ledger.getLedgerWithDetail = () => ({ infers: [] });
    mockBroker.mockResolvedValue(brokerInstance);
    // OpenClaw config has baseUrl matching the service metadata endpoint
    mockConfig.mockReturnValue(makeOpenclawConfig());
    // No compute-state.json
    mockExistsSync.mockReturnValue(false);

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.provider).toBe(TEST_PROVIDER);
  });

  it("should fail openclawConfig when baseUrl does not match provider endpoint (cross-check)", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      serviceMetadata: { endpoint: "https://other-provider.example.com", model: "test-model" },
    }));
    setupComputeState();
    // OpenClaw config has a DIFFERENT baseUrl
    mockConfig.mockReturnValue(makeOpenclawConfig()); // baseUrl: https://provider.example.com

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.openclawConfig.ok).toBe(false);
    expect(result.checks.openclawConfig.detail).toContain("does not match");
  });

  it("should pass openclawConfig when baseUrl matches provider endpoint", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      serviceMetadata: { endpoint: "https://provider.example.com", model: "test-model" },
    }));
    setupComputeState();
    mockConfig.mockReturnValue(makeOpenclawConfig());

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.checks.openclawConfig.ok).toBe(true);
  });

  it("should pass openclawConfig when getServiceMetadata fails (best-effort cross-check)", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });

    const brokerInstance = makeBroker();
    // Make getServiceMetadata throw
    brokerInstance.inference.getServiceMetadata = () => { throw new Error("metadata unavailable"); };
    mockBroker.mockResolvedValue(brokerInstance);
    setupComputeState();
    mockConfig.mockReturnValue(makeOpenclawConfig());

    const result = await checkComputeReadiness();

    // Should still pass because cross-check is best-effort
    expect(result.ready).toBe(true);
    expect(result.checks.openclawConfig.ok).toBe(true);
  });
});
