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
-- Customer identity belongs to the operator, never to a bot or channel.
CREATE TABLE IF NOT EXISTS crm_customers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(id),
  kind TEXT NOT NULL CHECK(kind IN ('email','phone','telegram')),
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  verification_evidence TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(kind, value, scope),
  CHECK ((kind = 'telegram' AND length(scope) > 0) OR (kind != 'telegram' AND scope = '')),
  CHECK ((verified_at IS NULL AND verification_evidence IS NULL) OR
         (verified_at IS NOT NULL AND length(verification_evidence) > 0))
);
CREATE INDEX IF NOT EXISTS crm_contacts_customer ON crm_contacts(customer_id);
CREATE TABLE IF NOT EXISTS crm_consents (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('recontact','booking','marketing')),
  status TEXT NOT NULL CHECK(status IN ('granted','revoked')),
  evidence TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_consents_latest ON crm_consents(contact_id, purpose, sequence DESC);
CREATE TABLE IF NOT EXISTS crm_slots (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK(ends_at > starts_at),
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_slots_start ON crm_slots(starts_at);
CREATE TABLE IF NOT EXISTS crm_bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(id),
  slot_id TEXT NOT NULL REFERENCES crm_slots(id),
  request_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_booking_active ON crm_bookings(customer_id,slot_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS crm_bookings_slot ON crm_bookings(slot_id,status);
CREATE INDEX IF NOT EXISTS crm_bookings_customer ON crm_bookings(customer_id);
-- Single-statement insert + trigger makes the capacity guard atomic on SQLite/D1.
CREATE TRIGGER IF NOT EXISTS crm_booking_capacity BEFORE INSERT ON crm_bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'slot_full') WHERE
    (SELECT count(*) FROM crm_bookings WHERE slot_id=NEW.slot_id AND status='confirmed') >=
    (SELECT capacity FROM crm_slots WHERE id=NEW.slot_id);
END;
-- Phase 1: schema only; Stars processing is deliberately not enabled.
CREATE TABLE IF NOT EXISTS crm_purchases (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(id),
  booking_id TEXT REFERENCES crm_bookings(id),
  bot_ref TEXT NOT NULL,
  charge_id TEXT,
  currency TEXT NOT NULL CHECK(currency='XTR'),
  amount INTEGER NOT NULL CHECK(amount>0),
  status TEXT NOT NULL CHECK(status IN ('pending','paid','refunded','failed')),
  created_at TEXT NOT NULL,
  UNIQUE(bot_ref,charge_id)
);
CREATE INDEX IF NOT EXISTS crm_purchases_customer ON crm_purchases(customer_id);
