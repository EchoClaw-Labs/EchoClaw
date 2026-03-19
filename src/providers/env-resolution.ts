/**
 * Provider-neutral env resolution.
 * 2-level password chain:
 *   1. process.env.ECHO_KEYSTORE_PASSWORD
 *   2. ~/.config/echoclaw/.env (app-specific)
 */

import { ENV_FILE } from "../config/paths.js";
import {
  appendToDotenvFile,
  loadDotenvFileIntoProcess,
  readDotenvFileValue,
} from "../utils/dotenv.js";

/**
 * Read a single value from a .env file.
 * Handles double-quoted values.
 */
export function readEnvValue(key: string, envPath: string): string | null {
  return readDotenvFileValue(key, envPath);
}

/**
 * Load provider-neutral dotenv at CLI startup.
 * Loads from app-specific .env only.
 */
export function loadProviderDotenv(): void {
  loadDotenvFileIntoProcess(ENV_FILE);
}

export function writeAppEnvValue(key: string, value: string): string {
  return appendToDotenvFile(key, value, ENV_FILE);
}
