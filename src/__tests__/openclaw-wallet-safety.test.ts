import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteParams } from "../launcher/types.js";

/**
 * Tests that handleWallet in src/launcher/handlers/openclaw.ts returns
 * confirm_required when a keystore exists and force is not sent.
 *
 * Since handlers are registered via registerRoute and not directly exported,
 * we capture the handler via a mock of registerRoute, then invoke it.
 */

const mockKeystoreExists = vi.fn();
const mockSolanaKeystoreExists = vi.fn();
const mockCreateWallet = vi.fn();
const mockCreateSolanaWallet = vi.fn();

// Capture registered handlers
const registeredHandlers = new Map<string, (...args: any[]) => any>();

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

vi.mock("../wallet/keystore.js", () => ({
  keystoreExists: (...args: any[]) => mockKeystoreExists(...args),
}));

vi.mock("../wallet/solana-keystore.js", () => ({
  solanaKeystoreExists: (...args: any[]) => mockSolanaKeystoreExists(...args),
}));

vi.mock("../wallet/create.js", () => ({
  createWallet: (...args: any[]) => mockCreateWallet(...args),
}));

vi.mock("../wallet/solana-create.js", () => ({
  createSolanaWallet: (...args: any[]) => mockCreateSolanaWallet(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
  patchOpenclawConfig: vi.fn(),
  patchOpenclawSkillEnv: vi.fn(),
}));

vi.mock("../providers/env-resolution.js", () => ({
  writeAppEnvValue: vi.fn(),
}));

vi.mock("../utils/daemon-spawn.js", () => ({
  spawnDetached: vi.fn(),
  spawnMonitorFromState: vi.fn(() => ({ status: "already_running" })),
}));

vi.mock("../commands/onboard/steps/config.js", () => ({
  configStep: { name: "config", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/openclaw.js", () => ({
  openclawStep: { name: "openclaw", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/password.js", () => ({
  passwordStep: { name: "password", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/webhooks.js", () => ({
  webhooksStep: { name: "webhooks", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/wallet.js", () => ({
  walletStep: { name: "wallet", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/compute.js", () => ({
  computeStep: { name: "compute", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/monitor.js", () => ({
  monitorStep: { name: "monitor", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../commands/onboard/steps/gateway.js", () => ({
  gatewayStep: { name: "gateway", description: "", detect: vi.fn(), run: vi.fn() },
}));

vi.mock("../update/auto-update-preference.js", () => ({
  setAutoUpdatePreference: vi.fn(),
}));

vi.mock("../update/legacy-runtime.js", () => ({
  retireLegacyUpdateDaemon: vi.fn(),
}));

vi.mock("../utils/legacy-cleanup.js", () => ({
  runLegacyCleanupWithLog: vi.fn(),
}));

// Import and register routes so handlers are captured
const { registerOpenClawRoutes } = await import("../launcher/handlers/openclaw.js");
registerOpenClawRoutes();

function makeRes(): any {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown> | null = null): RouteParams {
  return { segments: {}, query: {}, body };
}

describe("handleWallet safety guard", () => {
  let walletHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    walletHandler = registeredHandlers.get("POST /api/openclaw/step/wallet");
    expect(walletHandler).toBeDefined();
  });

  it("EVM keystore exists, no force -> returns confirm_required", async () => {
    mockKeystoreExists.mockReturnValue(true);

    const res = makeRes();
    await walletHandler({} as IncomingMessage, res, makeParams({ chain: "evm" }));

    expect(res._body.status).toBe("confirm_required");
    expect(res._body.reason).toBe("keystore_exists");
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });

  it("EVM keystore exists, force: true -> proceeds to create wallet", async () => {
    mockKeystoreExists.mockReturnValue(true);
    mockCreateWallet.mockResolvedValue({ address: "0xNEW" });

    const res = makeRes();
    await walletHandler({} as IncomingMessage, res, makeParams({ chain: "evm", force: true }));

    expect(mockCreateWallet).toHaveBeenCalledWith({ force: true });
    expect(res._body.status).toBe("applied");
    expect(res._body.address).toBe("0xNEW");
  });

  it("no EVM keystore -> proceeds to create wallet normally", async () => {
    mockKeystoreExists.mockReturnValue(false);
    mockCreateWallet.mockResolvedValue({ address: "0xFRESH" });

    const res = makeRes();
    await walletHandler({} as IncomingMessage, res, makeParams({ chain: "evm" }));

    expect(mockCreateWallet).toHaveBeenCalledWith({ force: false });
    expect(res._body.status).toBe("applied");
    expect(res._body.address).toBe("0xFRESH");
  });
});
