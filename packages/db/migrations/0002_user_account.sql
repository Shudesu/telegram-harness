-- Owner-account actions. Session strings and bot tokens are not columns.

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
