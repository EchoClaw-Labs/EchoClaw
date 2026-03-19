/**
 * EchoBook API client.
 * Authenticated requests auto-inject JWT from cache (with auto-refresh).
 */

import { loadConfig } from "../config/store.js";
import { EchoError, ErrorCodes } from "../errors.js";
import { fetchJson, type FetchOptions } from "../utils/http.js";
import { requireAuth } from "./auth.js";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  cursor?: string;
  hasMore?: boolean;
}

function getBaseUrl(): string {
  return loadConfig().services.echoApiUrl;
}

/**
 * Unauthenticated GET request.
 */
export async function apiGet<T>(path: string, options?: FetchOptions): Promise<ApiResponse<T>> {
  return fetchJson<ApiResponse<T>>(`${getBaseUrl()}${path}`, options);
}

/**
 * Authenticated GET request (auto-injects JWT).
 */
export async function authGet<T>(path: string, options?: FetchOptions): Promise<ApiResponse<T>> {
  const { token } = await requireAuth();
  return fetchJson<ApiResponse<T>>(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Authenticated POST request.
 */
export async function authPost<T>(path: string, body: unknown, options?: FetchOptions): Promise<ApiResponse<T>> {
  const { token } = await requireAuth();
  return fetchJson<ApiResponse<T>>(`${getBaseUrl()}${path}`, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Authenticated PATCH request.
 */
export async function authPatch<T>(path: string, body: unknown, options?: FetchOptions): Promise<ApiResponse<T>> {
  const { token } = await requireAuth();
  return fetchJson<ApiResponse<T>>(`${getBaseUrl()}${path}`, {
    ...options,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Authenticated DELETE request.
 */
export async function authDelete<T>(path: string, options?: FetchOptions): Promise<ApiResponse<T>> {
  const { token } = await requireAuth();
  return fetchJson<ApiResponse<T>>(`${getBaseUrl()}${path}`, {
    ...options,
    method: "DELETE",
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Helper: unwrap ApiResponse or throw.
 */
export function unwrap<T>(response: ApiResponse<T>, errorCode: string, context: string): T {
  if (!response.success || response.data === undefined) {
    throw new EchoError(errorCode, response.error || `${context} failed`);
  }
  return response.data;
}
