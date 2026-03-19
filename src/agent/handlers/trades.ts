/**
 * Trade history handlers (Postgres-backed).
 */

import { registerRoute, jsonResponse } from "../routes.js";
import * as tradesRepo from "../db/repos/trades.js";

export function registerTradesRoutes(): void {
  registerRoute("GET", "/api/agent/trades", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const type = url.searchParams.get("type") ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const result = await tradesRepo.getTrades(type, limit, offset);
    jsonResponse(res, 200, { ...result, offset, limit });
  });

  registerRoute("GET", "/api/agent/trades/summary", async (_req, res) => {
    const summary = await tradesRepo.getTradesSummary();
    jsonResponse(res, 200, summary);
  });

  registerRoute("GET", "/api/agent/trades/recent", async (_req, res) => {
    const url = new URL(_req.url ?? "/", "http://localhost");
    const count = Math.min(Math.max(parseInt(url.searchParams.get("count") ?? "5", 10) || 5, 1), 100);

    const [trades, summary] = await Promise.all([
      tradesRepo.getRecentTrades(count),
      tradesRepo.getTradesSummary(),
    ]);

    jsonResponse(res, 200, { trades, summary });
  });
}
