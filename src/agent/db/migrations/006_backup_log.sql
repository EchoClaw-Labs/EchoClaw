-- Backup log: tracks 0G Storage backups with root hashes for retrieval
CREATE TABLE IF NOT EXISTS backup_log (
  id SERIAL PRIMARY KEY,
  root_hash TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log (created_at DESC);
