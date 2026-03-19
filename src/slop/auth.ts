/**
 * Slop.money JWT authentication for CLI.
 * Handles: login (nonce+sign), refresh, and cache management.
 */

import { privateKeyToAccount } from "viem/accounts";
import { fetchJson } from "../utils/http.js";
import { EchoError, ErrorCodes } from "../errors.js";
import {
  loadCachedSlopJwt,
  saveCachedSlopJwt,
  clearCachedSlopJwt,
  isAccessValid,
} from "./jwtCache.js";
import logger from "../utils/logger.js";

interface NonceResponse {
  nonce: string;
  message: string;
}

interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
  profile: any;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Ensure we have a valid slop access token.
 * Flow: cache check → refresh if expired → full login if needed.
 * Returns the access token string.
 */
export async function requireSlopAuth(
  privateKey: string,
  walletAddress: string,
  baseUrl: string
): Promise<string> {
  // 1. Check cache
  const cached = loadCachedSlopJwt();

  // Wallet mismatch → discard cache and do full login
  if (cached && cached.walletAddress !== walletAddress.toLowerCase()) {
    logger.debug("[Slop Auth] Cached wallet mismatch, clearing cache");
    clearCachedSlopJwt();
    return slopLogin(privateKey, walletAddress, baseUrl);
  }

  if (cached && isAccessValid(cached)) {
    return cached.accessToken;
  }

  // 2. Try refresh if we have a refresh token
  if (cached?.refreshToken) {
    try {
      const refreshed = await slopRefresh(cached.refreshToken, walletAddress, baseUrl);
      return refreshed;
    } catch (err) {
      logger.debug("[Slop Auth] Refresh failed, doing full login");
    }
  }

  // 3. Full login
  return slopLogin(privateKey, walletAddress, baseUrl);
}

/**
 * Full login: POST /auth/nonce → sign → POST /auth/verify → cache tokens.
 */
export async function slopLogin(
  privateKey: string,
  walletAddress: string,
  baseUrl: string
): Promise<string> {
  const wallet = walletAddress.toLowerCase();

  // 1. Get nonce
  const nonceRes = await fetchJson<ApiResponse<NonceResponse>>(
    `${baseUrl}/auth/nonce`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: wallet }),
    }
  );

  if (!nonceRes.success || !nonceRes.data) {
    throw new EchoError(
      ErrorCodes.SLOP_AUTH_FAILED,
      nonceRes.error || "Failed to get nonce",
      "Check backend availability"
    );
  }

  // 2. Sign message
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const signature = await account.signMessage({ message: nonceRes.data.message });

  // 3. Verify
  const verifyRes = await fetchJson<ApiResponse<AuthTokenResponse>>(
    `${baseUrl}/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: wallet,
        signature,
        message: nonceRes.data.message,
      }),
    }
  );

  if (!verifyRes.success || !verifyRes.data) {
    throw new EchoError(
      ErrorCodes.SLOP_AUTH_FAILED,
      verifyRes.error || "Login verification failed",
      "Check wallet address and signature"
    );
  }

  // 4. Cache
  saveCachedSlopJwt(verifyRes.data.accessToken, verifyRes.data.refreshToken, wallet);

  logger.debug("[Slop Auth] Login successful");
  return verifyRes.data.accessToken;
}

/**
 * Refresh tokens: POST /auth/refresh → cache new pair.
 */
export async function slopRefresh(
  refreshToken: string,
  walletAddress: string,
  baseUrl: string
): Promise<string> {
  const res = await fetchJson<ApiResponse<AuthTokenResponse>>(
    `${baseUrl}/auth/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }
  );

  if (!res.success || !res.data) {
    clearCachedSlopJwt();
    throw new EchoError(
      ErrorCodes.SLOP_REFRESH_FAILED,
      res.error || "Token refresh failed",
      "Re-login required"
    );
  }

  saveCachedSlopJwt(res.data.accessToken, res.data.refreshToken, walletAddress.toLowerCase());

  logger.debug("[Slop Auth] Token refreshed");
  return res.data.accessToken;
}
