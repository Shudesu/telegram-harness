CREATE TABLE crm_booking_routes (
  booking_id TEXT PRIMARY KEY REFERENCES crm_bookings(id),
  contact_id TEXT NOT NULL REFERENCES crm_contacts(id),
  channel TEXT NOT NULL CHECK(channel IN ('telegram','sms','voice')),
  destination TEXT NOT NULL,
  thread_id INTEGER,
  source TEXT NOT NULL
);
CREATE TABLE crm_notifications (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES crm_bookings(id),
  kind TEXT NOT NULL CHECK(kind IN ('confirmation','reminder')),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','mocked','skipped')),
  reason TEXT,
  completed_at TEXT,
  UNIQUE(booking_id,kind)
);
CREATE INDEX crm_notifications_due ON crm_notifications(status,due_at);
