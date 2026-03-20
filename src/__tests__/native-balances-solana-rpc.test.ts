import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetBalance = vi.fn();
const mockConnection = vi.fn(() => ({
  getBalance: mockGetBalance,
}));
const mockPublicKey = vi.fn((value: string) => ({ value }));

vi.mock("@solana/web3.js", () => ({
  Connection: mockConnection,
  PublicKey: mockPublicKey,
}));

vi.mock("../khalani/evm-client.js", () => ({
  createDynamicPublicClient: vi.fn(),
}));

const { collectNativeBalances } = await import("../wallet/native-balances.js");

describe("collectNativeBalances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBalance.mockResolvedValue(500000000n);
  });

  it("uses the Solana RPC override when provided", async () => {
    const balances = await collectNativeBalances(
      "So11111111111111111111111111111111111111112",
      "solana",
      [{
        type: "solana",
        id: 20011000000,
        name: "Solana",
        nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
        rpcUrls: { default: { http: ["https://metadata.rpc"] } },
      }],
      { solanaRpcUrl: "https://override.rpc" },
    );

    expect(mockConnection).toHaveBeenCalledWith("https://override.rpc", "confirmed");
    expect(mockPublicKey).toHaveBeenCalledWith("So11111111111111111111111111111111111111112");
    expect(balances[0]?.balance).toBe("0.5");
  });
});
