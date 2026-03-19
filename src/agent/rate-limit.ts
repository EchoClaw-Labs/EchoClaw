/**
 * Simple in-memory rate limiter for Echo Agent HTTP endpoints.
 *
 * Limitations:
 * - Per-process only — does not work across multiple instances.
 * - IP extraction trusts x-forwarded-for only for localhost proxy.
 */

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

export function checkRateLimit(ip: string, endpoint: string, limit: number, windowMs: number): boolean {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }

  bucket.count++;
  return bucket.count <= limit;
}

export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  // Only trust x-forwarded-for from localhost (Docker proxy)
  const remote = req.socket?.remoteAddress ?? "unknown";
  if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  }
  return remote;
}
