import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildEchoSnapshot = vi.fn();
const mockLoadConfig = vi.fn();
const mockGetCachedKhalaniChains = vi.fn();
const mockCollectNativeBalances = vi.fn();

vi.mock("../commands/echo/snapshot.js", () => ({
  buildEchoSnapshot: mockBuildEchoSnapshot,
}));

vi.mock("../config/store.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../khalani/chains.js", () => ({
  getCachedKhalaniChains: mockGetCachedKhalaniChains,
}));

vi.mock("../wallet/native-balances.js", () => ({
  collectNativeBalances: mockCollectNativeBalances,
}));

const { buildWalletView } = await import("../commands/echo/wallet-view.js");

const EVM_CHAIN = {
  type: "eip155",
  id: 16661,
  name: "0G",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
};

const SOL_CHAIN = {
  type: "solana",
  id: 20011000000,
  name: "Solana",
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
};

describe("buildWalletView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildEchoSnapshot.mockResolvedValue({
      wallet: {
        configuredAddress: "0x1234",
        keystorePresent: true,
        evmAddress: "0x1234",
        evmKeystorePresent: true,
        solanaAddress: "So11111111111111111111111111111111111111112",
        solanaKeystorePresent: true,
        password: { status: "ready", source: "app-env" },
        decryptable: true,
      },
    });
    mockLoadConfig.mockReturnValue({
      chain: { chainId: 16661 },
      solana: { rpcUrl: "https://solana.rpc.local" },
    });
    mockGetCachedKhalaniChains.mockResolvedValue([EVM_CHAIN, SOL_CHAIN]);
    mockCollectNativeBalances
      .mockResolvedValueOnce([{
        family: "eip155",
        chainId: 16661,
        chainName: "0G",
        symbol: "0G",
        decimals: 18,
        balanceAtomic: "1000000000000000000",
        balance: "1",
      }])
      .mockResolvedValueOnce([{
        family: "solana",
        chainId: 20011000000,
        chainName: "Solana",
        symbol: "SOL",
        decimals: 9,
        balanceAtomic: "250000000",
        balance: "0.25",
      }]);
  });

  it("returns wallet snapshot plus native balances for EVM and Solana", async () => {
    const view = await buildWalletView({ fresh: true });

    expect(mockBuildEchoSnapshot).toHaveBeenCalledWith({ includeReadiness: false, fresh: true });
    expect(mockCollectNativeBalances).toHaveBeenNthCalledWith(1, "0x1234", "eip155", [EVM_CHAIN, SOL_CHAIN], { chainIds: [16661] });
    expect(mockCollectNativeBalances).toHaveBeenNthCalledWith(
      2,
      "So11111111111111111111111111111111111111112",
      "solana",
      [EVM_CHAIN, SOL_CHAIN],
      { chainIds: [20011000000], solanaRpcUrl: "https://solana.rpc.local" },
    );
    expect(view.wallet.evmAddress).toBe("0x1234");
    expect(view.balances.evm.balance).toBe("1");
    expect(view.balances.evm.symbol).toBe("0G");
    expect(view.balances.solana.balance).toBe("0.25");
    expect(view.balances.solana.symbol).toBe("SOL");
    expect(typeof view.refreshedAt).toBe("string");
  });

  it("returns empty balances when wallets are not configured", async () => {
    mockBuildEchoSnapshot.mockResolvedValueOnce({
      wallet: {
        configuredAddress: null,
        keystorePresent: false,
        evmAddress: null,
        evmKeystorePresent: false,
        solanaAddress: null,
        solanaKeystorePresent: false,
        password: { status: "missing", source: "none" },
        decryptable: false,
      },
    });

    const view = await buildWalletView();

    expect(mockCollectNativeBalances).not.toHaveBeenCalled();
    expect(view.balances.evm.configured).toBe(false);
    expect(view.balances.solana.configured).toBe(false);
    expect(view.balances.evm.balance).toBeNull();
    expect(view.balances.solana.balance).toBeNull();
  });

  it("keeps the view alive when chain metadata fetch fails", async () => {
    mockGetCachedKhalaniChains.mockRejectedValueOnce(new Error("registry offline"));

    const view = await buildWalletView();

    expect(mockCollectNativeBalances).not.toHaveBeenCalled();
    expect(view.wallet.evmAddress).toBe("0x1234");
    expect(view.balances.evm.error).toBe("Chain metadata unavailable.");
    expect(view.balances.solana.error).toBe("Chain metadata unavailable.");
  });

  it("marks unsupported configured EVM chain as unavailable", async () => {
    mockLoadConfig.mockReturnValueOnce({
      chain: { chainId: 99999 },
      solana: { rpcUrl: "https://solana.rpc.local" },
    });
    mockCollectNativeBalances.mockReset();
    mockCollectNativeBalances.mockResolvedValueOnce([{
      family: "solana",
      chainId: 20011000000,
      chainName: "Solana",
      symbol: "SOL",
      decimals: 9,
      balanceAtomic: "1",
      balance: "0.000000001",
    }]);

    const view = await buildWalletView();

    expect(view.balances.evm.error).toContain("Configured EVM chain 99999");
    expect(view.balances.solana.symbol).toBe("SOL");
  });
});
