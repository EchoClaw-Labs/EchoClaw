import { describe, expect, it } from "vitest";
import { createSolanaCommand } from "../commands/solana/index.js";

describe("solana command tree", () => {
  it("registers all expected subcommands", () => {
    const root = createSolanaCommand();
    const names = root.commands.map((c) => c.name());

    expect(names).toEqual(expect.arrayContaining([
      "browse",
      "price",
      "send",
      "send-token",
      "swap",
      "stake",
      "burn",
      "close-accounts",
      "dca",
      "limit",
      "portfolio",
      "lend",
      "send-invite",
      "invites",
      "clawback",
      "predict",
      "studio",
      "holdings",
      "shield",
    ]));
  });

  it("has correct root description", () => {
    const root = createSolanaCommand();
    expect(root.description()).toContain("Solana");
  });
});
