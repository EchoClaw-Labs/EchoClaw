import { describe, it, expect } from "vitest";
import {
  parseChatRequest,
  parseApproveRequest,
  parseTelegramConfigRequest,
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

describe("parseTelegramConfigRequest", () => {
  it("parses valid Telegram config", () => {
    const result = parseTelegramConfigRequest({
      botToken: "123456:ABC-DEF_123",
      chatIds: [123456789, "-1001234567890"],
      loopMode: "restricted",
    });

    expect(result.botToken).toBe("123456:ABC-DEF_123");
    expect(result.chatIds).toEqual([123456789, -1001234567890]);
    expect(result.loopMode).toBe("restricted");
  });

  it("defaults loopMode to restricted", () => {
    const result = parseTelegramConfigRequest({
      botToken: "123456:ABC-DEF_123",
      chatIds: [123456789],
    });

    expect(result.loopMode).toBe("restricted");
  });

  it("throws on invalid token format", () => {
    expect(() => parseTelegramConfigRequest({
      botToken: "not-a-telegram-token",
      chatIds: [123456789],
    })).toThrow(RequestValidationError);
  });

  it("throws on missing chatIds", () => {
    expect(() => parseTelegramConfigRequest({
      botToken: "123456:ABC-DEF_123",
    })).toThrow(RequestValidationError);
  });

  it("throws on non-integer chatIds", () => {
    expect(() => parseTelegramConfigRequest({
      botToken: "123456:ABC-DEF_123",
      chatIds: [123.45],
    })).toThrow(RequestValidationError);
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
