-- Telegram Harness baseline. SQLite / Cloudflare D1.
-- Bot tokens are not stored. bots.token_env_name is an environment variable name.

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

CREATE TABLE account_actions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN (
    'create_channel',
    'create_supergroup',
    'edit_title',
    'edit_description',
    'edit_photo',
    'edit_username',
    'add_admin',
    'remove_admin',
    'botfather_create_bot',
    'botfather_set_name',
    'botfather_set_description',
    'botfather_set_about',
    'botfather_set_commands',
    'botfather_set_photo',
    'botfather_fetch_token',
    'botfather_revoke_token'
  )),
  status TEXT NOT NULL CHECK (status IN ('pending', 'scheduled', 'publishing', 'posted', 'rejected', 'failed')),
  payload_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  scheduled_at TEXT,
  approved_at TEXT,
  error TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_account_actions_status ON account_actions (status, scheduled_at);

CREATE TABLE owned_chats (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  access_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  username TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'supergroup', 'group')),
  role TEXT NOT NULL CHECK (role IN ('creator', 'admin')),
  synced_at TEXT NOT NULL
);

CREATE TABLE user_login (
  id TEXT PRIMARY KEY CHECK (id = 'current'),
  status TEXT NOT NULL CHECK (status IN ('code_sent', 'password_required')),
  phone_code_hash TEXT NOT NULL,
  hint TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_account_state (
  id TEXT PRIMARY KEY CHECK (id = 'self'),
  session_env_name TEXT NOT NULL,
  self_user_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_rate_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('read', 'write', 'login')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_user_rate_events_kind ON user_rate_events (kind, created_at);
