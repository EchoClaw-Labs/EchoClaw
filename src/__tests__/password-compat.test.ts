import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EchoError } from "../errors.js";

const mockGetPasswordHealth = vi.fn();
const mockGetKeystorePassword = vi.fn();

const ENV_KEY = "ECHO_KEYSTORE_PASSWORD";

vi.mock("../password/health.js", () => ({
  getPasswordHealth: (...args: []) => mockGetPasswordHealth(...args),
}));

vi.mock("../utils/env.js", () => ({
  getKeystorePassword: (...args: []) => mockGetKeystorePassword(...args),
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { ensureAgentPasswordReadyForContainer } = await import("../password/compat.js");

describe("ensureAgentPasswordReadyForContainer", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    mockGetPasswordHealth.mockReset();
    mockGetKeystorePassword.mockReset();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("sets process.env when password is ready", () => {
    mockGetPasswordHealth.mockReturnValue({
      status: "ready",
      source: "app-env",
      appEnvPresent: true,
      driftSources: [],
    });
    mockGetKeystorePassword.mockReturnValue("secret-pass");

    const result = ensureAgentPasswordReadyForContainer();

    expect(process.env[ENV_KEY]).toBe("secret-pass");
    expect(result.migrated).toBe(false);
    expect(result.health.source).toBe("app-env");
  });

  it("blocks startup when password sources drift", () => {
    mockGetPasswordHealth.mockReturnValue({
      status: "drift",
      source: "app-env",
      appEnvPresent: true,
      driftSources: ["env", "app-env"],
    });

    expect(() => ensureAgentPasswordReadyForContainer()).toThrow(EchoError);
  });

  it("blocks startup when the stored password is invalid", () => {
    mockGetPasswordHealth.mockReturnValue({
      status: "invalid",
      source: "app-env",
      appEnvPresent: true,
      driftSources: [],
    });

    expect(() => ensureAgentPasswordReadyForContainer()).toThrow(EchoError);
  });
});
