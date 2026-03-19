/**
 * JWT caching for slop.money auth.
 * Stores access + refresh tokens in ~/.config/echoclaw/slop-jwt.json
 * Pattern: same as echobook/jwtCache.ts
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { SLOP_JWT_FILE } from "../config/paths.js";
import { ensureConfigDir } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import logger from "../utils/logger.js";

export interface CachedSlopJwt {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // Unix ms
  refreshExpiresAt: number; // Unix ms
  walletAddress: string;
}

/**
 * Decode JWT payload without verification.
 */
function decodeJwtPayload(token: string): { sub: string; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load cached slop JWT. Returns null if expired or missing.
 * Access token checked with 60s buffer.
 */
export function loadCachedSlopJwt(): CachedSlopJwt | null {
  if (!existsSync(SLOP_JWT_FILE)) return null;

  try {
    const raw = readFileSync(SLOP_JWT_FILE, "utf-8");
    const cached = JSON.parse(raw) as CachedSlopJwt;

    // If access is still valid, return as-is
    if (cached.accessExpiresAt > Date.now() + 60_000) {
      return cached;
    }

    // If refresh is still valid, return (caller will refresh)
    if (cached.refreshExpiresAt > Date.now() + 60_000) {
      return cached;
    }

    // Both expired
    logger.debug("[Slop JWT] Both tokens expired, removing cache");
    clearCachedSlopJwt();
    return null;
  } catch {
    logger.debug("[Slop JWT] Failed to read cache, removing");
    clearCachedSlopJwt();
    return null;
  }
}

/**
 * Check if the cached access token is still valid (with 60s buffer).
 */
export function isAccessValid(cached: CachedSlopJwt): boolean {
  return cached.accessExpiresAt > Date.now() + 60_000;
}

/**
 * Save slop JWT tokens to cache.
 */
export function saveCachedSlopJwt(
  accessToken: string,
  refreshToken: string,
  walletAddress: string
): void {
  ensureConfigDir();

  const accessPayload = decodeJwtPayload(accessToken);
  const refreshPayload = decodeJwtPayload(refreshToken);

  // Validate JWT sub matches the wallet we're caching for
  if (accessPayload?.sub && accessPayload.sub.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new EchoError(
      ErrorCodes.SLOP_AUTH_FAILED,
      "Token wallet mismatch",
      "Access token sub does not match wallet address"
    );
  }

  const cached: CachedSlopJwt = {
    accessToken,
    refreshToken,
    accessExpiresAt: accessPayload?.exp ? accessPayload.exp * 1000 : Date.now() + 3_600_000,
    refreshExpiresAt: refreshPayload?.exp ? refreshPayload.exp * 1000 : Date.now() + 604800_000,
    walletAddress: walletAddress.toLowerCase(),
  };

  writeFileSync(SLOP_JWT_FILE, JSON.stringify(cached, null, 2), "utf-8");
  logger.debug(`[Slop JWT] Cached, access expires ${new Date(cached.accessExpiresAt).toISOString()}`);
}

export function clearCachedSlopJwt(): void {
  try {
    if (existsSync(SLOP_JWT_FILE)) {
      unlinkSync(SLOP_JWT_FILE);
    }
  } catch {
    // Ignore
  }
}
