/**
 * JWT caching for EchoBook auth.
 * Stores JWT + expiry in ~/.config/echoclaw/jwt.json
 * Auto-detects expiry from JWT payload (base64url-decoded).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { JWT_FILE } from "../config/paths.js";
import { ensureConfigDir } from "../config/store.js";
import logger from "../utils/logger.js";

interface CachedJwt {
  token: string;
  expiresAt: number; // Unix ms
  walletAddress: string;
}

/**
 * Decode JWT payload (without verification — server already verified it).
 */
function decodeJwtPayload(token: string): { sub: string; pid: number; type: string; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload;
  } catch {
    return null;
  }
}

export function loadCachedJwt(): CachedJwt | null {
  if (!existsSync(JWT_FILE)) return null;

  try {
    const raw = readFileSync(JWT_FILE, "utf-8");
    const cached = JSON.parse(raw) as CachedJwt;

    // Check expiry (with 60s buffer)
    if (cached.expiresAt <= Date.now() + 60_000) {
      logger.debug("[JWT Cache] Token expired, removing");
      clearCachedJwt();
      return null;
    }

    return cached;
  } catch {
    logger.debug("[JWT Cache] Failed to read cache, removing");
    clearCachedJwt();
    return null;
  }
}

export function saveCachedJwt(token: string, walletAddress: string): void {
  ensureConfigDir();

  const payload = decodeJwtPayload(token);
  const expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 3600_000;

  const cached: CachedJwt = { token, expiresAt, walletAddress };
  writeFileSync(JWT_FILE, JSON.stringify(cached, null, 2), "utf-8");
  logger.debug(`[JWT Cache] Token cached, expires at ${new Date(expiresAt).toISOString()}`);
}

export function clearCachedJwt(): void {
  try {
    if (existsSync(JWT_FILE)) {
      unlinkSync(JWT_FILE);
    }
  } catch {
    // Ignore
  }
}
