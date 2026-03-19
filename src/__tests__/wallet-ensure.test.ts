import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteJsonSuccess = vi.fn();
const mockCreateSolanaWallet = vi.fn(async () => ({ address: "So11111111111111111111111111111111111111112" }));
const mockLoadConfig = vi.fn(() => ({
  wallet: {
    address: null,
    solanaAddress: null,
  },
}));

vi.mock("../config/store.js", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: vi.fn(),
}));

vi.mock("../wallet/keystore.js", () => ({
  keystoreExists: vi.fn(() => true),
  loadKeystore: vi.fn(() => ({ version: 1 })),
  decryptPrivateKey: vi.fn(() => "0x59c6995e998f97a5a0044966f0945382d7d63c4c91c9f86cbb87c2d2f6f1c7fd"),
}));

vi.mock("../wallet/solana-keystore.js", () => ({
  solanaKeystoreExists: vi.fn(() => false),
  loadSolanaKeystore: vi.fn(() => null),
  decryptSolanaSecretKey: vi.fn(),
  deriveSolanaAddress: vi.fn(() => "So11111111111111111111111111111111111111112"),
}));

vi.mock("../wallet/solana-create.js", () => ({
  createSolanaWallet: mockCreateSolanaWallet,
}));

vi.mock("../utils/env.js", () => ({
  getKeystorePassword: vi.fn(() => "test-password"),
}));

vi.mock("../utils/output.js", () => ({
  isHeadless: vi.fn(() => true),
  writeJsonSuccess: mockWriteJsonSuccess,
}));

vi.mock("../utils/ui.js", () => ({
  successBox: vi.fn(),
  warnBox: vi.fn(),
  infoBox: vi.fn(),
  colors: {
    address: (value: string) => value,
    muted: (value: string) => value,
    success: (value: string) => value,
    warn: (value: string) => value,
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

const { createEnsureSubcommand } = await import("../commands/wallet/ensure.js");

describe("wallet ensure", () => {
  const originalMutationEnv = process.env.ECHO_ALLOW_WALLET_MUTATION;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ECHO_ALLOW_WALLET_MUTATION;
    mockLoadConfig.mockReturnValue({
      wallet: {
        address: null,
        solanaAddress: null,
      },
    });
  });

  afterEach(() => {
    if (originalMutationEnv === undefined) {
      delete process.env.ECHO_ALLOW_WALLET_MUTATION;
    } else {
      process.env.ECHO_ALLOW_WALLET_MUTATION = originalMutationEnv;
    }
  });

  it("does not auto-create a Solana wallet in headless mode by default", async () => {
    const cmd = createEnsureSubcommand();
    cmd.exitOverride();

    await cmd.parseAsync(["node", "ensure"], { from: "user" });

    expect(mockCreateSolanaWallet).not.toHaveBeenCalled();
    expect(mockWriteJsonSuccess).toHaveBeenCalledWith(expect.objectContaining({
      wallets: expect.objectContaining({
        solana: expect.objectContaining({
          status: "not_configured",
        }),
      }),
    }));
  });

  it("allows the Solana auto-create path only when wallet mutation is explicitly unlocked", async () => {
    process.env.ECHO_ALLOW_WALLET_MUTATION = "1";

    const cmd = createEnsureSubcommand();
    cmd.exitOverride();

    await cmd.parseAsync(["node", "ensure"], { from: "user" });

    expect(mockCreateSolanaWallet).toHaveBeenCalledTimes(1);
    expect(mockWriteJsonSuccess).toHaveBeenCalledWith(expect.objectContaining({
      wallets: expect.objectContaining({
        solana: expect.objectContaining({
          status: "created",
        }),
      }),
    }));
  });
});
