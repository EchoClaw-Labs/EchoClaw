import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { RouteParams } from "../launcher/types.js";

const registeredHandlers = new Map<string, (...args: any[]) => any>();

const mockBuildEchoSnapshot = vi.fn();
const mockBuildConnectPayload = vi.fn();
const mockDefaultScopeForRuntime = vi.fn();
const mockPerformConnectApply = vi.fn();

vi.mock("../launcher/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: any) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: any, status: number, body: any) => {
    res._status = status;
    res._body = body;
  }),
}));

vi.mock("../commands/echo/snapshot.js", () => ({
  buildEchoSnapshot: (...args: any[]) => mockBuildEchoSnapshot(...args),
}));

vi.mock("../commands/echo/assessment.js", () => ({
  buildConnectPayload: (...args: any[]) => mockBuildConnectPayload(...args),
  normalizeRuntime: (value: string) => value,
  defaultScopeForRuntime: (...args: any[]) => mockDefaultScopeForRuntime(...args),
}));

vi.mock("../commands/echo/connect.js", () => ({
  performConnectApply: (...args: any[]) => mockPerformConnectApply(...args),
}));

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { registerConnectRoutes } = await import("../launcher/handlers/connect.js");
registerConnectRoutes();

function makeRes(): any {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown> | null = null): RouteParams {
  return { segments: {}, query: {}, body };
}

describe("connect handlers default scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultScopeForRuntime.mockImplementation((runtime: string) => runtime === "openclaw" ? "user" : "project");
    mockBuildEchoSnapshot.mockResolvedValue({ snapshot: true });
    mockBuildConnectPayload.mockReturnValue({ status: "needs_action", summary: "todo", scope: "user" });
    mockPerformConnectApply.mockResolvedValue({
      payload: { status: "ready", summary: "ok" },
      appliedActions: [],
      createdWalletAddress: null,
      warnings: [],
    });
  });

  it("plan uses runtime default scope when scope is omitted", async () => {
    const handler = registeredHandlers.get("POST /api/connect/plan");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ runtime: "openclaw" }));

    expect(mockBuildConnectPayload).toHaveBeenCalledWith({ snapshot: true }, "openclaw", "user", false);
    expect(res._body.defaultScope).toBe("user");
  });

  it("apply uses runtime default scope when scope is omitted", async () => {
    const handler = registeredHandlers.get("POST /api/connect/apply");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ runtime: "openclaw" }));

    expect(mockPerformConnectApply).toHaveBeenCalledWith(expect.objectContaining({
      runtime: "openclaw",
      scope: "user",
      claudeScope: "project-local",
      startProxy: true,
    }));
    expect(res._body.status).toBe("applied");
  });

  it("respects explicit scope overrides", async () => {
    const handler = registeredHandlers.get("POST /api/connect/plan");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ runtime: "openclaw", scope: "project" }));

    expect(mockBuildConnectPayload).toHaveBeenCalledWith({ snapshot: true }, "openclaw", "project", false);
  });
});
