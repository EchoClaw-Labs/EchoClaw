import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    claude: {
      provider: "0xprovider",
      model: "openai/gpt-oss-120b",
      providerEndpoint: "https://broker.example/v1/proxy",
      proxyPort: 4101,
    },
  })),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../config/store.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../utils/logger.js", () => ({
  default: mocks.logger,
}));

const { createProxyRequestHandler, normalizeRoutePath, resolveClaudeModel } = await import("../claude/proxy.js");

type MockRequest = EventEmitter & {
  method?: string;
  url?: string;
  headers: Record<string, string>;
};

type MockResponse = {
  statusCode: number;
  headers: Record<string, string | number>;
  body: string;
  writableEnded: boolean;
  writeHead: (status: number, headers: Record<string, string | number>) => MockResponse;
  write: (chunk: string) => void;
  end: (chunk?: string) => void;
};

function createMockRequest(
  method: string,
  url: string,
  body = "",
  headers: Record<string, string> = {},
): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.method = method;
  req.url = url;
  req.headers = headers;

  queueMicrotask(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });

  return req;
}

function createMockResponse(): { res: MockResponse; done: Promise<void> } {
  let resolveEnd!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });

  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    writableEnded: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    write(chunk) {
      this.body += chunk;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
      this.writableEnded = true;
      resolveEnd();
    },
  };

  return { res, done };
}

describe("claude proxy routing", () => {
  const previousToken = process.env.ZG_CLAUDE_AUTH_TOKEN;

  beforeEach(() => {
    process.env.ZG_CLAUDE_AUTH_TOKEN = "app-sk-test";
    mocks.loadConfig.mockClear();
    mocks.logger.info.mockClear();
    mocks.logger.debug.mockClear();
    mocks.logger.warn.mockClear();
    mocks.logger.error.mockClear();
  });

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env.ZG_CLAUDE_AUTH_TOKEN;
    } else {
      process.env.ZG_CLAUDE_AUTH_TOKEN = previousToken;
    }
  });

  it("normalizes route paths by stripping query strings", () => {
    expect(normalizeRoutePath("/v1/messages?beta=true")).toBe("/v1/messages");
    expect(normalizeRoutePath("/v1/messages/count_tokens?x=1")).toBe("/v1/messages/count_tokens");
    expect(normalizeRoutePath("/health/")).toBe("/health/");
  });

  it("maps branded Claude model labels back to the configured 0G provider model", () => {
    expect(resolveClaudeModel("sonnet", "zai-org/GLM-5-FP8")).toBe("zai-org/GLM-5-FP8");
    expect(resolveClaudeModel("opus", "zai-org/GLM-5-FP8")).toBe("zai-org/GLM-5-FP8");
    expect(resolveClaudeModel("haiku", "zai-org/GLM-5-FP8")).toBe("zai-org/GLM-5-FP8");
    expect(resolveClaudeModel("0G-zai-org/GLM-5-FP8", "zai-org/GLM-5-FP8")).toBe("zai-org/GLM-5-FP8");
    expect(resolveClaudeModel("custom-model", "zai-org/GLM-5-FP8")).toBe("custom-model");
  });

  it("accepts query parameters on the health route", async () => {
    const handler = createProxyRequestHandler();
    const req = createMockRequest("GET", "/health?beta=true");
    const { res, done } = createMockResponse();

    handler(req as never, res as never);
    await done;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: "ok",
      provider: "0xprovider",
      model: "openai/gpt-oss-120b",
      authConfigured: true,
    });
  });

  it("routes POST /v1/messages?beta=true to the messages handler instead of 404", async () => {
    const handler = createProxyRequestHandler();
    const req = createMockRequest("POST", "/v1/messages?beta=true", "{invalid-json", {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
    const { res, done } = createMockResponse();

    handler(req as never, res as never);
    await done;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      type: "error",
      error: {
        type: "invalid_request",
        message: "Invalid JSON in request body",
      },
    });
  });
});
