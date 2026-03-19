import { describe, it, expect } from "vitest";
import { redactArgs, isMutatingCommand, shellSplit } from "../../agent/executor.js";

describe("redactArgs", () => {
  it("redacts --private-key value", () => {
    const result = redactArgs(["wallet", "import", "--private-key", "SECRET123"]);
    expect(result).toBe("wallet import --private-key [REDACTED]");
  });

  it("leaves safe commands untouched", () => {
    const result = redactArgs(["wallet", "balance"]);
    expect(result).toBe("wallet balance");
  });

  it("redacts --password but preserves other flags", () => {
    const result = redactArgs([
      "solana", "swap", "--password", "pass123", "--amount", "1.5",
    ]);
    expect(result).toBe("solana swap --password [REDACTED] --amount 1.5");
  });

  it("does not eat the next arg for a non-sensitive boolean-like flag", () => {
    // --json has no value after it that should be redacted
    const result = redactArgs(["wallet", "balance", "--json"]);
    expect(result).toBe("wallet balance --json");
  });

  it("redacts --secret value", () => {
    const result = redactArgs(["config", "set", "--secret", "mysecret"]);
    expect(result).toBe("config set --secret [REDACTED]");
  });

  it("redacts --mnemonic value", () => {
    const result = redactArgs(["wallet", "import", "--mnemonic", "word1 word2 word3"]);
    expect(result).toBe("wallet import --mnemonic [REDACTED]");
  });

  it("redacts --api-key value", () => {
    const result = redactArgs(["config", "set", "--api-key", "sk-abc123"]);
    expect(result).toBe("config set --api-key [REDACTED]");
  });

  it("redacts --seed value", () => {
    const result = redactArgs(["wallet", "restore", "--seed", "0xdeadbeef"]);
    expect(result).toBe("wallet restore --seed [REDACTED]");
  });

  it("redacts multiple sensitive flags in the same command", () => {
    const result = redactArgs([
      "wallet", "import", "--private-key", "0xabc", "--password", "hunter2",
    ]);
    expect(result).toBe("wallet import --private-key [REDACTED] --password [REDACTED]");
  });

  it("handles sensitive flag at the very end without a value", () => {
    // Edge case: --private-key is the last arg with no value following it
    const result = redactArgs(["wallet", "import", "--private-key"]);
    expect(result).toBe("wallet import --private-key");
  });

  it("handles empty args array", () => {
    const result = redactArgs([]);
    expect(result).toBe("");
  });
});

describe("isMutatingCommand", () => {
  it("returns true for mutating commands", () => {
    expect(isMutatingCommand("jaine_swap_sell")).toBe(true);
    expect(isMutatingCommand("solana_swap_execute")).toBe(true);
    expect(isMutatingCommand("wallet_create")).toBe(true);
    expect(isMutatingCommand("khalani_bridge")).toBe(true);
    expect(isMutatingCommand("echobook_posts_create")).toBe(true);
    expect(isMutatingCommand("slop_trade_buy")).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(isMutatingCommand("wallet_balance")).toBe(false);
    expect(isMutatingCommand("wallet_address")).toBe(false);
    expect(isMutatingCommand("khalani_quote")).toBe(false);
  });

  it("uses startsWith matching for prefix commands", () => {
    expect(isMutatingCommand("solana_swap_execute")).toBe(true);
  });
});

describe("shellSplit", () => {
  it("splits simple args on spaces", () => {
    expect(shellSplit("SOL USDC --amount 1")).toEqual(["SOL", "USDC", "--amount", "1"]);
  });

  it("respects double-quoted strings", () => {
    expect(shellSplit('--prompt "a futuristic city" --json')).toEqual(["--prompt", "a futuristic city", "--json"]);
  });

  it("respects single-quoted strings", () => {
    expect(shellSplit("--content 'hello world' --yes")).toEqual(["--content", "hello world", "--yes"]);
  });

  it("handles mixed quotes and flags", () => {
    expect(shellSplit('--submolt trading --content "gm from echoclaw" --json')).toEqual(
      ["--submolt", "trading", "--content", "gm from echoclaw", "--json"],
    );
  });

  it("handles empty string", () => {
    expect(shellSplit("")).toEqual([]);
  });

  it("handles string with only spaces", () => {
    expect(shellSplit("   ")).toEqual([]);
  });

  it("handles multiple spaces between tokens", () => {
    expect(shellSplit("--amount   1   --yes")).toEqual(["--amount", "1", "--yes"]);
  });

  it("handles quoted string with special chars", () => {
    expect(shellSplit('--body "price is $150.25 (approx)" --json')).toEqual(
      ["--body", "price is $150.25 (approx)", "--json"],
    );
  });
});
