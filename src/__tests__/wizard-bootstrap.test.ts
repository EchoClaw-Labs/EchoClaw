import { describe, expect, it } from "vitest";
import { deriveWizardBootstrapStep } from "../launcher/ui/src/utils/wizard-bootstrap.js";

describe("deriveWizardBootstrapStep", () => {
  it("returns done only when routing says ready", () => {
    const step = deriveWizardBootstrapStep(
      {
        wallet: {
          password: { status: "ready" },
          evmKeystorePresent: true,
        },
      },
      { mode: "dashboard", reason: "ready" },
    );

    expect(step).toBe("done");
  });

  it("does not return done for setup_incomplete", () => {
    const step = deriveWizardBootstrapStep(
      {
        wallet: {
          password: { status: "ready" },
          evmKeystorePresent: true,
        },
      },
      { mode: "dashboard", reason: "setup_incomplete" },
    );

    expect(step).toBe("runtime");
  });

  it("returns wallet when password exists but evm keystore is missing", () => {
    const step = deriveWizardBootstrapStep(
      {
        wallet: {
          password: { status: "drift" },
          evmKeystorePresent: false,
        },
      },
      null,
    );

    expect(step).toBe("wallet");
  });

  it("returns password when password is missing", () => {
    const step = deriveWizardBootstrapStep(
      {
        wallet: {
          password: { status: "missing" },
          evmKeystorePresent: false,
        },
      },
      null,
    );

    expect(step).toBe("password");
  });
});
