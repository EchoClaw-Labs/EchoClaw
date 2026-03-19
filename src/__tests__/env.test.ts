import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockReadEnvValue = vi.fn<(key: string, path: string) => string | null>();

vi.mock("../providers/env-resolution.js", () => ({
  readEnvValue: (...args: any[]) => mockReadEnvValue(...args),
}));

vi.mock("../config/paths.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, ENV_FILE: "/mock/.config/echoclaw/.env" };
});

const { getKeystorePassword, requireKeystorePassword } = await import("../utils/env.js");

const ENV_KEY = "ECHO_KEYSTORE_PASSWORD";

describe("getKeystorePassword", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    mockReadEnvValue.mockReset();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("should return valid process.env value", () => {
    process.env[ENV_KEY] = "my-password";
    mockReadEnvValue.mockReturnValue(null);

    expect(getKeystorePassword()).toBe("my-password");
  });

  it("should treat empty string env as missing and fall through to .env", () => {
    process.env[ENV_KEY] = "";
    mockReadEnvValue.mockReturnValue("env-file-password");

    expect(getKeystorePassword()).toBe("env-file-password");
  });

  it('should treat literal "undefined" env as missing and fall through to .env', () => {
    process.env[ENV_KEY] = "undefined";
    mockReadEnvValue.mockReturnValue("env-file-password");

    expect(getKeystorePassword()).toBe("env-file-password");
  });

  it("should fall through to .env when env is not set", () => {
    mockReadEnvValue.mockReturnValue("from-dotenv");

    expect(getKeystorePassword()).toBe("from-dotenv");
  });

  it("should cache .env value in process.env after resolution", () => {
    mockReadEnvValue.mockReturnValue("cached-pw");

    getKeystorePassword();

    expect(process.env[ENV_KEY]).toBe("cached-pw");
  });

  it("should return null when nothing is set", () => {
    mockReadEnvValue.mockReturnValue(null);

    expect(getKeystorePassword()).toBeNull();
  });
});

describe("requireKeystorePassword", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    mockReadEnvValue.mockReset();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("should return password when available", () => {
    process.env[ENV_KEY] = "valid-password";
    mockReadEnvValue.mockReturnValue(null);

    expect(requireKeystorePassword()).toBe("valid-password");
  });

  it("should throw KEYSTORE_PASSWORD_NOT_SET when no password found", () => {
    mockReadEnvValue.mockReturnValue(null);

    expect(() => requireKeystorePassword()).toThrow("ECHO_KEYSTORE_PASSWORD");
  });
});
