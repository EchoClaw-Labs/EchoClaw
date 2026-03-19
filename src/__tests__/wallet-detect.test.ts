import { describe, it, expect, vi } from "vitest";

const mockKeystoreExists = vi.fn<() => boolean>();
const mockLoadKeystore = vi.fn();
const mockDecryptPrivateKey = vi.fn();
const mockLoadConfig = vi.fn();
const mockGetKeystorePassword = vi.fn<() => string | null>();

vi.mock("../wallet/keystore.js", () => ({
  keystoreExists: () => mockKeystoreExists(),
  loadKeystore: () => mockLoadKeystore(),
  decryptPrivateKey: (...args: any[]) => mockDecryptPrivateKey(...args),
  normalizePrivateKey: vi.fn(),
}));

vi.mock("../wallet/create.js", () => ({ createWallet: vi.fn() }));
vi.mock("../wallet/import.js", () => ({ importWallet: vi.fn() }));
vi.mock("../config/store.js", () => ({ loadConfig: () => mockLoadConfig() }));
vi.mock("../utils/env.js", () => ({ getKeystorePassword: () => mockGetKeystorePassword() }));
vi.mock("../utils/ui.js", () => ({ spinner: vi.fn(), colors: { address: (s: string) => s, muted: (s: string) => s } }));
vi.mock("../utils/output.js", () => ({ writeStderr: vi.fn() }));
vi.mock("../errors.js", () => ({ EchoError: class extends Error { constructor(c: string, m: string) { super(m); } } }));
vi.mock("inquirer", () => ({ default: { prompt: vi.fn() } }));

const { walletStep } = await import("../commands/onboard/steps/wallet.js");

const FAKE_KEYSTORE = { version: 1, ciphertext: "a", iv: "b", salt: "c", tag: "d", kdf: { name: "scrypt", N: 1, r: 1, p: 1, dkLen: 32 } };
const FAKE_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("walletStep.detect", () => {
  function detect() {
    const state: any = {};
    const result = walletStep.detect(state);
    return { result, state };
  }

  it("configured: true when keystore + address + password decrypts", () => {
    mockKeystoreExists.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ wallet: { address: FAKE_ADDRESS } });
    mockGetKeystorePassword.mockReturnValue("correct-pw");
    mockLoadKeystore.mockReturnValue(FAKE_KEYSTORE);
    mockDecryptPrivateKey.mockReturnValue("0xdeadbeef");

    const { result, state } = detect();

    expect(result.configured).toBe(true);
    expect(result.summary).toContain(FAKE_ADDRESS);
    expect(state.walletAddress).toBe(FAKE_ADDRESS);
  });

  it("configured: false when decrypt fails (wrong password)", () => {
    mockKeystoreExists.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ wallet: { address: FAKE_ADDRESS } });
    mockGetKeystorePassword.mockReturnValue("wrong-pw");
    mockLoadKeystore.mockReturnValue(FAKE_KEYSTORE);
    mockDecryptPrivateKey.mockImplementation(() => { throw new Error("Decryption failed"); });

    const { result } = detect();

    expect(result.configured).toBe(false);
    expect(result.summary).toContain("decrypt failed");
    expect(result.summary).toContain("unset ECHO_KEYSTORE_PASSWORD");
  });

  it("configured: false when no password available", () => {
    mockKeystoreExists.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ wallet: { address: FAKE_ADDRESS } });
    mockGetKeystorePassword.mockReturnValue(null);

    const { result } = detect();

    expect(result.configured).toBe(false);
    expect(result.summary).toContain("no password set");
  });

  it("configured: false when keystore file missing/unreadable", () => {
    mockKeystoreExists.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ wallet: { address: FAKE_ADDRESS } });
    mockGetKeystorePassword.mockReturnValue("pw");
    mockLoadKeystore.mockReturnValue(null);

    const { result } = detect();

    expect(result.configured).toBe(false);
    expect(result.summary).toContain("missing or unreadable");
  });

  it("configured: false when no keystore exists", () => {
    mockKeystoreExists.mockReturnValue(false);
    mockLoadConfig.mockReturnValue({ wallet: { address: null } });

    const { result } = detect();

    expect(result.configured).toBe(false);
    expect(result.summary).toContain("No wallet configured");
  });

  it("configured: false when keystore exists but no address in config", () => {
    mockKeystoreExists.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ wallet: { address: null } });

    const { result } = detect();

    expect(result.configured).toBe(false);
    expect(result.summary).toContain("no address in config");
  });
});
