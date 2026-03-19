import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EchoError, ErrorCodes } from "../errors.js";
import { parseBigintish } from "../commands/khalani/bridge-executor.js";
import type {
  ContractCallDepositPlan,
  DepositPlan,
  KhalaniChain,
  Permit2DepositPlan,
  TransferDepositPlan,
} from "../khalani/types.js";

const ETH_CHAIN: KhalaniChain = {
  type: "eip155",
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth.example"] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
};

const SOL_CHAIN: KhalaniChain = {
  type: "solana",
  id: 20011000000,
  name: "Solana",
  nativeCurrency: { name: "Sol", symbol: "SOL", decimals: 9 },
  rpcUrls: { default: { http: ["https://solana.example"] } },
};

const CHAINS: KhalaniChain[] = [ETH_CHAIN, SOL_CHAIN];

// We test parseBigintish directly (already imported at top-level).
// For executeDepositPlan and friends, we mock the heavy dependencies.

vi.mock("../wallet/multi-auth.js", () => ({
  requireEvmWallet: vi.fn(() => ({
    family: "eip155" as const,
    address: "0x9f7cF98a82462575a3b25C664BfBE5dCeCF3dec2",
    privateKey: "0x" + "ab".repeat(32),
  })),
  requireSolanaWallet: vi.fn(() => ({
    family: "solana" as const,
    address: "11111111111111111111111111111111",
    secretKey: new Uint8Array(64),
  })),
}));

const mockSendTransaction = vi.fn(async () => "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const);
const mockWriteContract = vi.fn(async () => "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const);
const mockWaitForTransactionReceipt = vi.fn(async () => ({ status: "success" as const }));
const mockSubmitDeposit = vi.fn(async () => ({
  orderId: "order-123",
  txHash: "0xdeadbeef",
}));

vi.mock("../khalani/evm-client.js", () => ({
  createDynamicWalletClient: vi.fn(() => ({
    sendTransaction: mockSendTransaction,
    writeContract: mockWriteContract,
  })),
  createDynamicPublicClient: vi.fn(() => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  })),
}));

vi.mock("../khalani/solana-signer.js", () => ({
  signAndSendSolanaTransaction: vi.fn(async () => "5xFakeSignature123456789"),
}));

vi.mock("../khalani/client.js", () => ({
  getKhalaniClient: vi.fn(() => ({
    submitDeposit: mockSubmitDeposit,
  })),
}));

vi.mock("../khalani/chains.js", () => ({
  getChainRpcUrl: vi.fn(() => "https://eth.example"),
}));

describe("parseBigintish", () => {
  it("returns undefined for null/undefined", () => {
    expect(parseBigintish(null, "test")).toBeUndefined();
    expect(parseBigintish(undefined, "test")).toBeUndefined();
  });

  it("parses bigint directly", () => {
    expect(parseBigintish(42n, "test")).toBe(42n);
  });

  it("parses number", () => {
    expect(parseBigintish(42, "test")).toBe(42n);
  });

  it("parses string", () => {
    expect(parseBigintish("42", "test")).toBe(42n);
  });

  it("parses hex string", () => {
    expect(parseBigintish("0x2a", "test")).toBe(42n);
  });

  it("throws for invalid string", () => {
    expect(() => parseBigintish("abc", "test")).toThrow("Invalid bigint");
  });
});

describe("executeDepositPlan", () => {
  let executeDepositPlan: typeof import("../commands/khalani/bridge-executor.js").executeDepositPlan;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSubmitDeposit.mockResolvedValue({
      orderId: "order-123",
      txHash: "0xdeadbeef",
    });
    const mod = await import("../commands/khalani/bridge-executor.js");
    executeDepositPlan = mod.executeDepositPlan;
  });

  it("blocks PERMIT2 plans with KHALANI_PERMIT2_BLOCKED", async () => {
    const permit2Plan: Permit2DepositPlan = {
      kind: "PERMIT2",
      permit: { domain: {} },
      transferDetails: { to: "0x1" },
    };

    await expect(
      executeDepositPlan(permit2Plan, ETH_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KHALANI_PERMIT2_BLOCKED,
    });
  });

  it("routes EVM CONTRACT_CALL to executeEvmContractCallPlan", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "eth_sendTransaction",
            params: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0x0" }],
          },
          deposit: true,
        },
      ],
    };

    const result = await executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1");
    expect(result).toHaveProperty("orderId");
    expect(result).toHaveProperty("txHash");
  });

  it("submits the hash from the action flagged as deposit=true", async () => {
    mockSendTransaction
      .mockResolvedValueOnce("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      .mockResolvedValueOnce("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "eth_sendTransaction",
            params: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0x0" }],
          },
        },
        {
          type: "eip1193_request",
          request: {
            method: "eth_sendTransaction",
            params: [{ to: "0x3333333333333333333333333333333333333333", data: "0x", value: "0x0" }],
          },
          deposit: true,
        },
      ],
    };

    await executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1");

    expect(mockSubmitDeposit).toHaveBeenCalledWith(expect.objectContaining({
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }));
  });

  it("routes Solana CONTRACT_CALL to executeSolanaContractCallPlan", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "solana_sendTransaction",
          transaction: "base64txdata",
          deposit: true,
        },
      ],
    };

    const result = await executeDepositPlan(plan, SOL_CHAIN, CHAINS, "q1", "r1");
    expect(result).toHaveProperty("orderId");
    expect(result).toHaveProperty("txHash");
  });

  it("throws when EVM CONTRACT_CALL yields no deposit txHash (only wallet_switchEthereumChain)", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1" }],
          },
        },
      ],
    };

    await expect(
      executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KHALANI_DEPOSIT_FAILED,
    });
  });

  it("throws when EVM CONTRACT_CALL omits deposit=true", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "eth_sendTransaction",
            params: [{ to: "0x2222222222222222222222222222222222222222", data: "0x", value: "0x0" }],
          },
        },
      ],
    };

    await expect(
      executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KHALANI_DEPOSIT_FAILED,
    });
  });

  it("throws CHAIN_MISMATCH when wallet_switchEthereumChain requests a different chain", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x89" }], // 137 = polygon, but route is ETH chain 1
          },
        },
      ],
    };

    await expect(
      executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.CHAIN_MISMATCH,
    });
  });

  it("executes TRANSFER plan for EVM chain", async () => {
    const plan: TransferDepositPlan = {
      kind: "TRANSFER",
      depositAddress: "0x3333333333333333333333333333333333333333",
      amount: "1000000",
      token: "0x4444444444444444444444444444444444444444",
      chainId: 1,
    };

    const result = await executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1");
    expect(result).toHaveProperty("orderId");
    expect(result).toHaveProperty("txHash");
  });

  it("rejects TRANSFER plan for Solana chain (not implemented)", async () => {
    const plan: TransferDepositPlan = {
      kind: "TRANSFER",
      depositAddress: "11111111111111111111111111111111",
      amount: "1000000",
      token: "native",
      chainId: 20011000000,
    };

    await expect(
      executeDepositPlan(plan, SOL_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KHALANI_DEPOSIT_FAILED,
    });
  });

  it("sends native transfer when token is the zero address", async () => {
    const plan: TransferDepositPlan = {
      kind: "TRANSFER",
      depositAddress: "0x3333333333333333333333333333333333333333",
      amount: "1000000",
      token: "0x0000000000000000000000000000000000000000",
      chainId: 1,
    };

    const result = await executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1");
    expect(result).toHaveProperty("orderId");
  });

  it("handles EVM approval with unsupported method", async () => {
    const plan: ContractCallDepositPlan = {
      kind: "CONTRACT_CALL",
      approvals: [
        {
          type: "eip1193_request",
          request: {
            method: "personal_sign",
            params: [],
          },
        },
      ],
    };

    await expect(
      executeDepositPlan(plan, ETH_CHAIN, CHAINS, "q1", "r1"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KHALANI_DEPOSIT_FAILED,
    });
  });
});
