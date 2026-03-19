import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertWalletMutationAllowed } from "../guardrails/wallet-mutation.js";
import { ErrorCodes, EchoError } from "../errors.js";
import { setJsonMode } from "../utils/output.js";

function setTTY(stream: NodeJS.WriteStream, isTTY: boolean | undefined): void {
  Object.defineProperty(stream, "isTTY", {
    value: isTTY,
    configurable: true,
  });
}

describe("wallet mutation guardrail", () => {
  let originalStderrTTY: boolean | undefined;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalStderrTTY = process.stderr.isTTY;
    originalEnv = process.env.ECHO_ALLOW_WALLET_MUTATION;
    delete process.env.ECHO_ALLOW_WALLET_MUTATION;
    setJsonMode(false);
  });

  afterEach(() => {
    setTTY(process.stderr, originalStderrTTY);
    if (originalEnv === undefined) {
      delete process.env.ECHO_ALLOW_WALLET_MUTATION;
    } else {
      process.env.ECHO_ALLOW_WALLET_MUTATION = originalEnv;
    }
    setJsonMode(false);
  });

  it("allows in TTY mode (stderr.isTTY = true, jsonMode = false)", () => {
    setTTY(process.stderr, true);
    expect(() => assertWalletMutationAllowed("create")).not.toThrow();
  });

  it("blocks in non-TTY mode (stderr.isTTY = false)", () => {
    setTTY(process.stderr, false);
    expect(() => assertWalletMutationAllowed("create")).toThrow(EchoError);
  });

  it("blocks in non-TTY mode (stderr.isTTY = undefined)", () => {
    setTTY(process.stderr, undefined);
    expect(() => assertWalletMutationAllowed("import")).toThrow(EchoError);
  });

  it("blocks in JSON mode even if stderr.isTTY = true", () => {
    setTTY(process.stderr, true);
    setJsonMode(true);
    expect(() => assertWalletMutationAllowed("restore")).toThrow(EchoError);
  });

  it("allows with ECHO_ALLOW_WALLET_MUTATION=1 in headless", () => {
    setTTY(process.stderr, false);
    process.env.ECHO_ALLOW_WALLET_MUTATION = "1";
    expect(() => assertWalletMutationAllowed("create")).not.toThrow();
  });

  it("does NOT allow with ECHO_ALLOW_WALLET_MUTATION=0", () => {
    setTTY(process.stderr, false);
    process.env.ECHO_ALLOW_WALLET_MUTATION = "0";
    expect(() => assertWalletMutationAllowed("create")).toThrow(EchoError);
  });

  it("includes operation name in error message", () => {
    setTTY(process.stderr, false);
    try {
      assertWalletMutationAllowed("import");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EchoError);
      expect((err as EchoError).message).toContain("import");
    }
  });

  it("error code is WALLET_MUTATION_BLOCKED_HEADLESS", () => {
    setTTY(process.stderr, false);
    try {
      assertWalletMutationAllowed("restore");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EchoError);
      expect((err as EchoError).code).toBe(
        ErrorCodes.WALLET_MUTATION_BLOCKED_HEADLESS
      );
    }
  });
});
