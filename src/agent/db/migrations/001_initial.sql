-- Echo Agent initial schema

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_soul (
  id INTEGER PRIMARY KEY DEFAULT 1,
  content TEXT NOT NULL DEFAULT '',
  pfp_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  summary TEXT,
  compacted BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  chain TEXT NOT NULL,
  status TEXT NOT NULL,
  input_token TEXT NOT NULL,
  input_amount TEXT NOT NULL,
  input_value_usd NUMERIC,
  output_token TEXT NOT NULL,
  output_amount TEXT NOT NULL,
  output_value_usd NUMERIC,
  pnl_amount_usd NUMERIC,
  pnl_percent NUMERIC,
  pnl_realized BOOLEAN,
  meta JSONB DEFAULT '{}',
  reasoning TEXT,
  signature TEXT,
  explorer_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(type);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id SERIAL PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_path ON knowledge_files(path);

CREATE TABLE IF NOT EXISTS skill_references (
  id SERIAL PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  seeded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skills_path ON skill_references(path);

CREATE TABLE IF NOT EXISTS usage_log (
  id SERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_og NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at DESC);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  tool_call JSONB NOT NULL,
  reasoning TEXT NOT NULL,
  estimated_cost TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT REFERENCES sessions(id),
  pending_context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_queue(status);

CREATE TABLE IF NOT EXISTS loop_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT FALSE,
  mode TEXT DEFAULT 'restricted',
  interval_ms INTEGER DEFAULT 300000,
  started_at TIMESTAMPTZ,
  last_cycle_at TIMESTAMPTZ,
  cycle_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS search_cache (
  query_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  results JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_search_cached ON search_cache(cached_at);

-- Seed singleton rows
INSERT INTO agent_soul (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING;
INSERT INTO loop_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
