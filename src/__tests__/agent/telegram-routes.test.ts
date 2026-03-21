import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const registeredHandlers = new Map<string, (...args: any[]) => any>();

const mockSaveConfig = vi.fn();
const mockSetEnabled = vi.fn();
const mockClearConfig = vi.fn();
const mockGetConfig = vi.fn();
const mockStartTelegram = vi.fn();
const mockStopTelegram = vi.fn();
const mockRestartTelegram = vi.fn();
const mockGetTelegramStatus = vi.fn();
const mockGetPollerStatus = vi.fn();
const mockGetMe = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("../../agent/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: any) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: any, status: number, body: any) => {
    res._status = status;
    res._body = body;
  }),
  errorResponse: vi.fn((res: any, status: number, code: string, message: string) => {
    res._status = status;
    res._body = { error: { code, message } };
  }),
}));

vi.mock("../../agent/db/repos/telegram.js", () => ({
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  setEnabled: (...args: unknown[]) => mockSetEnabled(...args),
  clearConfig: (...args: unknown[]) => mockClearConfig(...args),
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

vi.mock("../../agent/telegram/index.js", () => ({
  startTelegram: (...args: unknown[]) => mockStartTelegram(...args),
  stopTelegram: (...args: unknown[]) => mockStopTelegram(...args),
  restartTelegram: (...args: unknown[]) => mockRestartTelegram(...args),
  getTelegramStatus: (...args: unknown[]) => mockGetTelegramStatus(...args),
}));

vi.mock("../../agent/telegram/poller.js", () => ({
  getPollerStatus: (...args: unknown[]) => mockGetPollerStatus(...args),
}));

vi.mock("grammy", () => ({
  Bot: class MockBot {
    api = {
      getMe: (...args: unknown[]) => mockGetMe(...args),
      sendMessage: vi.fn(),
    };
  },
}));

vi.mock("../../utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { registerTelegramRoutes } = await import("../../agent/handlers/telegram.js");
registerTelegramRoutes();

function makeRes(): ServerResponse & { _status: number; _body: unknown } {
  return { _status: 0, _body: null } as ServerResponse & { _status: number; _body: unknown };
}

function makeParams(body: Record<string, unknown> | null = null): {
  pathParams: Record<string, string>;
  body: Record<string, unknown> | null;
} {
  return { pathParams: {}, body };
}

describe("telegram routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestartTelegram.mockResolvedValue(true);
    mockGetPollerStatus.mockReturnValue({ connected: true, botUsername: "echo_bot" });
    mockGetMe.mockResolvedValue({ username: "echo_bot" });
    mockGetConfig.mockResolvedValue({
      botToken: "123456:ABC-DEF_123",
      authorizedChatIds: [123456789],
      loopMode: "restricted",
      enabled: true,
    });
    mockGetTelegramStatus.mockResolvedValue({
      configured: true,
      enabled: true,
      connected: true,
      botUsername: "echo_bot",
      authorizedChatIds: [123456789],
      loopMode: "restricted",
    });
  });

  it("rejects invalid Telegram tokens before saving config", async () => {
    mockGetMe.mockRejectedValue(new Error("401 Unauthorized"));
    const handler = registeredHandlers.get("POST /api/agent/telegram/configure");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({
      botToken: "123456:ABC-DEF_123",
      chatIds: [123456789],
      loopMode: "restricted",
    }));

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: {
        code: "INVALID_TOKEN",
        message: expect.stringContaining("Telegram rejected this token"),
      },
    });
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(mockSetEnabled).not.toHaveBeenCalled();
    expect(mockRestartTelegram).not.toHaveBeenCalled();
  });

  it("saves config only after token validation succeeds", async () => {
    const handler = registeredHandlers.get("POST /api/agent/telegram/configure");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({
      botToken: "123456:ABC-DEF_123",
      chatIds: [123456789, -100987654321],
      loopMode: "full",
    }));

    expect(mockSaveConfig).toHaveBeenCalledWith(
      "123456:ABC-DEF_123",
      [123456789, -100987654321],
      "full",
    );
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    expect(mockRestartTelegram).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      ok: true,
      enabled: true,
      connected: true,
      botUsername: "echo_bot",
    });
  });

  it("returns status payload from telegram index", async () => {
    const handler = registeredHandlers.get("GET /api/agent/telegram/status");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams());

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      configured: true,
      enabled: true,
      connected: true,
      botUsername: "echo_bot",
      authorizedChatIds: [123456789],
      loopMode: "restricted",
    });
  });
});
