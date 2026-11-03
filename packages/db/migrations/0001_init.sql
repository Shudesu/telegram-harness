-- Baseline migration. Same statements as packages/db/schema.sql.
-- Fresh installs apply this file once. Do not reapply it to a populated database.

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_env_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'group', 'supergroup')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bot_id, chat_id)
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'edit', 'delete', 'reply')),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'photo', 'video', 'album')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'publishing', 'posted', 'rejected', 'failed')),
  payload_json TEXT NOT NULL,
  scheduled_at TEXT,
  source TEXT NOT NULL,
  source_ref TEXT,
  incoming_id TEXT,
  reply_to_telegram_message_id TEXT,
  target_message_id TEXT,
  approved_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_drafts_source_ref
  ON drafts (source, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX idx_drafts_status ON drafts (status, scheduled_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  telegram_message_ids_json TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL CHECK (status IN ('posted', 'edited', 'deleted')),
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE incoming_messages (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  update_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  telegram_message_id TEXT,
  from_user_id TEXT,
  text TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'channel_post', 'comment')),
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (bot_id, update_id)
);

CREATE TABLE publish_log (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  method TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
