-- Scheduled tasks (agent-created cron jobs)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  loop_mode TEXT DEFAULT 'restricted',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  last_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON scheduled_tasks(enabled, next_run_at);

-- Portfolio snapshots (time-series)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  total_usd NUMERIC NOT NULL,
  positions JSONB NOT NULL,
  active_chains TEXT[] NOT NULL,
  pnl_vs_prev NUMERIC,
  pnl_pct_vs_prev NUMERIC,
  snapshot_source TEXT DEFAULT 'cron'
);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON portfolio_snapshots(timestamp DESC);
