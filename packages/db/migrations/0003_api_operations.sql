-- Preserve existing approvals while extending the shared action queue.
ALTER TABLE account_actions RENAME TO account_actions_previous;
DROP INDEX idx_account_actions_status;
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
    'botfather_revoke_token',
    'bot_api_call',
    'user_api_call'
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

INSERT INTO account_actions (id, action, status, payload_json, summary, scheduled_at, approved_at, error, result_json, created_at, updated_at) SELECT id, action, status, payload_json, summary, scheduled_at, approved_at, error, result_json, created_at, updated_at FROM account_actions_previous;
DROP TABLE account_actions_previous;
