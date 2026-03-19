import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { registerRoute, dispatchRoute } from "../../agent/routes.js";

/**
 * Create a mock IncomingMessage (readable stream) with controllable data.
 */
function createMockReq(
  method: string,
  url: string,
  body?: string | Buffer | null,
): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.method = method;
  emitter.url = url;
  emitter.headers = { "content-type": "application/json" };
  // Simulate destroy for abort scenarios
  (emitter as IncomingMessage & { destroy: () => void }).destroy = vi.fn(() => {
    emitter.emit("close");
  });

  // Schedule data emission on next tick so listeners can attach
  if (body !== undefined && body !== null) {
    process.nextTick(() => {
      const buf = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
      emitter.emit("data", buf);
      emitter.emit("end");
    });
  } else {
    process.nextTick(() => {
      emitter.emit("end");
    });
  }

  return emitter;
}

/**
 * Create a mock ServerResponse that captures status and body.
 */
function createMockRes(): ServerResponse & { _status: number; _body: string; _headers: Record<string, string> } {
  const res = {
    _status: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string | number>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res._headers[k.toLowerCase()] = String(v);
        }
      }
      res.headersSent = true;
      return res;
    },
    end(body?: string) {
      if (body) res._body = body;
      return res;
    },
  } as unknown as ServerResponse & { _status: number; _body: string; _headers: Record<string, string> };
  return res;
}

// Register test routes (routes module uses a module-level array, so these persist across tests)
let testRouteRegistered = false;

function ensureTestRoutes(): void {
  if (testRouteRegistered) return;
  testRouteRegistered = true;

  registerRoute("POST", "/test/echo", async (_req, res, { body }) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: body }));
  });

  registerRoute("GET", "/test/hello", async (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "hello" }));
  });

  registerRoute("GET", "/test/items/:id", async (_req, res, { pathParams }) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: pathParams.id }));
  });
}

describe("routes — dispatchRoute", () => {
  beforeEach(() => {
    ensureTestRoutes();
  });

  it("returns 404 for unregistered routes", async () => {
    const req = createMockReq("GET", "/nonexistent");
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(404);
    const body = JSON.parse(res._body);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("dispatches GET routes with no body", async () => {
    const req = createMockReq("GET", "/test/hello");
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.message).toBe("hello");
  });

  it("dispatches POST routes with JSON body", async () => {
    const req = createMockReq("POST", "/test/echo", JSON.stringify({ foo: "bar" }));
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.received).toEqual({ foo: "bar" });
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = createMockReq("POST", "/test/echo", "not-json{{{");
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 for oversized body (> 1 MB)", async () => {
    // Create a body that exceeds 1MB
    const oversizedBody = Buffer.alloc(1_048_577, "x");
    const req = createMockReq("POST", "/test/echo", oversizedBody);
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(413);
    const body = JSON.parse(res._body);
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("extracts path parameters from URL", async () => {
    const req = createMockReq("GET", "/test/items/42");
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.id).toBe("42");
  });

  it("handles POST with empty body as null", async () => {
    // Create a POST request that emits 'end' with no data chunks
    const emitter = new EventEmitter() as IncomingMessage;
    emitter.method = "POST";
    emitter.url = "/test/echo";
    emitter.headers = { "content-type": "application/json" };
    (emitter as IncomingMessage & { destroy: () => void }).destroy = vi.fn();
    process.nextTick(() => {
      emitter.emit("end");
    });

    const res = createMockRes();
    await dispatchRoute(emitter, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.received).toBeNull();
  });

  it("strips query string when matching routes", async () => {
    const req = createMockReq("GET", "/test/hello?foo=bar");
    const res = createMockRes();

    await dispatchRoute(req, res);

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.message).toBe("hello");
  });
});
