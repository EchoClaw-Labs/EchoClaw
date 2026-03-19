import { describe, it, expect } from "vitest";
import { estimateTokens, calculateBudget } from "../../agent/context.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens for plain English text", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const tokens = estimateTokens(text);
    // 9 words * 1.3 ≈ 12, chars/3.5 ≈ 12.5 → max ≈ 13
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(30);
  });

  it("handles code with high char density", () => {
    const code = "const x=()=>{return{a:1,b:2,c:3}}";
    const tokens = estimateTokens(code);
    // 1 word (no spaces), but 34 chars / 3.5 ≈ 10
    expect(tokens).toBeGreaterThan(5);
  });

  it("handles very long text", () => {
    const text = "word ".repeat(10000);
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(10000); // 10000 * 1.3
  });
});

describe("calculateBudget", () => {
  it("returns shouldCompact=false when under threshold", () => {
    const budget = calculateBudget("Short prompt", [{ role: "user", content: "Hi", timestamp: "" }], 128000);
    expect(budget.shouldCompact).toBe(false);
    expect(budget.totalTokens).toBeLessThan(128000 * 0.8);
  });

  it("returns shouldCompact=true when over 80% threshold", () => {
    // Create enough messages to exceed 80% of 1000 token limit
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: "user" as const,
      content: "This is a moderately long message to fill up the context window with tokens. ".repeat(5),
      timestamp: "",
    }));
    const budget = calculateBudget("System prompt", messages, 1000);
    expect(budget.shouldCompact).toBe(true);
  });

  it("calculates usageFraction correctly", () => {
    const budget = calculateBudget("Test", [], 1000);
    expect(budget.usageFraction).toBeGreaterThan(0);
    expect(budget.usageFraction).toBeLessThan(1);
  });

  it("accounts for system prompt tokens", () => {
    const shortBudget = calculateBudget("Hi", [], 128000);
    const longBudget = calculateBudget("A".repeat(10000), [], 128000);
    expect(longBudget.systemTokens).toBeGreaterThan(shortBudget.systemTokens);
    expect(longBudget.totalTokens).toBeGreaterThan(shortBudget.totalTokens);
  });
});
