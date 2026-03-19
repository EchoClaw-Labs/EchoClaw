/**
 * Agent config endpoint — minimal, read-only.
 * Exposes runtime configuration status for the UI.
 */

import { registerRoute, jsonResponse } from "../routes.js";

export function registerConfigRoutes(): void {
  registerRoute("GET", "/api/agent/config", (_req, res) => {
    jsonResponse(res, 200, {
      tavilyConfigured: !!process.env.TAVILY_API_KEY,
    });
  });
}
