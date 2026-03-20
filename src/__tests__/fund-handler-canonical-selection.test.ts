import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { RouteParams } from "../launcher/types.js";

const registeredHandlers = new Map<string, (...args: any[]) => any>();

const mockBuildFundView = vi.fn();
const mockReadProviderSelection = vi.fn();
const mockBuildFundPayload = vi.fn();
const mockListChatServices = vi.fn();
const mockGetAuthenticatedBroker = vi.fn();
const mockResolvePreferredComputeSelection = vi.fn();
const mockSelectFundProvider = vi.fn();
const mockCreateCanonicalApiKey = vi.fn();

vi.mock("../launcher/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: any) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: any, status: number, body: any) => {
    res._status = status;
    res._body = body;
  }),
  errorResponse: vi.fn((res: any, status: number, code: string, message: string, hint?: string) => {
    res._status = status;
    res._body = { error: { code, message, ...(hint ? { hint } : {}) } };
  }),
}));

vi.mock("../commands/echo/fund.js", () => ({
  buildFundView: (...args: any[]) => mockBuildFundView(...args),
  readProviderSelection: (...args: any[]) => mockReadProviderSelection(...args),
}));

vi.mock("../commands/echo/fund-assessment.js", () => ({
  buildFundPayload: (...args: any[]) => mockBuildFundPayload(...args),
}));

vi.mock("../0g-compute/operations.js", () => ({
  listChatServices: (...args: any[]) => mockListChatServices(...args),
  depositToLedger: vi.fn(),
  fundProvider: vi.fn(),
  ackWithReadback: vi.fn(),
}));

vi.mock("../0g-compute/pricing.js", () => ({
  calculateProviderPricing: vi.fn(),
  formatPricePerMTokens: vi.fn(),
}));

vi.mock("../0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: (...args: any[]) => mockGetAuthenticatedBroker(...args),
  resetAuthenticatedBroker: vi.fn(),
}));

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
}));

vi.mock("../commands/echo/assessment.js", () => ({
  normalizeRuntime: (value: string) => value,
}));

vi.mock("../commands/echo/compute-selection.js", () => ({
  resolvePreferredComputeSelection: (...args: any[]) => mockResolvePreferredComputeSelection(...args),
}));

vi.mock("../commands/echo/fund-apply.js", () => ({
  selectFundProvider: (...args: any[]) => mockSelectFundProvider(...args),
  createCanonicalApiKey: (...args: any[]) => mockCreateCanonicalApiKey(...args),
}));

vi.mock("../errors.js", async () => {
  const actual = await vi.importActual<typeof import("../errors.js")>("../errors.js");
  return actual;
});

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { registerFundRoutes } = await import("../launcher/handlers/fund.js");
registerFundRoutes();

function makeRes(): any {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown> | null = null): RouteParams {
  return { segments: {}, query: {}, body };
}

const BROKER = { id: "broker" };
const SERVICE_A = { provider: "0xAAA", model: "model-a", url: "https://a.example.com/v1", inputPrice: 1n, outputPrice: 2n };
const SERVICE_B = { provider: "0xBBB", model: "model-b", url: "https://b.example.com/v1", inputPrice: 1n, outputPrice: 2n };

const SELECTION_A = {
  provider: SERVICE_A.provider,
  model: SERVICE_A.model,
  endpoint: SERVICE_A.url,
  source: "compute-state" as const,
};

describe("fund handlers delegation to shared helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedBroker.mockResolvedValue(BROKER);
    mockListChatServices.mockResolvedValue([SERVICE_A, SERVICE_B]);
    mockResolvePreferredComputeSelection.mockReturnValue(SELECTION_A);
    mockSelectFundProvider.mockResolvedValue({
      selection: SELECTION_A,
      authState: {
        requiresApiKeyRotation: false,
        selectionWarning: null,
        runtimes: {
          claude: { configured: true, hasAuth: true, providerMatch: true },
          openclaw: { configured: true, hasAuth: true, providerMatch: true },
        },
      },
      wasProviderChanged: false,
    });
    mockCreateCanonicalApiKey.mockResolvedValue({
      apiKey: { tokenId: 7, rawToken: "raw-token", createdAt: 0, expiresAt: 0 },
      selection: SELECTION_A,
      claudeTokenSaved: false,
      openclawPatched: false,
      warnings: [],
    });
  });

  // ── select-provider ──────────────────────────────────────────

  it("select-provider delegates to selectFundProvider", async () => {
    const handler = registeredHandlers.get("POST /api/fund/select-provider");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ provider: SERVICE_A.provider }));

    expect(mockSelectFundProvider).toHaveBeenCalledWith(SERVICE_A.provider, [SERVICE_A, SERVICE_B]);
    expect(res._status).toBe(200);
    expect(res._body.provider).toBe(SERVICE_A.provider);
    expect(res._body.model).toBe(SERVICE_A.model);
  });

  it("select-provider returns 400 when provider is missing", async () => {
    const handler = registeredHandlers.get("POST /api/fund/select-provider");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(mockSelectFundProvider).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });

  it("select-provider maps EchoError to 404", async () => {
    const { EchoError, ErrorCodes } = await import("../errors.js");
    mockSelectFundProvider.mockRejectedValue(
      new EchoError(ErrorCodes.ZG_PROVIDER_NOT_FOUND, "Not live"),
    );

    const handler = registeredHandlers.get("POST /api/fund/select-provider");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ provider: "0xDEAD" }));

    expect(res._status).toBe(404);
    expect(res._body.error.code).toBe("ZG_PROVIDER_NOT_FOUND");
  });

  // ── api-key ──────────────────────────────────────────────────

  it("api-key delegates to createCanonicalApiKey with resolved selection", async () => {
    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ tokenId: 7 }));

    expect(mockCreateCanonicalApiKey).toHaveBeenCalledWith({
      broker: BROKER,
      selection: SELECTION_A,
      tokenId: 7,
      saveClaudeToken: false,
      patchOpenclaw: false,
    });
    expect(res._status).toBe(200);
    expect(res._body.provider).toBe(SERVICE_A.provider);
    expect(res._body.model).toBe(SERVICE_A.model);
  });

  it("api-key rejects stale provider payload when canonical selection changed", async () => {
    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ provider: SERVICE_B.provider, tokenId: 7 }));

    expect(mockCreateCanonicalApiKey).not.toHaveBeenCalled();
    expect(res._status).toBe(409);
    expect(res._body.error.code).toBe("STALE_PROVIDER_SELECTION");
  });

  it("api-key passes saveClaudeToken and patchOpenclaw flags", async () => {
    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({
      tokenId: 0, saveClaudeToken: true, patchOpenclaw: true,
    }));

    expect(mockCreateCanonicalApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ saveClaudeToken: true, patchOpenclaw: true }),
    );
  });

  it("api-key returns warning summary when OpenClaw patch needs attention", async () => {
    mockCreateCanonicalApiKey.mockResolvedValue({
      apiKey: { tokenId: 7, rawToken: "raw-token", createdAt: 0, expiresAt: 0 },
      selection: SELECTION_A,
      claudeTokenSaved: false,
      openclawPatched: false,
      warnings: ["API key created, but OpenClaw config patch failed: write failed"],
    });

    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ tokenId: 7 }));

    expect(res._status).toBe(200);
    expect(res._body.summary).toContain("OpenClaw config patch failed");
    expect(res._body.warnings).toEqual(["API key created, but OpenClaw config patch failed: write failed"]);
  });

  it("api-key returns 404 when no live providers", async () => {
    mockResolvePreferredComputeSelection.mockReturnValue(null);

    const handler = registeredHandlers.get("POST /api/fund/api-key");
    const res = makeRes();

    await handler?.({} as IncomingMessage, res, makeParams({ tokenId: 0 }));

    expect(res._status).toBe(404);
    expect(res._body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});
