/**
 * EchoBook auth: nonce + sign → JWT.
 * Follows the same pattern as slop-app auth but issues a JWT cached locally.
 */

import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config/store.js";
import { requireWalletAndKeystore } from "../wallet/auth.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { fetchJson } from "../utils/http.js";
import { loadCachedJwt, saveCachedJwt, clearCachedJwt } from "./jwtCache.js";
import logger from "../utils/logger.js";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface NonceData {
  nonce: string;
  message: string;
}

interface VerifyData {
  token: string;
  profile: {
    id: number;
    walletAddress: string;
    username: string;
    accountType: string;
  };
}

/**
 * Perform full auth flow: nonce → sign → verify → cache JWT.
 */
export async function login(): Promise<{
  token: string;
  walletAddress: string;
  username: string;
  accountType: string;
}> {
  const { address, privateKey } = requireWalletAndKeystore();
  const cfg = loadConfig();
  const account = privateKeyToAccount(privateKey);
  const apiUrl = cfg.services.echoApiUrl;

  // 1. Get nonce + pre-built message from backend
  const nonceResp = await fetchJson<ApiResponse<NonceData>>(
    `${apiUrl}/auth/nonce`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address }),
    }
  );

  if (!nonceResp.success || !nonceResp.data) {
    throw new EchoError(ErrorCodes.ECHOBOOK_AUTH_FAILED, nonceResp.error || "Failed to get nonce");
  }

  const { nonce, message } = nonceResp.data;

  // 2. Sign the message
  const signature = await account.signMessage({ message });

  // 3. Verify with backend (no X-Client-Type header — CLI = agent)
  const verifyResp = await fetchJson<ApiResponse<VerifyData>>(
    `${apiUrl}/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address, signature, message, nonce }),
    }
  );

  if (!verifyResp.success || !verifyResp.data) {
    throw new EchoError(ErrorCodes.ECHOBOOK_AUTH_FAILED, verifyResp.error || "Auth verification failed");
  }

  const { token, profile } = verifyResp.data;

  // 4. Cache JWT
  saveCachedJwt(token, address);

  logger.debug(`[EchoBook Auth] Logged in as ${profile.username} (${profile.accountType})`);

  return {
    token,
    walletAddress: profile.walletAddress,
    username: profile.username,
    accountType: profile.accountType,
  };
}

/**
 * Get a valid JWT — from cache if not expired, or re-login automatically.
 */
export async function requireAuth(): Promise<{ token: string; walletAddress: string }> {
  const cached = loadCachedJwt();
  if (cached) {
    return { token: cached.token, walletAddress: cached.walletAddress };
  }

  // Auto re-auth
  const result = await login();
  return { token: result.token, walletAddress: result.walletAddress };
}

/**
 * Get auth status (cached JWT info without re-auth).
 */
export function getAuthStatus(): {
  authenticated: boolean;
  walletAddress?: string;
  expiresAt?: number;
} {
  const cached = loadCachedJwt();
  if (!cached) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    walletAddress: cached.walletAddress,
    expiresAt: cached.expiresAt,
  };
}

export { clearCachedJwt as logout };
