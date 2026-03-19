import { describe, expect, it } from "vitest";
import { createBridgeSubcommand } from "../commands/khalani/bridge.js";

describe("khalani bridge command", () => {
  it("registers bridge subcommand with required options", () => {
    const cmd = createBridgeSubcommand();
    expect(cmd.name()).toBe("bridge");

    const optionNames = cmd.options.map((opt) => opt.long);
    expect(optionNames).toEqual(
      expect.arrayContaining([
        "--from-chain",
        "--from-token",
        "--to-chain",
        "--to-token",
        "--amount",
        "--dry-run",
        "--yes",
        "--deposit-method",
        "--route-id",
      ]),
    );
  });

  it("has trade-type defaulting to EXACT_INPUT", () => {
    const cmd = createBridgeSubcommand();
    const tradeTypeOpt = cmd.options.find((opt) => opt.long === "--trade-type");
    expect(tradeTypeOpt).toBeDefined();
    expect(tradeTypeOpt!.defaultValue).toBe("EXACT_INPUT");
  });

  it("requires from-chain, from-token, to-chain, to-token, amount", () => {
    const cmd = createBridgeSubcommand();
    const requiredOptions = cmd.options.filter((opt) => opt.mandatory);
    const requiredNames = requiredOptions.map((opt) => opt.long);
    expect(requiredNames).toEqual(
      expect.arrayContaining([
        "--from-chain",
        "--from-token",
        "--to-chain",
        "--to-token",
        "--amount",
      ]),
    );
  });
});
