-- Immutable definitions and ledger events; mutable execution snapshots use version CAS.
CREATE TABLE IF NOT EXISTS crm_engagement (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT REFERENCES crm_customers(id),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created_at TEXT NOT NULL,
  UNIQUE(kind,id)
);
CREATE INDEX IF NOT EXISTS crm_engagement_customer ON crm_engagement(customer_id,kind,id);
CREATE INDEX IF NOT EXISTS crm_engagement_latest ON crm_engagement(customer_id,kind,sequence DESC);
CREATE TABLE IF NOT EXISTS crm_executions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(id),
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id),
  state TEXT NOT NULL CHECK(state IN ('active','completed','stopped')),
  due_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS crm_executions_due ON crm_executions(state,due_at,id);
CREATE INDEX IF NOT EXISTS crm_contacts_bot_page ON crm_contacts(kind,scope,id);
