-- Fetch cache for Crawl4AI scraped pages (1h TTL)
CREATE TABLE IF NOT EXISTS fetch_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  markdown TEXT NOT NULL,
  title TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fetch_cached ON fetch_cache(fetched_at);
