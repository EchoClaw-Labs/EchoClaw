import { createHash } from "node:crypto";
import { queryOne, execute } from "../client.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

function hashQuery(q: string): string {
  return createHash("sha256").update(q.toLowerCase().trim()).digest("hex").slice(0, 16);
}

export async function getCached(queryStr: string): Promise<SearchResult[] | null> {
  const hash = hashQuery(queryStr);
  const row = await queryOne<{ results: SearchResult[]; cached_at: string }>(
    "SELECT results, cached_at FROM search_cache WHERE query_hash = $1",
    [hash],
  );
  if (!row) return null;

  // Check TTL
  if (Date.now() - new Date(row.cached_at).getTime() > CACHE_TTL_MS) {
    await execute("DELETE FROM search_cache WHERE query_hash = $1", [hash]);
    return null;
  }
  return row.results;
}

export async function cacheResult(queryStr: string, results: SearchResult[]): Promise<void> {
  const hash = hashQuery(queryStr);
  await execute(
    `INSERT INTO search_cache (query_hash, query, results) VALUES ($1, $2, $3)
     ON CONFLICT (query_hash) DO UPDATE SET results = $3, cached_at = NOW()`,
    [hash, queryStr, JSON.stringify(results)],
  );
}

/** Remove expired cache entries. */
export async function pruneExpired(): Promise<number> {
  return execute("DELETE FROM search_cache WHERE cached_at < NOW() - INTERVAL '15 minutes'");
}

// ── Fetch cache (extracted web pages, 1h TTL) ────────────────────────

const FETCH_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface FetchResult {
  markdown: string;
  title: string | null;
}

export async function getCachedFetch(url: string): Promise<FetchResult | null> {
  const hash = hashQuery(url);
  const row = await queryOne<{ markdown: string; title: string | null; fetched_at: string }>(
    "SELECT markdown, title, fetched_at FROM fetch_cache WHERE url_hash = $1", [hash],
  );
  if (!row) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > FETCH_TTL_MS) {
    await execute("DELETE FROM fetch_cache WHERE url_hash = $1", [hash]);
    return null;
  }
  return { markdown: row.markdown, title: row.title };
}

export async function cacheFetchResult(url: string, markdown: string, title: string | null): Promise<void> {
  const hash = hashQuery(url);
  await execute(
    `INSERT INTO fetch_cache (url_hash, url, markdown, title) VALUES ($1, $2, $3, $4)
     ON CONFLICT (url_hash) DO UPDATE SET markdown = $3, title = $4, fetched_at = NOW()`,
    [hash, url, markdown, title],
  );
}
