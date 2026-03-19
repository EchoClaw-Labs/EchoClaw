import { describe, it, expect } from "vitest";
import { sanitizeContent } from "../../agent/tool-parser.js";

describe("sanitizeContent — strip tool call artifacts", () => {
  it("strips <tool_call> blocks and keeps plain text", () => {
    const input = `Here is my analysis.\n<tool_call>{"name":"wallet_balance","arguments":{}}</tool_call>\nDone.`;
    const result = sanitizeContent(input);
    expect(result).toContain("Here is my analysis.");
    expect(result).toContain("Done.");
    expect(result).not.toContain("tool_call");
  });

  it("strips multiple <tool_call> blocks", () => {
    const input = [
      "Some text.",
      '<tool_call>{"name":"a","arguments":{}}</tool_call>',
      '<tool_call>{"name":"b","arguments":{}}</tool_call>',
      "More text.",
    ].join("\n");
    const result = sanitizeContent(input);
    expect(result).toContain("Some text.");
    expect(result).toContain("More text.");
    expect(result).not.toContain("tool_call");
  });

  it("strips ```tool_calls``` blocks", () => {
    const input = 'Here is the plan.\n```tool_calls\n{"name":"wallet_balance","arguments":{}}\n```\nDone.';
    const result = sanitizeContent(input);
    expect(result).toContain("Here is the plan.");
    expect(result).toContain("Done.");
    expect(result).not.toContain("tool_calls");
  });

  it("returns plain text unchanged", () => {
    expect(sanitizeContent("Just a regular message.")).toBe("Just a regular message.");
  });

  it("returns empty string for tool-call-only input", () => {
    expect(sanitizeContent('<tool_call>{"name":"a","arguments":{}}</tool_call>')).toBe("");
  });

  it("strips unclosed <tool_call> tags (GLM-5 pattern)", () => {
    expect(sanitizeContent('Hello<tool_call>{"name":"a","arguments":{}}')).toBe("Hello");
  });

  it("strips </think> reasoning artifacts", () => {
    expect(sanitizeContent("</think>Here is the answer.")).toBe("Here is the answer.");
  });

  it("handles content with only whitespace after stripping", () => {
    expect(sanitizeContent('  \n<tool_call>{"name":"a","arguments":{}}</tool_call>\n  ')).toBe("");
  });
});
