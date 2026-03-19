import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadEnvValue = vi.fn<(key: string, path: string) => string | null>();
const mockGetKeystorePassword = vi.fn<() => string | null>();
const mockKeystoreExists = vi.fn<() => boolean>().mockReturnValue(false);
const mockLoadKeystore = vi.fn();
const mockDecryptPrivateKey = vi.fn();

const APP_ENV_PATH = "/mock/.config/echoclaw/.env";
const ENV_KEY = "ECHO_KEYSTORE_PASSWORD";

vi.mock("../config/paths.js", () => ({
  ENV_FILE: APP_ENV_PATH,
}));

vi.mock("../providers/env-resolution.js", () => ({
  readEnvValue: (...args: [string, string]) => mockReadEnvValue(...args),
}));

vi.mock("../utils/env.js", () => ({
  getKeystorePassword: (...args: []) => mockGetKeystorePassword(...args),
}));

vi.mock("../wallet/keystore.js", () => ({
  keystoreExists: (...args: []) => mockKeystoreExists(...args),
  loadKeystore: (...args: []) => mockLoadKeystore(...args),
  decryptPrivateKey: (...args: unknown[]) => mockDecryptPrivateKey(...args),
}));

const { getPasswordHealth } = await import("../password/health.js");

describe("getPasswordHealth", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    mockReadEnvValue.mockReset();
    mockGetKeystorePassword.mockReset();
    mockKeystoreExists.mockReset();
    mockKeystoreExists.mockReturnValue(false);
    mockLoadKeystore.mockReset();
    mockDecryptPrivateKey.mockReset();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("reports ready with app-env source when app env is present", () => {
    process.env[ENV_KEY] = "app-password";
    mockReadEnvValue.mockImplementation((_key, path) => {
      if (path === APP_ENV_PATH) return "app-password";
      return null;
    });
    mockGetKeystorePassword.mockReturnValue("app-password");

    const health = getPasswordHealth();

    expect(health.source).toBe("app-env");
    expect(health.status).toBe("ready");
  });

  it("reports drift when env and app-env disagree", () => {
    process.env[ENV_KEY] = "env-password";
    mockReadEnvValue.mockImplementation((_key, path) => {
      if (path === APP_ENV_PATH) return "app-password";
      return null;
    });
    mockGetKeystorePassword.mockReturnValue("env-password");

    const health = getPasswordHealth();

    expect(health.status).toBe("drift");
    expect(health.driftSources).toEqual(["env", "app-env"]);
  });

  it("reports invalid when the stored password does not decrypt the keystore", () => {
    mockReadEnvValue.mockImplementation((_key, path) => {
      if (path === APP_ENV_PATH) return "wrong-password";
      return null;
    });
    mockGetKeystorePassword.mockReturnValue("wrong-password");
    mockKeystoreExists.mockReturnValue(true);
    mockLoadKeystore.mockReturnValue({ id: "keystore" });
    mockDecryptPrivateKey.mockImplementation(() => {
      throw new Error("bad password");
    });

    const health = getPasswordHealth();

    expect(health.status).toBe("invalid");
    expect(health.source).toBe("app-env");
  });

  it("reports missing when no password is set", () => {
    mockReadEnvValue.mockReturnValue(null);
    mockGetKeystorePassword.mockReturnValue(null);

    const health = getPasswordHealth();

    expect(health.status).toBe("missing");
    expect(health.source).toBe("none");
  });
});
