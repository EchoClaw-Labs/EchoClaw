import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EchoSnapshot } from "../commands/echo/snapshot.js";
import type { ProviderName } from "../providers/types.js";

/**
 * Tests the routing decision logic from src/launcher/handlers/snapshot.ts.
 *
 * The handler is not directly exported, so we replicate the pure decision
 * logic inline (same three-branch check) and verify it with mock snapshots.
 * We also test the underlying `buildConnectPayload` + `defaultScopeForRuntime`
 * functions that feed the routing decision.
 */

vi.mock("../providers/registry.js", () => ({
  autoDetectProvider: () => ({ name: "openclaw" }),
  detectProviders: () => ({
    openclaw: { detected: true },
    "claude-code": { detected: false },
    codex: { detected: false },
    other: { detected: true },
  }),
  resolveProvider: (name: string) => ({
    name,
    displayName: name,
    installSkill: () => ({ source: "/mock", target: "/mock" }),
    getSkillTargets: () => ({ userDir: "/mock", projectDir: null }),
    getRestartInfo: () => ({ instructions: [] }),
  }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../openclaw/config.js", () => ({
  getOpenclawHome: () => "/mock/.openclaw",
  loadOpenclawConfig: () => null,
}));

const { buildConnectPayload, defaultScopeForRuntime } = await import(
  "../commands/echo/assessment.js"
);

// ── Routing decision logic (mirrors snapshot.ts handleRouting) ───────

interface RoutingDecision {
  mode: "wizard" | "dashboard";
  reason: string;
}

function computeRoutingDecision(
  snapshot: EchoSnapshot,
  runtime: ProviderName,
): RoutingDecision {
  const connectPayload = buildConnectPayload(
    snapshot,
    runtime,
    defaultScopeForRuntime(runtime),
  );

  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent) {
    return { mode: "wizard", reason: "no_wallet" };
  }
  if (!snapshot.configExists) {
    return { mode: "wizard", reason: "no_config" };
  }
  if (connectPayload.status !== "ready") {
    return { mode: "dashboard", reason: "setup_incomplete" };
  }
  return { mode: "dashboard", reason: "ready" };
}

// ── Snapshot factory ────────────────────────────────────────────────

function makeSnapshot(overrides: {
  walletAddress?: string | null;
  keystorePresent?: boolean;
  configExists?: boolean;
  skillLinked?: boolean;
  computeReady?: boolean;
}): EchoSnapshot {
  const allChecksOk = overrides.computeReady !== false;
  const check = (ok: boolean) => ({ ok, detail: ok ? "ok" : "fail" });

  return {
    generatedAt: new Date().toISOString(),
    version: "0.0.0-test",
    configExists: overrides.configExists ?? true,
    wallet: {
      configuredAddress: overrides.walletAddress ?? null,
      keystorePresent: overrides.keystorePresent ?? false,
      evmAddress: overrides.walletAddress ?? null,
      evmKeystorePresent: overrides.keystorePresent ?? false,
      solanaAddress: null,
      solanaKeystorePresent: false,
      password: { status: "ok" as const, driftSources: [] },
      decryptable: true,
    },
    runtimes: {
      recommended: "openclaw" as ProviderName,
      detected: {
        openclaw: { detected: true },
        "claude-code": { detected: false },
        codex: { detected: false },
        other: { detected: true },
      } as any,
      skills: [
        {
          provider: "openclaw" as ProviderName,
          sourcePath: "/mock",
          userTarget: "/mock",
          userLinked: overrides.skillLinked ?? false,
          projectTarget: null,
          projectLinked: false,
          manualOnly: false,
        },
      ],
    },
    compute: {
      state: allChecksOk
        ? { activeProvider: "0xPROVIDER", model: "test", configuredAt: Date.now() }
        : null,
      readiness: allChecksOk
        ? {
            ready: true,
            provider: "0xPROVIDER",
            checks: {
              wallet: check(true),
              broker: check(true),
              ledger: check(true),
              subAccount: check(true),
              ack: check(true),
              openclawConfig: check(true),
            },
          }
        : null,
    },
    claude: {
      configured: false,
      running: false,
      healthy: false,
      pid: null,
      port: 0,
      authConfigured: false,
      provider: null,
      model: null,
      providerEndpoint: null,
      logFile: "",
      settings: {
        projectLocal: { path: "", exists: false },
        projectShared: { path: "", exists: false },
        user: { path: "", exists: false },
      },
    },
    monitor: { running: false, pid: null },
    solanaCluster: "mainnet-beta",
    solanaRpcUrl: "https://api.mainnet-beta.solana.com",
    jupiterApiKeySet: false,
  } as EchoSnapshot;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("launcher routing decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no wallet, no keystore -> wizard / no_wallet", () => {
    const snapshot = makeSnapshot({
      walletAddress: null,
      keystorePresent: false,
      configExists: true,
    });
    const decision = computeRoutingDecision(snapshot, "openclaw");
    expect(decision.mode).toBe("wizard");
    expect(decision.reason).toBe("no_wallet");
  });

  it("wallet exists, no config -> wizard / no_config", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: false,
    });
    const decision = computeRoutingDecision(snapshot, "openclaw");
    expect(decision.mode).toBe("wizard");
    expect(decision.reason).toBe("no_config");
  });

  it("wallet + config but connect not ready -> dashboard / setup_incomplete", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: true,
      skillLinked: false,
      computeReady: false,
    });
    const decision = computeRoutingDecision(snapshot, "openclaw");
    expect(decision.mode).toBe("dashboard");
    expect(decision.reason).toBe("setup_incomplete");
  });

  it("everything ready -> dashboard / ready", () => {
    const snapshot = makeSnapshot({
      walletAddress: "0x1234",
      keystorePresent: true,
      configExists: true,
      skillLinked: true,
      computeReady: true,
    });
    const decision = computeRoutingDecision(snapshot, "openclaw");
    expect(decision.mode).toBe("dashboard");
    expect(decision.reason).toBe("ready");
  });
});

describe("defaultScopeForRuntime", () => {
  it('returns "user" for openclaw', () => {
    expect(defaultScopeForRuntime("openclaw")).toBe("user");
  });

  it('returns "project" for claude-code', () => {
    expect(defaultScopeForRuntime("claude-code")).toBe("project");
  });

  it('returns "project" for codex', () => {
    expect(defaultScopeForRuntime("codex")).toBe("project");
  });
});
