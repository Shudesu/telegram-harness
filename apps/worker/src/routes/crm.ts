import {
  CrmError,
  type CrmRepo,
  type Contact,
  type Consent,
} from "@telegram-harness/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Deps } from "../deps.js";

const MAX = 64 * 1024;
type Body = Record<string, unknown>;
export function text(b: Body, key: string, max = 200): string {
  const value = b[key];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new CrmError(`invalid_${key}`, 400);
  return value.trim();
}
function choice<T extends string>(
  b: Body,
  key: string,
  values: readonly T[],
): T {
  const value = text(b, key);
  if (!values.includes(value as T)) throw new CrmError(`invalid_${key}`, 400);
  return value as T;
}
function date(b: Body, key: string): string {
  const value = text(b, key);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new CrmError(`invalid_${key}`, 400);
  // Detect JS date normalization such as February 30 (before applying the offset).
  const calendar = value.slice(0, 10);
  if (new Date(calendar).toISOString().slice(0, 10) !== calendar)
    throw new CrmError(`invalid_${key}`, 400);
  return new Date(value).toISOString();
}
function tags(b: Body): string[] {
  if (b.tags === undefined) return [];
  if (!Array.isArray(b.tags) || b.tags.length > 30)
    throw new CrmError("invalid_tags", 400);
  return [...new Set(b.tags.map((t) => text({ tag: t }, "tag", 40)))];
}
export async function body(request: { json: () => Promise<unknown> }): Promise<Body> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new CrmError("invalid_json", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CrmError("invalid_json", 400);
  return value as Body;
}
export function page(query: (name: string) => string | undefined) {
  const limit = Number(query("limit") ?? 50);
  const after = query("after") ?? "";
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    after.length > 100
  )
    throw new CrmError("invalid_pagination", 400);
  return { limit, after };
}
function result<T>(items: T[], limit: number, id: (item: T) => string) {
  return {
    success: true as const,
    data: items,
    nextCursor: items.length === limit ? id(items[items.length - 1]!) : null,
  };
}
export function mountCrm(app: Hono, deps: Deps) {
  const router = new Hono<{ Variables: { crm: CrmRepo } }>();
  router.use(
    "*",
    bodyLimit({
      maxSize: MAX,
      onError: (c) => c.json({ success: false, error: "body_too_large" }, 413),
    }),
  );
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!deps.repo.crm)
      return c.json({ success: false, error: "crm_storage_unavailable" }, 503);
    c.set("crm", deps.repo.crm);
    return next();
  });
  router.onError((error, c) => {
    if (error instanceof CrmError)
      return c.json({ success: false, error: error.code }, error.status);
    // Do not expose SQL, contact values, or request bodies in error responses/logs.
    return c.json({ success: false, error: "crm_storage_error" }, 500);
  });
  router.get("/customers", async (c) => {
    const p = page((n) => c.req.query(n));
    return c.json(
      result(
        await c.get("crm").listCustomers(p.after, p.limit),
        p.limit,
        (x) => x.id,
      ),
    );
  });
  router.post("/customers", async (c) => {
    const b = await body(c.req),
      now = deps.now().toISOString();
    const customer = {
      id: crypto.randomUUID(),
      displayName: text(b, "displayName", 120),
      source: text(b, "source"),
      tags: tags(b),
      createdAt: now,
      updatedAt: now,
    };
    await c.get("crm").saveCustomer(customer);
    return c.json({ success: true, data: customer }, 201);
  });
  router.get("/customers/:id", async (c) =>
    c.json({
      success: true,
      data: await c.get("crm").detail(c.req.param("id")),
    }),
  );
  router.post("/customers/:id/update", async (c) => {
    const repo = c.get("crm"),
      old = await repo.getCustomer(c.req.param("id"));
    if (!old) throw new CrmError("customer_not_found", 404);
    const b = await body(c.req);
    const updated = {
      ...old,
      displayName: text(b, "displayName", 120),
      source: text(b, "source"),
      tags: tags(b),
      updatedAt: deps.now().toISOString(),
    };
    await repo.saveCustomer(updated, true);
    return c.json({ success: true, data: updated });
  });
  router.post("/customers/:id/contacts", async (c) => {
    const b = await body(c.req),
      kind = choice(b, "kind", ["email", "phone", "telegram"]),
      now = deps.now().toISOString();
    let value = text(b, "value", 254);
    if (kind === "email") {
      value = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new CrmError("invalid_email", 400);
    }
    if (kind === "phone" && !/^\+[1-9]\d{7,14}$/.test(value))
      throw new CrmError("invalid_phone", 400);
    if (kind === "telegram" && !/^[1-9]\d{0,19}$/.test(value))
      throw new CrmError("invalid_telegram_id", 400);
    const contact: Contact = {
      id: crypto.randomUUID(),
      customerId: c.req.param("id"),
      kind,
      value,
      scope: kind === "telegram" ? text(b, "scope") : "",
      verificationEvidence: null,
      verifiedAt: null,
      createdAt: now,
    };
    await c.get("crm").addContact(contact);
    return c.json({ success: true, data: contact }, 201);
  });
  router.post("/contacts/:id/verify", async (c) => {
    const b = await body(c.req),
      repo = c.get("crm");
    await repo.verifyContact(
      c.req.param("id"),
      text(b, "evidence", 1000),
      deps.now().toISOString(),
    );
    return c.json({
      success: true,
      data: await repo.getContact(c.req.param("id")),
    });
  });
  router.post("/contacts/:id/consents", async (c) => {
    const b = await body(c.req),
      now = deps.now().toISOString();
    const consent: Consent = {
      id: crypto.randomUUID(),
      contactId: c.req.param("id"),
      purpose: choice(b, "purpose", ["recontact", "booking", "marketing"]),
      status: choice(b, "status", ["granted", "revoked"]),
      evidence: text(b, "evidence", 1000),
      policyVersion: text(b, "policyVersion", 100),
      occurredAt: date(b, "occurredAt"),
      recordedAt: now,
    };
    if (consent.occurredAt > now) throw new CrmError("future_consent", 400);
    await c.get("crm").addConsent(consent);
    return c.json({ success: true, data: consent }, 201);
  });
  router.get("/slots", async (c) => {
    const p = page((n) => c.req.query(n));
    return c.json(
      result(
        await c.get("crm").listSlots(p.after, p.limit),
        p.limit,
        (x) => x.id,
      ),
    );
  });
  router.post("/slots", async (c) => {
    const b = await body(c.req),
      now = deps.now().toISOString();
    const startsAt = date(b, "startsAt"),
      endsAt = date(b, "endsAt");
    if (startsAt <= now || endsAt <= startsAt)
      throw new CrmError("invalid_slot_interval", 400);
    if (
      typeof b.capacity !== "number" ||
      !Number.isInteger(b.capacity) ||
      b.capacity < 1 ||
      b.capacity > 1000
    )
      throw new CrmError("invalid_capacity", 400);
    const slot = {
      id: crypto.randomUUID(),
      title: text(b, "title", 120),
      startsAt,
      endsAt,
      capacity: b.capacity,
      createdAt: now,
    };
    await c.get("crm").createSlot(slot);
    return c.json({ success: true, data: slot }, 201);
  });
  router.get("/bookings", async (c) => {
    const p = page((n) => c.req.query(n));
    return c.json(
      result(
        await c.get("crm").listBookings(p.after, p.limit),
        p.limit,
        (x) => x.id,
      ),
    );
  });
  router.post("/bookings", async (c) => {
    const b = await body(c.req);
    const booking = await c
      .get("crm")
      .book({
        id: crypto.randomUUID(),
        customerId: text(b, "customerId", 100),
        slotId: text(b, "slotId", 100),
        requestKey: text(b, "requestKey", 100),
        status: "confirmed",
        createdAt: deps.now().toISOString(),
        cancelledAt: null,
      });
    return c.json({ success: true, data: booking }, 201);
  });
  router.post("/bookings/:id/cancel", async (c) =>
    c.json({
      success: true,
      data: await c
        .get("crm")
        .cancel(c.req.param("id"), deps.now().toISOString()),
    }),
  );
  router.get("/export", async (c) => {
    const p = page((n) => c.req.query(n));
    c.header(
      "Content-Disposition",
      'attachment; filename="crm-customers.json"',
    );
    return c.json({
      ...result(
        await c.get("crm").exportCustomers(p.after, p.limit),
        p.limit,
        (x) => x.id,
      ),
      schemaVersion: 1,
      exportedAt: deps.now().toISOString(),
    });
  });
  router.get("/recontact", async (c) => {
    const p = page((n) => c.req.query(n));
    return c.json({
      ...result(
        await c.get("crm").recontact(p.after, p.limit),
        p.limit,
        (x) => x.contactId,
      ),
      deliveryEnabled: false,
    });
  });
  app.route("/api/crm", router);
}
