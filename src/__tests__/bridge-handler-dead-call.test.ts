import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { RouteParams } from "../launcher/types.js";

const registeredHandlers = new Map<string, (...args: any[]) => any>();

const mockGetQuotes = vi.fn();
const mockBuildDeposit = vi.fn();
const mockExecuteDepositPlan = vi.fn();
const mockGetCachedKhalaniChains = vi.fn();

vi.mock("../launcher/routes.js", () => ({
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

vi.mock("../khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getQuotes: (...args: any[]) => mockGetQuotes(...args),
    buildDeposit: (...args: any[]) => mockBuildDeposit(...args),
  }),
}));

vi.mock("../khalani/chains.js", () => ({
  getCachedKhalaniChains: (...args: any[]) => mockGetCachedKhalaniChains(...args),
}));

vi.mock("../commands/khalani/request.js", () => ({
  prepareQuoteRequest: vi.fn(),
}));

vi.mock("../commands/khalani/helpers.js", () => ({
  resolveRouteBestIndex: vi.fn(),
}));

vi.mock("../commands/khalani/bridge-executor.js", () => ({
  executeDepositPlan: (...args: any[]) => mockExecuteDepositPlan(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { registerBridgeRoutes } = await import("../launcher/handlers/bridge.js");
registerBridgeRoutes();

function makeRes(): any {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown>): RouteParams {
  return { segments: {}, query: {}, body };
}

describe("bridge deposit submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedKhalaniChains.mockResolvedValue([{ id: 1, name: "Ethereum", type: "evm" }]);
    mockBuildDeposit.mockResolvedValue({ plan: true });
    mockExecuteDepositPlan.mockResolvedValue({ orderId: "order-1", txHash: "0xabc" });
  });

  it("builds and executes deposit without calling getQuotes", async () => {
    const handler = registeredHandlers.get("POST /api/bridge/deposit-submit");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({
      quoteId: "quote-1",
      routeId: "route-1",
      sourceChainId: 1,
      from: "0x1234",
      depositMethod: "TRANSFER",
    }));

    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(mockBuildDeposit).toHaveBeenCalledWith({
      from: "0x1234",
      quoteId: "quote-1",
      routeId: "route-1",
      depositMethod: "TRANSFER",
    });
    expect(mockExecuteDepositPlan).toHaveBeenCalled();
    expect(res._body.status).toBe("applied");
  });
});
