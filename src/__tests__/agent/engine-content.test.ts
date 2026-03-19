import { describe, it, expect } from "vitest";
import { sanitizeContent } from "../../agent/tool-parser.js";

describe("sanitizeContent — content cleaning edge cases", () => {
  it("removes <tool_call> XML blocks from input", () => {
    const result = sanitizeContent('<tool_call>{"name":"wallet_balance","arguments":{}}</tool_call>');
    expect(result).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(sanitizeContent("The current SOL price is $152.30.")).toBe("The current SOL price is $152.30.");
  });

  it("preserves only text when mixed with tool calls", () => {
    const input = [
      "I checked your balance.",
      '<tool_call>{"name":"wallet_balance","arguments":{}}</tool_call>',
      "You have 5.2 SOL.",
    ].join("\n");
    const result = sanitizeContent(input);
    expect(result).toContain("I checked your balance.");
    expect(result).toContain("You have 5.2 SOL.");
    expect(result).not.toContain("tool_call");
  });

  it("handles multiline tool call blocks", () => {
    const input = "Starting analysis.\n<tool_call>\n{\"name\":\"web_search\"}\n</tool_call>\nAnalysis complete.";
    const result = sanitizeContent(input);
    expect(result).toContain("Starting analysis.");
    expect(result).toContain("Analysis complete.");
    expect(result).not.toContain("web_search");
  });

  it("removes ```tool_calls``` fenced blocks from mixed content", () => {
    const input = "Here is what I found:\n```tool_calls\n{\"name\":\"a\"}\n```\nYour balance is 10 SOL.";
    const result = sanitizeContent(input);
    expect(result).toContain("Here is what I found:");
    expect(result).toContain("Your balance is 10 SOL.");
    expect(result).not.toContain("tool_calls");
  });
});
