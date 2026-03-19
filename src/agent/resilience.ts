/**
 * Retry with exponential backoff for idempotent reads.
 *
 * Used to wrap external API calls (Tavily search, web fetch) and
 * on-chain reads (ledger balance) — never for writes or streaming.
 */

import logger from "../utils/logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitter?: boolean;
  /** Only retry if this returns true. Default: retry all errors. */
  shouldRetry?: (err: Error) => boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  label?: string,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === opts.maxRetries) break;
      if (opts.shouldRetry && !opts.shouldRetry(lastError)) break;
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) +
          (opts.jitter ? Math.random() * opts.baseDelayMs : 0),
        opts.maxDelayMs ?? 30_000,
      );
      if (label) {
        logger.debug(
          `[resilience] ${label} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms: ${lastError.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError!;
}

/**
 * Classify an error as retryable (transport/server) vs non-retryable (client/logic).
 * Used by inference retry to avoid retrying 4xx errors or deliberate cancellations.
 */
export function isRetryableError(err: Error): boolean {
  if (err.name === "AbortError") return false;

  // Node.js transport errors
  if ("code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") return true;
  }

  const msg = err.message;
  // 5xx server errors and 429 rate limit — retryable
  if (msg.includes("returned 502") || msg.includes("returned 503") || msg.includes("returned 429")) return true;
  if (msg.includes("returned 5")) return true;
  // 4xx client errors (except 429) — not retryable
  if (msg.includes("returned 4")) return false;
  // Unknown errors — retry conservatively
  return true;
}
