import { describe, it, expect } from "vitest";
import { generateId } from "../../agent/id.js";

describe("generateId", () => {
  it("produces IDs with correct prefix", () => {
    const id = generateId("session");
    expect(id).toMatch(/^session-/);
  });

  it("produces IDs with UUID suffix", () => {
    const id = generateId("call");
    // UUID v4 format: 8-4-4-4-12 hex chars
    const uuidPart = id.replace(/^call-/, "");
    expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs across rapid calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId("test"));
    }
    expect(ids.size).toBe(1000);
  });

  it("works with various prefixes", () => {
    expect(generateId("session")).toMatch(/^session-/);
    expect(generateId("call")).toMatch(/^call-/);
    expect(generateId("approval")).toMatch(/^approval-/);
    expect(generateId("trade")).toMatch(/^trade-/);
    expect(generateId("task")).toMatch(/^task-/);
  });

  it("produces different IDs each call", () => {
    const a = generateId("x");
    const b = generateId("x");
    expect(a).not.toBe(b);
  });
});
