import { describe, it, expect } from "vitest";
import { parseUnits } from "viem";

describe("parseUnits (bridge amount conversion sanity)", () => {
  it("converts 1 with 18 decimals", () => {
    expect(parseUnits("1", 18).toString()).toBe("1000000000000000000");
  });

  it("converts 0.5 with 18 decimals", () => {
    expect(parseUnits("0.5", 18).toString()).toBe("500000000000000000");
  });

  it("converts 100 with 6 decimals (USDC-like)", () => {
    expect(parseUnits("100", 6).toString()).toBe("100000000");
  });

  it("converts 0 with 18 decimals", () => {
    expect(parseUnits("0", 18).toString()).toBe("0");
  });
});
