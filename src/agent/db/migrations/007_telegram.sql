-- Telegram bot integration: config (singleton) + session mapping.

CREATE TABLE IF NOT EXISTS telegram_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN DEFAULT FALSE,
  bot_token_encrypted TEXT,
  authorized_chat_ids JSONB DEFAULT '[]'::jsonb,
  loop_mode TEXT DEFAULT 'restricted',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO telegram_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS telegram_sessions (
  chat_id BIGINT PRIMARY KEY,
  session_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);
