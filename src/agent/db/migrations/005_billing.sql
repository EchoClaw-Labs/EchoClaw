-- Billing snapshots (ledger balance tracking over time)
CREATE TABLE IF NOT EXISTS billing_snapshots (
  id SERIAL PRIMARY KEY,
  ledger_total_og NUMERIC NOT NULL,
  ledger_available_og NUMERIC NOT NULL,
  provider_locked_og NUMERIC NOT NULL,
  session_burn_og NUMERIC NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_time ON billing_snapshots(fetched_at DESC);
