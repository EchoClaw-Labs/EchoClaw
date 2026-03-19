import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";
import logger from "../utils/logger.js";

/** Jaine-specific data directory */
export const JAINE_DIR = join(CONFIG_DIR, "jaine");

/** Pool cache file */
export const POOLS_CACHE_FILE = join(JAINE_DIR, "pools-cache.v1.json");

/** User token aliases file */
export const TOKENS_FILE = join(JAINE_DIR, "tokens.json");

/**
 * Ensure Jaine data directory exists
 */
export function ensureJaineDir(): void {
  if (!existsSync(JAINE_DIR)) {
    mkdirSync(JAINE_DIR, { recursive: true });
    logger.debug(`Created Jaine directory: ${JAINE_DIR}`);
  }
}
