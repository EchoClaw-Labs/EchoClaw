import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCodes } from "../errors.js";

let mockConfig = {
  chain: {
    chainId: 16661,
  },
  wallet: {
    address: "0x1111111111111111111111111111111111111111" as string | null,
    solanaAddress: "11111111111111111111111111111111" as string | null,
  },
};

const mockGetTokenBalances = vi.fn(async () => [
  { address: "0xaaa", chainId: 1, name: "USDC", symbol: "USDC", decimals: 6 },
]);
const mockCollectNativeBalances = vi.fn(async () => [
  {
    family: "eip155",
    chainId: 1,
    chainName: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    balanceAtomic: "1000000000000000000",
    balance: "1",
  },
]);

const mockWriteJsonSuccess = vi.fn();

vi.mock("../config/store.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  saveConfig: vi.fn(),
  getDefaultConfig: vi.fn(() => mockConfig),
  ensureConfigDir: vi.fn(),
}));

vi.mock("../khalani/chains.js", () => ({
  getCachedKhalaniChains: vi.fn(async () => [
    { type: "eip155", id: 1, name: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
    { type: "solana", id: 20011000000, name: "Solana", nativeCurrency: { name: "Sol", symbol: "SOL", decimals: 9 } },
  ]),
  resolveChainId: vi.fn((v: string) => Number(v)),
}));

vi.mock("../khalani/client.js", () => ({
  getKhalaniClient: vi.fn(() => ({
    getTokenBalances: mockGetTokenBalances,
  })),
}));

vi.mock("../wallet/native-balances.js", () => ({
  collectNativeBalances: mockCollectNativeBalances,
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: vi.fn(() => true),
  writeJsonSuccess: mockWriteJsonSuccess,
}));

vi.mock("../utils/ui.js", () => ({
  colors: { address: (v: string) => v, info: (v: string) => v, muted: (v: string) => v, success: (v: string) => v, warn: (v: string) => v },
  infoBox: vi.fn(),
  printTable: vi.fn(),
}));

// Static import at module level (mocks are hoisted above this)
const { createBalancesSubcommand } = await import("../commands/wallet/balances.js");

describe("wallet balances command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      chain: {
        chainId: 16661,
      },
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        solanaAddress: "11111111111111111111111111111111",
      },
    };
  });

  it("registers expected options", () => {
    const cmd = createBalancesSubcommand();
    expect(cmd.name()).toBe("balances");
    const optNames = cmd.options.map((opt) => opt.long);
    expect(optNames).toContain("--wallet");
    expect(optNames).toContain("--chain-ids");
  });

  it("wallet option defaults to all", () => {
    const cmd = createBalancesSubcommand();
    const walletOpt = cmd.options.find((opt) => opt.long === "--wallet");
    expect(walletOpt!.defaultValue).toBe("all");
  });

  it("fetches balances for both wallets when selector is all", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "balances"], { from: "user" });

    expect(mockGetTokenBalances).toHaveBeenCalledTimes(2);
    expect(mockCollectNativeBalances).toHaveBeenCalledTimes(2);
    expect(mockWriteJsonSuccess).toHaveBeenCalledTimes(1);

    const output = mockWriteJsonSuccess.mock.calls[0][0];
    expect(output.wallet).toBe("all");
    expect(output.balances).toHaveLength(2);
    expect(output.balances[0].nativeBalances).toHaveLength(1);
  });

  it("fetches balances for EVM only when selector is eip155", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "balances", "--wallet", "eip155"], { from: "user" });

    expect(mockGetTokenBalances).toHaveBeenCalledTimes(1);
    const output = mockWriteJsonSuccess.mock.calls[0][0];
    expect(output.wallet).toBe("eip155");
    expect(output.balances).toHaveLength(1);
    expect(output.balances[0].family).toBe("eip155");
  });

  it("fetches balances for Solana only when selector is solana", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "balances", "--wallet", "solana"], { from: "user" });

    expect(mockGetTokenBalances).toHaveBeenCalledTimes(1);
    const output = mockWriteJsonSuccess.mock.calls[0][0];
    expect(output.wallet).toBe("solana");
    expect(output.balances).toHaveLength(1);
    expect(output.balances[0].family).toBe("solana");
  });

  it("throws WALLET_NOT_CONFIGURED when no wallets match all selector", async () => {
    mockConfig.wallet.address = null;
    mockConfig.wallet.solanaAddress = null;

    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await expect(
      cmd.parseAsync(["node", "balances"], { from: "user" }),
    ).rejects.toMatchObject({ code: ErrorCodes.WALLET_NOT_CONFIGURED });
  });

  it("throws WALLET_NOT_CONFIGURED when EVM-only selected but no EVM wallet", async () => {
    mockConfig.wallet.address = null;

    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await expect(
      cmd.parseAsync(["node", "balances", "--wallet", "evm"], { from: "user" }),
    ).rejects.toMatchObject({ code: ErrorCodes.WALLET_NOT_CONFIGURED });
  });

  it("throws INVALID_ADDRESS for unsupported wallet selector", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await expect(
      cmd.parseAsync(["node", "balances", "--wallet", "bitcoin"], { from: "user" }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_ADDRESS });
  });

  it("accepts sol as alias for solana selector", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "balances", "--wallet", "sol"], { from: "user" });

    expect(mockGetTokenBalances).toHaveBeenCalledTimes(1);
    const output = mockWriteJsonSuccess.mock.calls[0][0];
    expect(output.wallet).toBe("solana");
  });

  it("accepts evm as alias for eip155 selector", async () => {
    const cmd = createBalancesSubcommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "balances", "--wallet", "evm"], { from: "user" });

    expect(mockGetTokenBalances).toHaveBeenCalledTimes(1);
    const output = mockWriteJsonSuccess.mock.calls[0][0];
    expect(output.wallet).toBe("eip155");
  });
});
