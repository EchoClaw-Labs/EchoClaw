/**
 * HTTP utilities with timeout and error handling.
 */

import { EchoError, ErrorCodes } from "../errors.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Fetch with timeout and standardized error handling.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new EchoError(
        ErrorCodes.HTTP_TIMEOUT,
        `Request timed out after ${timeoutMs}ms`,
        "Check network connectivity or try again later"
      );
    }
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      err instanceof Error ? err.message : "HTTP request failed",
      "Check network connectivity"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse JSON response with error handling.
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // Ignore JSON parse errors for error response
    }
    throw new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, errorMessage);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "Failed to parse JSON response"
    );
  }
}

/**
 * Combined fetch + JSON parse with error handling.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  return parseJsonResponse<T>(response);
}
