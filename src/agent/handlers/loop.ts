/**
 * Loop control handlers — wired to real scheduler lifecycle.
 *
 * POST /api/agent/loop/start — persist state + start autonomous loop in scheduler
 * POST /api/agent/loop/stop — persist state + stop loop
 * GET  /api/agent/loop/status — read from DB
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as loopRepo from "../db/repos/loop.js";
import { startLoopEngine, stopLoopEngine } from "../scheduler.js";
import { parseLoopStartRequest, RequestValidationError } from "../validation.js";

export function registerLoopRoutes(): void {
  registerRoute("GET", "/api/agent/loop/status", async (_req, res) => {
    const state = await loopRepo.getLoopState();
    jsonResponse(res, 200, state);
  });

  registerRoute("POST", "/api/agent/loop/start", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseLoopStartRequest>;
    try {
      parsed = parseLoopStartRequest(params.body);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { mode, intervalMs } = parsed;

    // Persist + start real loop engine
    await loopRepo.startLoop(mode, intervalMs);
    startLoopEngine(mode, intervalMs);

    jsonResponse(res, 200, { active: true, mode, intervalMs });
  });

  registerRoute("POST", "/api/agent/loop/stop", async (_req, res) => {
    await loopRepo.stopLoop();
    stopLoopEngine();
    jsonResponse(res, 200, { active: false });
  });
}
