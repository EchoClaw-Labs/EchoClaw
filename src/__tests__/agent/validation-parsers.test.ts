import { describe, it, expect } from "vitest";
import {
  parseChatRequest,
  parseApproveRequest,
  parseToggleTaskRequest,
  parseLoopStartRequest,
  RequestValidationError,
} from "../../agent/validation.js";

describe("parseChatRequest", () => {
  it("parses valid request", () => {
    const result = parseChatRequest({ message: "hello", loopMode: "restricted", sessionId: "s-1" });
    expect(result.message).toBe("hello");
    expect(result.loopMode).toBe("restricted");
    expect(result.sessionId).toBe("s-1");
  });

  it("defaults loopMode to off", () => {
    const result = parseChatRequest({ message: "hi" });
    expect(result.loopMode).toBe("off");
  });

  it("trims whitespace from message", () => {
    const result = parseChatRequest({ message: "  hello  " });
    expect(result.message).toBe("hello");
  });

  it("throws on missing message", () => {
    expect(() => parseChatRequest({})).toThrow(RequestValidationError);
  });

  it("throws on empty message", () => {
    expect(() => parseChatRequest({ message: "   " })).toThrow(RequestValidationError);
  });

  it("throws on invalid loopMode", () => {
    expect(() => parseChatRequest({ message: "hi", loopMode: "turbo" })).toThrow(RequestValidationError);
  });

  it("throws on null body", () => {
    expect(() => parseChatRequest(null)).toThrow(RequestValidationError);
  });
});

describe("parseApproveRequest", () => {
  it("parses approve action", () => {
    const result = parseApproveRequest({ action: "approve" }, { id: "approval-123" });
    expect(result.id).toBe("approval-123");
    expect(result.action).toBe("approve");
  });

  it("parses reject action", () => {
    const result = parseApproveRequest({ action: "reject" }, { id: "a-1" });
    expect(result.action).toBe("reject");
  });

  it("defaults to approve", () => {
    const result = parseApproveRequest({}, { id: "a-1" });
    expect(result.action).toBe("approve");
  });

  it("throws on missing id", () => {
    expect(() => parseApproveRequest({}, {})).toThrow(RequestValidationError);
  });
});

describe("parseToggleTaskRequest", () => {
  it("parses with enabled true", () => {
    const result = parseToggleTaskRequest({ enabled: true }, { id: "task-1" });
    expect(result.id).toBe("task-1");
    expect(result.enabled).toBe(true);
  });

  it("parses with enabled false", () => {
    const result = parseToggleTaskRequest({ enabled: false }, { id: "task-1" });
    expect(result.enabled).toBe(false);
  });

  it("defaults enabled to true", () => {
    const result = parseToggleTaskRequest({}, { id: "task-1" });
    expect(result.enabled).toBe(true);
  });

  it("throws on missing id", () => {
    expect(() => parseToggleTaskRequest({}, {})).toThrow(RequestValidationError);
  });
});

describe("parseLoopStartRequest", () => {
  it("parses valid request", () => {
    const result = parseLoopStartRequest({ mode: "full", intervalMs: 60000 });
    expect(result.mode).toBe("full");
    expect(result.intervalMs).toBe(60000);
  });

  it("defaults intervalMs", () => {
    const result = parseLoopStartRequest({ mode: "restricted" });
    expect(result.intervalMs).toBe(300000);
  });

  it("throws on missing mode", () => {
    expect(() => parseLoopStartRequest({})).toThrow(RequestValidationError);
  });

  it("throws on invalid mode", () => {
    expect(() => parseLoopStartRequest({ mode: "turbo" })).toThrow(RequestValidationError);
  });

  it("throws on intervalMs below min 30s", () => {
    expect(() => parseLoopStartRequest({ mode: "full", intervalMs: 1000 })).toThrow(RequestValidationError);
  });
});
