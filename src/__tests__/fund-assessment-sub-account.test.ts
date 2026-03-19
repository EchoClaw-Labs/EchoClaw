import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FundView } from "../commands/echo/types.js";

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
}));

const { buildFundPayload } = await import("../commands/echo/fund-assessment.js");

function baseFundView(overrides: Partial<FundView> = {}): FundView {
  return {
    walletBalanceOg: 10,
    ledgerAvailableOg: 5,
    ledgerReservedOg: 0,
    ledgerTotalOg: 5,
    provider: null,
    model: "test-model",
    inputPricePerMTokens: "0.100",
    outputPricePerMTokens: "0.200",
    recommendedMinLockedOg: 1.0,
    currentLockedOg: 1.5,
    subAccountExists: true,
    acknowledged: true,
    monitorRunning: false,
    monitorTrackingProvider: false,
    refreshedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildFundPayload — subAccountExists check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provider selected + subAccountExists=false -> needs_action / fund_provider", () => {
    const view = baseFundView({
      provider: "0xABC",
      subAccountExists: false,
      currentLockedOg: null,
      recommendedMinLockedOg: null,
    });

    const payload = buildFundPayload(view, "openclaw");

    expect(payload.status).toBe("needs_action");
    expect(payload.nextAction).toBe("fund_provider");
  });

  it("provider selected + subAccountExists=true but insufficient locked -> needs_action / fund_provider", () => {
    const view = baseFundView({
      provider: "0xABC",
      subAccountExists: true,
      currentLockedOg: 0.5,
      recommendedMinLockedOg: 1.0,
      acknowledged: true,
    });

    const payload = buildFundPayload(view, "openclaw");

    expect(payload.status).toBe("needs_action");
    expect(payload.nextAction).toBe("fund_provider");
  });

  it("provider selected + subAccountExists=true + all good -> ready", () => {
    const view = baseFundView({
      provider: "0xABC",
      subAccountExists: true,
      currentLockedOg: 1.5,
      recommendedMinLockedOg: 1.0,
      acknowledged: true,
    });

    const payload = buildFundPayload(view, "openclaw");

    expect(payload.status).toBe("ready");
  });
});
