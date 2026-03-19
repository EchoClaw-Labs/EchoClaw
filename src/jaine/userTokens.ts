import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address } from "viem";
import { isAddress, getAddress } from "viem";
import { TOKENS_FILE, ensureJaineDir } from "./paths.js";
import { CORE_TOKENS } from "./coreTokens.js";
import logger from "../utils/logger.js";

export interface UserTokensConfig {
  version: 1;
  aliases: Record<string, Address>;
}

/**
 * Load user token aliases from disk
 */
export function loadUserTokens(): UserTokensConfig {
  if (!existsSync(TOKENS_FILE)) {
    return { version: 1, aliases: {} };
  }

  try {
    const raw = readFileSync(TOKENS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UserTokensConfig;

    if (parsed.version !== 1) {
      logger.warn(`Unknown user tokens version: ${parsed.version}`);
      return { version: 1, aliases: {} };
    }

    return parsed;
  } catch (err) {
    logger.error(`Failed to parse user tokens: ${err}`);
    return { version: 1, aliases: {} };
  }
}

/**
 * Save user token aliases to disk
 */
export function saveUserTokens(config: UserTokensConfig): void {
  ensureJaineDir();

  const dir = dirname(TOKENS_FILE);
  const tmpFile = join(dir, `.tokens.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(config, null, 2), "utf-8");
    renameSync(tmpFile, TOKENS_FILE);
    logger.debug("User tokens saved");
  } catch (err) {
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Add or update a user token alias
 */
export function addUserAlias(symbol: string, address: Address): void {
  if (!isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }

  const config = loadUserTokens();
  config.aliases[symbol] = getAddress(address);
  saveUserTokens(config);
}

/**
 * Remove a user token alias
 */
export function removeUserAlias(symbol: string): boolean {
  const config = loadUserTokens();

  if (!config.aliases[symbol]) {
    return false;
  }

  delete config.aliases[symbol];
  saveUserTokens(config);
  return true;
}

/**
 * Get merged token list (user aliases + core tokens)
 * User aliases have priority
 */
export function getMergedTokens(): Record<string, Address> {
  const userConfig = loadUserTokens();

  // Start with core tokens
  const merged: Record<string, Address> = { ...CORE_TOKENS };

  // Overlay user aliases (they take priority)
  for (const [symbol, address] of Object.entries(userConfig.aliases)) {
    merged[symbol] = address;
  }

  return merged;
}
