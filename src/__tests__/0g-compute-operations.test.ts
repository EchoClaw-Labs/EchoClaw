import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseUnits } from "viem";

// ── Mock modules ────────────────────────────────────────────────────

vi.mock("../0g-compute/bridge.js", () => ({
  withSuppressedConsole: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../0g-compute/account.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../0g-compute/account.js")>();
  return {
    ...actual,
    normalizeSubAccount: vi.fn(),
  };
});

vi.mock("../0g-compute/pricing.js", () => ({
  calculateProviderPricing: vi.fn(),
  formatPricePerMTokens: vi.fn(),
}));

vi.mock("../openclaw/config.js", () => ({
  patchOpenclawConfig: vi.fn(() => ({ status: "created", path: "/test", keysSet: [], keysSkipped: [] })),
}));

vi.mock("../0g-compute/readiness.js", () => ({
  saveComputeState: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { fundProvider, ackWithReadback, depositToLedger, getLedgerBalance } from "../0g-compute/operations.js";
import { normalizeLedger, normalizeLedgerDetail } from "../0g-compute/account.js";

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_PROVIDER = "0x1234567890abcdef1234567890abcdef12345678";

function makeBroker(overrides?: {
  transferFund?: ReturnType<typeof vi.fn>;
  acknowledged?: ReturnType<typeof vi.fn>;
  acknowledgeProviderSigner?: ReturnType<typeof vi.fn>;
  getLedger?: ReturnType<typeof vi.fn>;
  depositFund?: ReturnType<typeof vi.fn>;
  addLedger?: ReturnType<typeof vi.fn>;
}) {
  return {
    ledger: {
      getLedger: overrides?.getLedger ?? vi.fn(),
      addLedger: overrides?.addLedger ?? vi.fn(),
      depositFund: overrides?.depositFund ?? vi.fn(),
      transferFund: overrides?.transferFund ?? vi.fn(),
    },
    inference: {
      getAccount: vi.fn(),
      acknowledged: overrides?.acknowledged ?? vi.fn(() => true),
      acknowledgeProviderSigner: overrides?.acknowledgeProviderSigner ?? vi.fn(),
      listServiceWithDetail: vi.fn(() => []),
      getServiceMetadata: vi.fn(),
      requestProcessor: {
        createApiKey: vi.fn(),
      },
    },
  };
}

// ── Tests: fundProvider precision ───────────────────────────────────

describe("fundProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass string directly to parseUnits — no Number() roundtrip", async () => {
    const transferFund = vi.fn();
    const broker = makeBroker({ transferFund });

    await fundProvider(broker as any, TEST_PROVIDER, "5.149");

    expect(transferFund).toHaveBeenCalledOnce();
    const [, , amountWei] = transferFund.mock.calls[0]!;

    // 5.149 * 10^18 = 5149000000000000000n
    expect(amountWei).toBe(parseUnits("5.149", 18));
    // Must NOT be the truncated value
    expect(amountWei).not.toBe(parseUnits("5.1", 18));
  });

  it("should handle whole numbers correctly", async () => {
    const transferFund = vi.fn();
    const broker = makeBroker({ transferFund });

    await fundProvider(broker as any, TEST_PROVIDER, "10");

    const [, , amountWei] = transferFund.mock.calls[0]!;
    expect(amountWei).toBe(parseUnits("10", 18));
  });

  it("should handle small fractional amounts", async () => {
    const transferFund = vi.fn();
    const broker = makeBroker({ transferFund });

    await fundProvider(broker as any, TEST_PROVIDER, "0.001");

    const [, , amountWei] = transferFund.mock.calls[0]!;
    expect(amountWei).toBe(parseUnits("0.001", 18));
  });

  it("should handle amounts that would produce scientific notation as numbers", async () => {
    const transferFund = vi.fn();
    const broker = makeBroker({ transferFund });

    // String(0.0000001) would produce "1e-7" which parseUnits rejects
    // But as a string input "0.0000001" it works fine
    await fundProvider(broker as any, TEST_PROVIDER, "0.0000001");

    const [, , amountWei] = transferFund.mock.calls[0]!;
    expect(amountWei).toBe(parseUnits("0.0000001", 18));
    expect(amountWei).toBe(100_000_000_000n);
  });
});

// ── Tests: ackWithReadback ──────────────────────────────────────────

describe("ackWithReadback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return true when acknowledged immediately", async () => {
    const acknowledged = vi.fn(() => true);
    const broker = makeBroker({ acknowledged });

    const promise = ackWithReadback(broker as any, TEST_PROVIDER, 5000, 500);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBe(true);
  });

  it("should return false after timeout when never acknowledged", async () => {
    const acknowledged = vi.fn(() => false);
    const broker = makeBroker({ acknowledged });

    const promise = ackWithReadback(broker as any, TEST_PROVIDER, 2000, 500);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result).toBe(false);
    // Should have been called multiple times during polling
    expect(acknowledged.mock.calls.length).toBeGreaterThan(1);
  });

  it("should return true when acknowledged after retries", async () => {
    let callCount = 0;
    const acknowledged = vi.fn(() => {
      callCount++;
      return callCount >= 3; // Returns true on 3rd call
    });
    const broker = makeBroker({ acknowledged });

    const promise = ackWithReadback(broker as any, TEST_PROVIDER, 10000, 500);

    // Advance through polling intervals
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});

// ── Tests: normalizeLedger ──────────────────────────────────────────

describe("normalizeLedger", () => {
  it("should normalize from named properties", () => {
    const ledger = {
      user: "0xabc",
      availableBalance: 5_000_000_000_000_000_000n,  // 5 0G
      totalBalance: 10_000_000_000_000_000_000n,      // 10 0G
      additionalInfo: "",
    };
    const result = normalizeLedger(ledger);
    expect(result.availableOg).toBe(5);
    expect(result.totalOg).toBe(10);
    expect(result.reservedOg).toBe(5);
  });

  it("should normalize from indexed tuple", () => {
    // LedgerStructOutput is a tuple: [user, availableBalance, totalBalance, additionalInfo]
    const ledger: any = ["0xabc", 3_000_000_000_000_000_000n, 8_000_000_000_000_000_000n, ""];
    const result = normalizeLedger(ledger);
    expect(result.availableOg).toBe(3);
    expect(result.totalOg).toBe(8);
    expect(result.reservedOg).toBe(5);
  });

  it("should handle zero balances", () => {
    const ledger = { availableBalance: 0n, totalBalance: 0n };
    const result = normalizeLedger(ledger);
    expect(result.availableOg).toBe(0);
    expect(result.totalOg).toBe(0);
    expect(result.reservedOg).toBe(0);
  });

  it("should handle ledger with 0 available but non-zero total (all reserved)", () => {
    const ledger = {
      availableBalance: 0n,
      totalBalance: 2_372_000_000_000_000_000n,  // 2.372 0G
    };
    const result = normalizeLedger(ledger);
    expect(result.availableOg).toBe(0);
    expect(result.totalOg).toBeCloseTo(2.372, 3);
    expect(result.reservedOg).toBeCloseTo(2.372, 3);
  });
});

// ── Tests: getLedgerBalance ─────────────────────────────────────────

describe("getLedgerBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return normalized balance when ledger exists", async () => {
    const getLedger = vi.fn(() => ({
      availableBalance: 7_500_000_000_000_000_000n,
      totalBalance: 10_000_000_000_000_000_000n,
    }));
    const broker = makeBroker({ getLedger });

    const result = await getLedgerBalance(broker as any);
    expect(result).not.toBeNull();
    expect(result!.availableOg).toBe(7.5);
    expect(result!.totalOg).toBe(10);
    expect(result!.reservedOg).toBe(2.5);
  });

  it("should return null when no ledger exists", async () => {
    const getLedger = vi.fn(() => { throw new Error("No ledger"); });
    const broker = makeBroker({ getLedger });

    const result = await getLedgerBalance(broker as any);
    expect(result).toBeNull();
  });
});

// ── Tests: depositToLedger ──────────────────────────────────────────

describe("depositToLedger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use depositFund when ledger exists", async () => {
    const getLedger = vi.fn(() => ({ availableBalance: 5n, totalBalance: 10n }));
    const depositFund = vi.fn();
    const addLedger = vi.fn();
    const broker = makeBroker({ getLedger, depositFund, addLedger });

    await depositToLedger(broker as any, "3.5");

    expect(depositFund).toHaveBeenCalledWith(3.5);
    expect(addLedger).not.toHaveBeenCalled();
  });

  it("should use addLedger when no ledger exists", async () => {
    const getLedger = vi.fn(() => { throw new Error("No ledger"); });
    const depositFund = vi.fn();
    const addLedger = vi.fn();
    const broker = makeBroker({ getLedger, depositFund, addLedger });

    await depositToLedger(broker as any, "10");

    expect(addLedger).toHaveBeenCalledWith(10);
    expect(depositFund).not.toHaveBeenCalled();
  });

  it("should propagate depositFund error when ledger exists (not fall through to addLedger)", async () => {
    const getLedger = vi.fn(() => ({ availableBalance: 5n, totalBalance: 10n }));
    const depositFund = vi.fn(() => { throw new Error("RPC timeout"); });
    const addLedger = vi.fn();
    const broker = makeBroker({ getLedger, depositFund, addLedger });

    await expect(depositToLedger(broker as any, "5")).rejects.toThrow("RPC timeout");
    expect(addLedger).not.toHaveBeenCalled();
  });
});

// ── Tests: normalizeLedgerDetail ────────────────────────────────────

describe("normalizeLedgerDetail", () => {
  it("should normalize [total, reserved, available] from getLedgerWithDetail().ledgerInfo", () => {
    // SDK: ledgerInfo = [totalBalance, totalBalance - availableBalance, availableBalance]
    const info = [
      10_000_000_000_000_000_000n,  // total: 10 0G
      7_000_000_000_000_000_000n,   // reserved: 7 0G
      3_000_000_000_000_000_000n,   // available: 3 0G
    ];
    const result = normalizeLedgerDetail(info);
    expect(result.totalOg).toBe(10);
    expect(result.availableOg).toBe(3);
    expect(result.reservedOg).toBe(7);
  });

  it("should handle all-reserved (available=0)", () => {
    const info = [
      2_372_000_000_000_000_000n,  // total: 2.372
      2_372_000_000_000_000_000n,  // reserved: 2.372
      0n,                           // available: 0
    ];
    const result = normalizeLedgerDetail(info);
    expect(result.totalOg).toBeCloseTo(2.372, 3);
    expect(result.availableOg).toBe(0);
    expect(result.reservedOg).toBeCloseTo(2.372, 3);
  });

  it("should NOT confuse with LedgerStructOutput layout", () => {
    // normalizeLedger uses indices 1,2 (LedgerStructOutput: [user, available, total, info])
    // normalizeLedgerDetail uses indices 0,2 ([total, reserved, available])
    // Verify they give DIFFERENT results on the same input
    const info = [
      10_000_000_000_000_000_000n,
      7_000_000_000_000_000_000n,
      3_000_000_000_000_000_000n,
    ];
    const detail = normalizeLedgerDetail(info);
    const wrong = normalizeLedger(info);

    // normalizeLedgerDetail: total=10, available=3 (correct)
    expect(detail.totalOg).toBe(10);
    expect(detail.availableOg).toBe(3);

    // normalizeLedger would read [1]=7 as available, [2]=3 as total (WRONG for this format)
    expect(wrong.availableOg).toBe(7);
    expect(wrong.totalOg).toBe(3);
  });
});
