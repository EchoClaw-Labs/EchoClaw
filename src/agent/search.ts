/**
 * Web search + URL extraction via Tavily API.
 *
 * Search via Tavily API, extract via Tavily + simple HTTP fallback.
 * Free tier: 1,000 credits/month (1 credit = 1 search or 5 URL extractions).
 * Docs: https://docs.tavily.com
 *
 * Results cached in Postgres (15min for search, 1h for extract).
 * If TAVILY_API_KEY is not set, web search/fetch gracefully degrade to empty results.
 */

import { tavily } from "@tavily/core";
import { getCached, cacheResult, getCachedFetch, cacheFetchResult, type SearchResult, type FetchResult } from "./db/repos/search.js";
import { retryWithBackoff } from "./resilience.js";
import logger from "../utils/logger.js";

export type { SearchResult, FetchResult } from "./db/repos/search.js";

const DEFAULT_LIMIT = 5;

function getClient(): ReturnType<typeof tavily> | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  return tavily({ apiKey: key });
}

// ── Web Search (Tavily) ─────────────────────────────────────────────

export interface SearchOptions {
  categories?: string;
  language?: string;
  timeRange?: string;
}

export async function webSearch(
  query: string,
  limit = DEFAULT_LIMIT,
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  const cached = await getCached(query);
  if (cached) {
    logger.debug("search.cache.hit", { query: query.slice(0, 50) });
    return cached.slice(0, limit);
  }

  const client = getClient();
  if (!client) {
    logger.warn("search.no_api_key", { hint: "Set TAVILY_API_KEY for web search. Free: https://tavily.com" });
    return [];
  }

  try {
    const response = await retryWithBackoff(
      () => client.search(query, { maxResults: limit }),
      { maxRetries: 2, baseDelayMs: 1000, jitter: true },
      "tavily.search",
    );

    const results: SearchResult[] = (response.results ?? []).map(r => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
    }));

    await cacheResult(query, results);
    logger.debug("search.completed", { resultCount: results.length, query: query.slice(0, 50) });
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("search.failed", { error: msg });
    return [];
  }
}

// ── Web Fetch / Extract (Tavily + fallback) ─────────────────────────

/**
 * Fetch a URL and return markdown content via Tavily Extract.
 * Cached in Postgres for 1 hour.
 */
export async function webFetch(url: string): Promise<FetchResult | null> {
  const cached = await getCachedFetch(url);
  if (cached) {
    logger.debug("fetch.cache.hit", { url: url.slice(0, 60) });
    return cached;
  }

  const client = getClient();
  if (!client) {
    // Fallback: simple fetch without JS rendering
    return simpleFetch(url);
  }

  try {
    const response = await retryWithBackoff(
      () => client.extract([url]),
      { maxRetries: 2, baseDelayMs: 2000, jitter: true },
      "tavily.extract",
    );

    const extracted = response.results?.[0];
    if (!extracted?.rawContent) {
      logger.warn("fetch.extract.empty", { url: url.slice(0, 60) });
      return simpleFetch(url);
    }

    const titleMatch = extracted.rawContent.match(/^#\s+(.+)$/m);
    const result: FetchResult = {
      markdown: extracted.rawContent,
      title: titleMatch?.[1] ?? null,
    };

    await cacheFetchResult(url, result.markdown, result.title);
    logger.debug("fetch.completed", { chars: result.markdown.length, url: url.slice(0, 60) });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("fetch.extract.failed", { error: msg });
    return simpleFetch(url);
  }
}

/** Simple HTTP fetch fallback — no JS rendering, just text content. */
async function simpleFetch(url: string): Promise<FetchResult | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "EchoClaw/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;

    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const result: FetchResult = {
      markdown: text.slice(0, 50_000),
      title: titleMatch?.[1]?.trim() ?? null,
    };

    await cacheFetchResult(url, result.markdown, result.title);
    return result;
  } catch {
    return null;
  }
}
