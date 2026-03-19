/**
 * Explore & Advanced catalog API handlers.
 *
 * Returns static catalog items from catalog.ts.
 */

import type { RouteHandler } from "../types.js";
import { jsonResponse, registerRoute } from "../routes.js";
import { EXPLORE_ITEMS, ADVANCED_ITEMS } from "../../commands/echo/catalog.js";

const handleExplore: RouteHandler = async (_req, res) => {
  jsonResponse(res, 200, { items: EXPLORE_ITEMS });
};

const handleAdvanced: RouteHandler = async (_req, res) => {
  jsonResponse(res, 200, { items: ADVANCED_ITEMS });
};

export function registerCatalogRoutes(): void {
  registerRoute("GET", "/api/explore", handleExplore);
  registerRoute("GET", "/api/advanced", handleAdvanced);
}
