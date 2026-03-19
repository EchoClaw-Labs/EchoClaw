/**
 * Connect API handlers.
 *
 * Plan/apply for connecting AI runtimes.
 * Reuses assessment and connect logic directly.
 */

import type { RouteHandler } from "../types.js";
import { jsonResponse, registerRoute } from "../routes.js";
import { buildEchoSnapshot } from "../../commands/echo/snapshot.js";
import { buildConnectPayload, normalizeRuntime, defaultScopeForRuntime } from "../../commands/echo/assessment.js";
import { performConnectApply } from "../../commands/echo/connect.js";
import { autoDetectProvider } from "../../providers/registry.js";
import type { ProviderName } from "../../providers/types.js";
import type { EchoScope, ClaudeSettingsScope } from "../../commands/echo/types.js";

function resolveScope(rawScope: unknown, runtime: ProviderName): EchoScope {
  return rawScope === "user" || rawScope === "project"
    ? rawScope
    : defaultScopeForRuntime(runtime);
}

// ── POST /api/connect/plan ───────────────────────────────────────

const handlePlan: RouteHandler = async (_req, res, params) => {
  const runtime = params.body?.runtime
    ? normalizeRuntime(params.body.runtime as string)
    : autoDetectProvider().name;
  const scope = resolveScope(params.body?.scope, runtime);
  const allowWallet = params.body?.allowWalletMutation === true;

  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh: true });
  const payload = buildConnectPayload(snapshot, runtime, scope, allowWallet);
  jsonResponse(res, 200, { ...payload, defaultScope: defaultScopeForRuntime(runtime) });
};

// ── POST /api/connect/apply ──────────────────────────────────────

const handleApply: RouteHandler = async (_req, res, params) => {
  const runtime = params.body?.runtime
    ? normalizeRuntime(params.body.runtime as string)
    : autoDetectProvider().name;
  const scope = resolveScope(params.body?.scope, runtime);
  const claudeScope = (params.body?.claudeScope as ClaudeSettingsScope) ?? "project-local";

  const result = await performConnectApply({
    runtime: runtime as ProviderName,
    scope,
    force: params.body?.force === true,
    allowWalletMutation: params.body?.allowWalletMutation === true,
    claudeScope,
    startProxy: params.body?.startProxy !== false,
  });

  jsonResponse(res, 200, {
    ...result.payload,
    status: result.payload.status === "ready" ? "applied" : result.payload.status,
    appliedActions: result.appliedActions,
    createdWalletAddress: result.createdWalletAddress,
    warnings: result.warnings,
  });
};

// ── Registration ─────────────────────────────────────────────────

export function registerConnectRoutes(): void {
  registerRoute("POST", "/api/connect/plan", handlePlan);
  registerRoute("POST", "/api/connect/apply", handleApply);
}
