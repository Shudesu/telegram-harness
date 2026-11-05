import type { D1Like } from "./d1.js";

export interface Customer {
  id: string;
  displayName: string;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Contact {
  id: string;
  customerId: string;
  kind: "email" | "phone" | "telegram";
  value: string;
  scope: string;
  verificationEvidence: string | null;
  verifiedAt: string | null;
  createdAt: string;
}
export interface Consent {
  id: string;
  contactId: string;
  purpose: "recontact" | "booking" | "marketing";
  status: "granted" | "revoked";
  evidence: string;
  policyVersion: string;
  occurredAt: string;
  recordedAt: string;
  sequence?: number;
}
export interface Slot {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  createdAt: string;
  booked?: number;
}
export interface Booking {
  id: string;
  customerId: string;
  slotId: string;
  requestKey: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
}
export class CrmError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 = 409,
  ) {
    super(code);
  }
}
const customerColumns = `id, display_name AS displayName, source, tags_json AS tagsJson, created_at AS createdAt, updated_at AS updatedAt`;
const contactColumns = `id, customer_id AS customerId, kind, value, scope, verification_evidence AS verificationEvidence, verified_at AS verifiedAt, created_at AS createdAt`;
const consentColumns = `id, sequence, contact_id AS contactId, purpose, status, evidence, policy_version AS policyVersion, occurred_at AS occurredAt, recorded_at AS recordedAt`;
const slotColumns = `id, title, starts_at AS startsAt, ends_at AS endsAt, capacity, created_at AS createdAt`;
const bookingColumns = `id, customer_id AS customerId, slot_id AS slotId, request_key AS requestKey, status, created_at AS createdAt, cancelled_at AS cancelledAt`;
function customer(
  row: Omit<Customer, "tags"> & { tagsJson: string },
): Customer {
  const { tagsJson, ...rest } = row;
  return { ...rest, tags: JSON.parse(tagsJson) as string[] };
}
export class CrmRepo {
  constructor(private readonly db: D1Like) {}
  private async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return (
      (
        await this.db
          .prepare(sql)
          .bind(...args)
          .all<T>()
      ).results ?? []
    );
  }
    async telegramCustomer(bot: string, user: string, name: string, now: string) {
        const existing = await this.db.prepare(`SELECT ${contactColumns} FROM crm_contacts WHERE kind='telegram' AND value=? AND scope=?`).bind(user, bot).first<Contact>();
        if (existing)
            return existing;
        // Stable IDs allow retries/concurrent updates to finish partial identity creation.
        const id = `tg:${bot}:${user}`;
        await this.db.prepare("INSERT OR IGNORE INTO crm_customers VALUES (?,?,?,?,?,?)")
            .bind(id, name, "telegram-mock", "[]", now, now).run();
        await this.db.prepare("INSERT OR IGNORE INTO crm_contacts VALUES (?,?,?,?,?,?,?,?)")
            .bind(id, id, "telegram", user, bot, "mock-update-only", now, now).run();
        const contact = await this.db.prepare(`SELECT ${contactColumns} FROM crm_contacts WHERE kind='telegram' AND value=? AND scope=?`).bind(user, bot).first<Contact>();
        if (!contact)
            throw new CrmError("identity_conflict");
        return contact;
    }
    async calendar(month: string, now: string) {
        return this.all<Slot>(`SELECT ${slotColumns}, (SELECT count(*) FROM crm_bookings b WHERE b.slot_id=crm_slots.id AND status='confirmed') AS booked FROM crm_slots WHERE substr(starts_at,1,7)=? AND starts_at>? ORDER BY starts_at,id LIMIT 100`, month, now);
    }
    async getBooking(id: string) {
        return this.db.prepare(`SELECT ${bookingColumns} FROM crm_bookings WHERE id=?`).bind(id).first<Booking>();
    }
    async attachBookingRoute(bookingId: string, contactId: string, channel: string, destination: string, threadId: number | null, source: string) {
        await this.db.prepare("INSERT OR IGNORE INTO crm_booking_routes VALUES (?,?,?,?,?,?)").bind(bookingId, contactId, channel, destination, threadId, source).run();
        const route = await this.db.prepare("SELECT * FROM crm_booking_routes WHERE booking_id=?").bind(bookingId).first<{
            contact_id: string;
            channel: string;
            destination: string;
            thread_id: number | null;
        }>();
        if (!route || route.contact_id !== contactId || route.channel !== channel || route.destination !== destination || route.thread_id !== threadId)
            throw new CrmError("booking_route_conflict");
        const slot = await this.db.prepare("SELECT starts_at FROM crm_slots WHERE id=(SELECT slot_id FROM crm_bookings WHERE id=?)").bind(bookingId).first<{
            starts_at: string;
        }>();
        const booking = await this.getBooking(bookingId);
        if (!slot || !booking)
            throw new CrmError("booking_not_found", 404);
        for (const [kind, due] of [["confirmation", booking.createdAt], ["reminder", new Date(Date.parse(slot.starts_at) - 86400000).toISOString()]]) {
            await this.db.prepare("INSERT OR IGNORE INTO crm_notifications(id,booking_id,kind,due_at) VALUES (?,?,?,?)").bind(`${bookingId}:${kind}`, bookingId, kind, due).run();
        }
    }
    async notifications(after = "", limit = 50) {
        return this.all<{
            id: string;
            bookingId: string;
            kind: string;
            dueAt: string;
            status: string;
            reason: string | null;
        }>("SELECT id,booking_id AS bookingId,kind,due_at AS dueAt,status,reason FROM crm_notifications WHERE id>? ORDER BY id LIMIT ?", after, limit);
    }
    async dueNotifications(now: string) {
        return this.all<{
            id: string;
            bookingId: string;
            kind: string;
            channel: "telegram" | "sms" | "voice";
            destination: string;
            threadId: number | null;
            status: string;
            startsAt: string;
            verifiedAt: string | null;
            consent: string | null;
        }>(`SELECT n.id,n.booking_id AS bookingId,n.kind,r.channel,r.destination,r.thread_id AS threadId,b.status,s.starts_at AS startsAt,c.verified_at AS verifiedAt,
      (SELECT status FROM crm_consents WHERE contact_id=c.id AND purpose='booking' ORDER BY sequence DESC LIMIT 1) AS consent
      FROM crm_notifications n JOIN crm_booking_routes r ON r.booking_id=n.booking_id JOIN crm_bookings b ON b.id=n.booking_id JOIN crm_slots s ON s.id=b.slot_id JOIN crm_contacts c ON c.id=r.contact_id WHERE n.status='pending' AND n.due_at<=? ORDER BY n.due_at,n.id LIMIT 100`, now);
    }
    async finishNotification(id: string, status: "mocked" | "skipped", reason: string, now: string) {
        const result = await this.db.prepare("UPDATE crm_notifications SET status=?,reason=?,completed_at=? WHERE id=? AND status='pending'").bind(status, reason, now, id).run();
        return Boolean(result.meta?.changes);
    }
  async listCustomers(after = "", limit = 50): Promise<Customer[]> {
    return (
      await this.all<Omit<Customer, "tags"> & { tagsJson: string }>(
        `SELECT ${customerColumns} FROM crm_customers WHERE id > ? ORDER BY id LIMIT ?`,
        after,
        limit,
      )
    ).map(customer);
  }
  async getCustomer(id: string): Promise<Customer | null> {
    const row = await this.db
      .prepare(`SELECT ${customerColumns} FROM crm_customers WHERE id=?`)
      .bind(id)
      .first<Omit<Customer, "tags"> & { tagsJson: string }>();
    return row ? customer(row) : null;
  }
  async saveCustomer(c: Customer, update = false): Promise<void> {
    if (update) {
      const result = await this.db
        .prepare(
          "UPDATE crm_customers SET display_name=?,source=?,tags_json=?,updated_at=? WHERE id=?",
        )
        .bind(
          c.displayName,
          c.source,
          JSON.stringify(c.tags),
          c.updatedAt,
          c.id,
        )
        .run();
      if (!result.meta?.changes) throw new CrmError("customer_not_found", 404);
    } else
      await this.db
        .prepare("INSERT INTO crm_customers VALUES (?,?,?,?,?,?)")
        .bind(
          c.id,
          c.displayName,
          c.source,
          JSON.stringify(c.tags),
          c.createdAt,
          c.updatedAt,
        )
        .run();
  }
  async addContact(c: Contact): Promise<void> {
    if (!(await this.getCustomer(c.customerId)))
      throw new CrmError("customer_not_found", 404);
    try {
      await this.db
        .prepare("INSERT INTO crm_contacts VALUES (?,?,?,?,?,?,?,?)")
        .bind(
          c.id,
          c.customerId,
          c.kind,
          c.value,
          c.scope,
          c.verificationEvidence,
          c.verifiedAt,
          c.createdAt,
        )
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new CrmError("contact_already_registered");
      throw error;
    }
  }
  async getContact(id: string): Promise<Contact | null> {
    return this.db
      .prepare(`SELECT ${contactColumns} FROM crm_contacts WHERE id=?`)
      .bind(id)
      .first<Contact>();
  }
  async verifyContact(
    id: string,
    evidence: string,
    now: string,
  ): Promise<void> {
    const result = await this.db
      .prepare(
        "UPDATE crm_contacts SET verification_evidence=?,verified_at=? WHERE id=?",
      )
      .bind(evidence, now, id)
      .run();
    if (!result.meta?.changes) throw new CrmError("contact_not_found", 404);
  }
  async addConsent(c: Consent): Promise<void> {
    if (!(await this.getContact(c.contactId)))
      throw new CrmError("contact_not_found", 404);
    // Recording order is authoritative: importing an older grant must not undo a newer withdrawal.
    const latest = await this.db
      .prepare(
        "SELECT occurred_at FROM crm_consents WHERE contact_id=? AND purpose=? ORDER BY sequence DESC LIMIT 1",
      )
      .bind(c.contactId, c.purpose)
      .first<{ occurred_at: string }>();
    if (latest && c.occurredAt < latest.occurred_at)
      throw new CrmError("out_of_order_consent");
    await this.db
      .prepare(
        `INSERT INTO crm_consents(id,contact_id,purpose,status,evidence,policy_version,occurred_at,recorded_at)
      SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM crm_consents WHERE contact_id=? AND purpose=? AND occurred_at>?)`,
      )
      .bind(
        c.id,
        c.contactId,
        c.purpose,
        c.status,
        c.evidence,
        c.policyVersion,
        c.occurredAt,
        c.recordedAt,
        c.contactId,
        c.purpose,
        c.occurredAt,
      )
      .run()
      .then((r) => {
        if (!r.meta?.changes) throw new CrmError("out_of_order_consent");
      });
  }
  async detail(id: string) {
    const c = await this.getCustomer(id);
    if (!c) throw new CrmError("customer_not_found", 404);
    return {
      ...c,
      contacts: await this.all<Contact>(
        `SELECT ${contactColumns} FROM crm_contacts WHERE customer_id=? ORDER BY id`,
        id,
      ),
      consents: await this.all<Consent>(
        `SELECT ${consentColumns} FROM crm_consents WHERE contact_id IN (SELECT id FROM crm_contacts WHERE customer_id=?) ORDER BY sequence`,
        id,
      ),
      bookings: await this.all<Booking>(
        `SELECT ${bookingColumns} FROM crm_bookings WHERE customer_id=? ORDER BY id`,
        id,
      ),
      purchases: await this.all<Record<string, unknown>>(
        "SELECT * FROM crm_purchases WHERE customer_id=? ORDER BY id",
        id,
      ),
    };
  }
  async createSlot(s: Slot): Promise<void> {
    await this.db
      .prepare("INSERT INTO crm_slots VALUES (?,?,?,?,?,?)")
      .bind(s.id, s.title, s.startsAt, s.endsAt, s.capacity, s.createdAt)
      .run();
  }
  async listSlots(after = "", limit = 50): Promise<Slot[]> {
    return this.all<Slot>(
      `SELECT ${slotColumns}, (SELECT count(*) FROM crm_bookings b WHERE b.slot_id=crm_slots.id AND status='confirmed') AS booked FROM crm_slots WHERE id>? ORDER BY id LIMIT ?`,
      after,
      limit,
    );
  }
  async book(b: Booking): Promise<Booking> {
    const byKey = () =>
      this.db
        .prepare(
          `SELECT ${bookingColumns} FROM crm_bookings WHERE request_key=?`,
        )
        .bind(b.requestKey)
        .first<Booking>();
    const existing = await byKey();
    if (existing) return sameRequest(existing, b);
    if (!(await this.getCustomer(b.customerId)))
      throw new CrmError("customer_not_found", 404);
    const slot = await this.db
      .prepare("SELECT starts_at FROM crm_slots WHERE id=?")
      .bind(b.slotId)
      .first<{ starts_at: string }>();
    if (!slot) throw new CrmError("slot_not_found", 404);
    if (slot.starts_at <= b.createdAt) throw new CrmError("slot_started");
    try {
      await this.db
        .prepare("INSERT INTO crm_bookings VALUES (?,?,?,?,?,?,?)")
        .bind(
          b.id,
          b.customerId,
          b.slotId,
          b.requestKey,
          b.status,
          b.createdAt,
          b.cancelledAt,
        )
        .run();
    } catch (error) {
      const replay = await byKey();
      if (replay) return sameRequest(replay, b);
      const message = String(error);
      if (message.includes("slot_full")) throw new CrmError("slot_full");
      if (message.includes("UNIQUE")) throw new CrmError("already_booked");
      throw error;
    }
    return b;
  }
  async listBookings(after = "", limit = 50): Promise<Booking[]> {
    return this.all<Booking>(
      `SELECT ${bookingColumns} FROM crm_bookings WHERE id>? ORDER BY id LIMIT ?`,
      after,
      limit,
    );
  }
  async cancel(id: string, now: string): Promise<Booking> {
    await this.db
      .prepare(
        "UPDATE crm_bookings SET status='cancelled',cancelled_at=? WHERE id=? AND status='confirmed'",
      )
      .bind(now, id)
      .run();
    const b = await this.db
      .prepare(`SELECT ${bookingColumns} FROM crm_bookings WHERE id=?`)
      .bind(id)
      .first<Booking>();
    if (!b) throw new CrmError("booking_not_found", 404);
    return b;
  }
  async exportCustomers(after = "", limit = 50) {
    const customers = await this.listCustomers(after, limit);
    return Promise.all(customers.map((c) => this.detail(c.id)));
  }
  async recontact(after = "", limit = 50) {
    // Telegram IDs are deliberately excluded: a new bot cannot inherit permission to DM.
    return this.all<{
      contactId: string;
      customerId: string;
      displayName: string;
      kind: string;
      value: string;
      consentId: string;
      policyVersion: string;
      occurredAt: string;
    }>(
      `SELECT c.id AS contactId,c.customer_id AS customerId,u.display_name AS displayName,c.kind,c.value,s.id AS consentId,s.policy_version AS policyVersion,s.occurred_at AS occurredAt
      FROM crm_contacts c JOIN crm_customers u ON u.id=c.customer_id
      JOIN crm_consents s ON s.contact_id=c.id AND s.purpose='recontact'
        AND s.sequence=(SELECT max(sequence) FROM crm_consents WHERE contact_id=c.id AND purpose='recontact')
      WHERE c.id>? AND c.kind IN ('email','phone') AND c.verified_at IS NOT NULL AND s.status='granted'
      ORDER BY c.id LIMIT ?`,
      after,
      limit,
    );
  }
}
function sameRequest(existing: Booking, requested: Booking): Booking {
  if (
    existing.customerId !== requested.customerId ||
    existing.slotId !== requested.slotId
  )
    throw new CrmError("request_key_conflict");
  return existing;
}
