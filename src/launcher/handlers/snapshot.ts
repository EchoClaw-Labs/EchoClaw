/**
 * Status & diagnostic API handlers.
 *
 * Wraps existing snapshot, doctor, verify, and support-report
 * functions as HTTP endpoints. Zero logic duplication.
 */

import type { RouteHandler } from "../types.js";
import { jsonResponse } from "../routes.js";
import { registerRoute } from "../routes.js";
import { buildEchoSnapshot } from "../../commands/echo/snapshot.js";
import { buildDoctorChecks } from "../../commands/echo/doctor.js";
import { buildSupportReport } from "../../commands/echo/support-report.js";
import { buildConnectPayload, buildVerifyPayload, normalizeRuntime, defaultScopeForRuntime } from "../../commands/echo/assessment.js";
import { autoDetectProvider } from "../../providers/registry.js";
import type { RoutingDecision } from "../types.js";

// ── GET /api/snapshot ────────────────────────────────────────────

const handleSnapshot: RouteHandler = async (_req, res, params) => {
  const fresh = params.query.fresh === "1" || params.query.fresh === "true";
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  jsonResponse(res, 200, snapshot);
};

// ── GET /api/doctor ──────────────────────────────────────────────

const handleDoctor: RouteHandler = async (_req, res, params) => {
  const fresh = params.query.fresh === "1" || params.query.fresh === "true";
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh });
  const checks = await buildDoctorChecks(snapshot);
  jsonResponse(res, 200, { checks, snapshot });
};

// ── GET /api/verify ──────────────────────────────────────────────

const handleVerify: RouteHandler = async (_req, res, params) => {
  const runtime = params.query.runtime
    ? normalizeRuntime(params.query.runtime)
    : autoDetectProvider().name;
  const snapshot = await buildEchoSnapshot({ includeReadiness: true, fresh: true });
  const payload = buildVerifyPayload(snapshot, runtime);
  jsonResponse(res, 200, payload);
};

// ── GET /api/support-report ──────────────────────────────────────

const handleSupportReport: RouteHandler = async (_req, res) => {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true });
  const report = buildSupportReport(snapshot);
  jsonResponse(res, 200, report);
};

// ── GET /api/routing ─────────────────────────────────────────────

const handleRouting: RouteHandler = async (_req, res) => {
  const snapshot = await buildEchoSnapshot({ includeReadiness: true });
  const runtime = autoDetectProvider().name;
  const connectPayload = buildConnectPayload(snapshot, runtime, defaultScopeForRuntime(runtime));

  let decision: RoutingDecision;

  if (!snapshot.wallet.configuredAddress && !snapshot.wallet.keystorePresent) {
    decision = { mode: "wizard", reason: "no_wallet" };
  } else if (!snapshot.configExists) {
    decision = { mode: "wizard", reason: "no_config" };
  } else if (connectPayload.status !== "ready") {
    decision = { mode: "dashboard", reason: "setup_incomplete" };
  } else {
    decision = { mode: "dashboard", reason: "ready" };
  }

  jsonResponse(res, 200, decision);
};

// ── Registration ─────────────────────────────────────────────────

export function registerSnapshotRoutes(): void {
  registerRoute("GET", "/api/snapshot", handleSnapshot);
  registerRoute("GET", "/api/doctor", handleDoctor);
  registerRoute("GET", "/api/verify", handleVerify);
  registerRoute("GET", "/api/support-report", handleSupportReport);
  registerRoute("GET", "/api/routing", handleRouting);
}
