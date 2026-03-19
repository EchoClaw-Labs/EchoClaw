/**
 * Tavily API key management for launcher.
 *
 * GET  /api/tavily/status — check if key is configured
 * POST /api/tavily/key    — save key to .env + restart agent if running
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import { loadProviderDotenv, writeAppEnvValue } from "../../providers/env-resolution.js";
import { isAgentRunning, runAgentCompose } from "../../agent/compose.js";
import logger from "../../utils/logger.js";

export function registerTavilyRoutes(): void {
  registerRoute("GET", "/api/tavily/status", async (_req, res) => {
    loadProviderDotenv();
    const key = process.env.TAVILY_API_KEY ?? "";
    jsonResponse(res, 200, {
      configured: key.length > 0,
    });
  });

  registerRoute("POST", "/api/tavily/key", async (_req, res, params) => {
    const body = params.body as { key?: string } | undefined;
    const key = body?.key?.trim() ?? "";

    if (!key) {
      errorResponse(res, 400, "MISSING_KEY", "API key is required");
      return;
    }

    if (!key.startsWith("tvly-") || key.length < 20) {
      errorResponse(res, 400, "INVALID_KEY", "Key must start with tvly- and be at least 20 characters. Get one at https://tavily.com");
      return;
    }

    try {
      writeAppEnvValue("TAVILY_API_KEY", key);
      process.env.TAVILY_API_KEY = key;
      logger.info("tavily.key.saved");

      // Restart agent if running so it picks up the new env
      const agentWasRunning = isAgentRunning();
      let restarted = false;
      if (agentWasRunning) {
        try {
          loadProviderDotenv();
          runAgentCompose(["restart", "agent"], { stdio: "pipe", timeoutMs: 30_000 });
          restarted = true;
        } catch {
          logger.warn("tavily.agent_restart.failed");
        }
      }

      jsonResponse(res, 200, { saved: true, agentRestarted: restarted, agentWasRunning });
    } catch (err) {
      errorResponse(res, 500, "SAVE_FAILED", err instanceof Error ? err.message : "Failed to save key");
    }
  });
}
