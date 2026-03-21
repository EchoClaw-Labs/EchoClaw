/**
 * Agent config endpoint — minimal, read-only.
 * Exposes runtime configuration status for the UI.
 */

import { registerRoute, jsonResponse } from "../routes.js";
import * as telegramRepo from "../db/repos/telegram.js";

export function registerConfigRoutes(): void {
  registerRoute("GET", "/api/agent/config", async (_req, res) => {
    const tgConfig = await telegramRepo.getConfig();
    jsonResponse(res, 200, {
      tavilyConfigured: !!process.env.TAVILY_API_KEY,
      telegramConfigured: !!tgConfig.botToken,
    });
  });
}
