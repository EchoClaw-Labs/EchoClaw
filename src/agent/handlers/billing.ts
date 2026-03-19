/**
 * Billing handler — GET /api/agent/billing
 * Returns real ledger balance, burn rate, estimated remaining.
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import { getBillingState } from "../billing.js";
import { getInferenceConfig } from "../engine.js";

export function registerBillingRoutes(): void {
  registerRoute("GET", "/api/agent/billing", async (_req, res) => {
    const config = getInferenceConfig();
    if (!config) {
      errorResponse(res, 503, "NOT_READY", "Agent not initialized");
      return;
    }

    const billing = await getBillingState(config);
    jsonResponse(res, 200, billing);
  });
}
