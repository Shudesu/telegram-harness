import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { D1Repo, createNodeSqliteD1 } from "@telegram-harness/db";
import { openNodeSqliteRepo } from "@telegram-harness/db/sqlite";
import { DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { TelegramHarnessClient } from "../../../packages/sdk/src/index.js";
import { executeTool, toolDefs } from "../../../packages/mcp/src/tools.js";
import { createApp } from "./app.js";
const schema = readFileSync(
  new URL("../../../packages/db/schema.sql", import.meta.url),
  "utf8",
);
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  cleanup.push(() => db.close());
  const telegram = new DryRunTelegram();
  const repo = new D1Repo(createNodeSqliteD1(db));
  const app = createApp({
    repo,
    telegram,
    env: { API_KEY: "test-crm-key", INTAKE_API_KEY: "test-intake" },
    now: () => new Date("2026-11-05T09:00:00Z"),
  });
  async function call(path: string, b?: unknown, key = "test-crm-key") {
    const response = await app.request(`/api/crm/${path}`, {
      method: b === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return {
      status: response.status,
      ...((await response.json()) as Record<string, any>),
    };
  }
  const customer = (name = "Test") =>
    call("customers", {
      displayName: name,
      source: "test fixture",
      tags: ["new"],
    });
  const slot = (capacity = 1) =>
    call("slots", {
      title: "Consultation",
      startsAt: "2026-12-01T13:00:00+09:00",
      endsAt: "2026-12-01T14:00:00+09:00",
      capacity,
    });
  return { db, repo, app, call, customer, slot, telegram };
}
describe("CRM API, real SQLite + D1 adapter (no network)", () => {
  it("requires management authorization on every CRM route, including export and contact verification", async () => {
    const { call } = fixture();
    for (const [path, b] of [
      ["customers", undefined],
      ["export", undefined],
      ["recontact", undefined],
      ["slots", {}],
      ["bookings", {}],
      ["contacts/nope/verify", {}],
      ["contacts/nope/consents", {}],
    ] as const) {
      expect((await call(path, b, "")).status).toBe(401);
      expect((await call(path, b, "test-intake")).status).toBe(401);
    }
  });
  it("persists independent identity, tags, consent history and bookings in export", async () => {
    const f = fixture(),
      c = (await f.customer()).data;
    await f.call(`customers/${c.id}/update`, {
      displayName: "Updated",
      source: "seminar",
      tags: ["return", "return"],
    });
    const contact = (
      await f.call(`customers/${c.id}/contacts`, {
        kind: "email",
        value: "CUSTOMER@example.test",
      })
    ).data;
    expect(contact.value).toBe("customer@example.test");
    expect(
      (
        await f.call(`customers/${c.id}/contacts`, {
          kind: "email",
          value: contact.value,
        })
      ).status,
    ).toBe(409);
    const consent = {
      purpose: "recontact",
      status: "granted",
      evidence: "signed form test",
      policyVersion: "v1",
      occurredAt: "2026-11-05T08:00:00Z",
    };
    expect(
      (await f.call(`contacts/${contact.id}/consents`, consent)).status,
    ).toBe(201);
    expect((await f.call("recontact")).data).toEqual([]); // Not verified yet
    await f.call(`contacts/${contact.id}/verify`, {
      evidence: "owner checked signed form",
    });
    expect((await f.call("recontact")).data).toHaveLength(1);
    const s = (await f.slot()).data;
    await f.call("bookings", {
      customerId: c.id,
      slotId: s.id,
      requestKey: "export-test",
    });
    const exported = await f.call("export");
    expect(exported.data[0]).toMatchObject({
      displayName: "Updated",
      tags: ["return"],
      contacts: [{ id: contact.id }],
      bookings: [{ slotId: s.id }],
      purchases: [],
    });
    expect(exported.data[0].consents).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toMatch(/test-crm-key|token_env_name/);
    expect(f.telegram.calls).toHaveLength(0);
  });
  it("withdrawal, purpose isolation, Telegram exclusion and stale consent rejection", async () => {
    const f = fixture(),
      c = (await f.customer()).data;
    const contacts = [];
    for (const [kind, value, scope] of [
      ["email", "user@example.test", ""],
      ["phone", "+819000000001", ""],
      ["telegram", "1234567", "unavailable-bot"],
    ]) {
      const contact = (
        await f.call(`customers/${c.id}/contacts`, { kind, value, scope })
      ).data;
      contacts.push(contact);
      await f.call(`contacts/${contact.id}/verify`, {
        evidence: "fixture verified",
      });
      await f.call(`contacts/${contact.id}/consents`, {
        purpose: kind === "phone" ? "marketing" : "recontact",
        status: "granted",
        evidence: "fixture grant",
        policyVersion: "v1",
        occurredAt: "2026-11-05T07:00:00Z",
      });
    }
    expect((await f.call("recontact")).data.map((x: any) => x.kind)).toEqual([
      "email",
    ]);
    const path = `contacts/${contacts[0].id}/consents`;
    await f.call(path, {
      purpose: "recontact",
      status: "revoked",
      evidence: "withdrawn by owner",
      policyVersion: "v1",
      occurredAt: "2026-11-05T08:00:00Z",
    });
    expect((await f.call("recontact")).data).toEqual([]);
    expect(
      (
        await f.call(path, {
          purpose: "recontact",
          status: "granted",
          evidence: "stale import",
          policyVersion: "v1",
          occurredAt: "2026-11-05T07:30:00Z",
        })
      ).status,
    ).toBe(409);
    expect((await f.call(`customers/${c.id}`)).data.consents).toHaveLength(4);
  });
  it("atomic capacity, idempotent replay, request key conflicts and cancellation reopening capacity", async () => {
    const f = fixture(),
      c1 = (await f.customer("One")).data,
      c2 = (await f.customer("Two")).data,
      s = (await f.slot()).data;
    const requests = [c1, c2].map((c, i) => ({
      customerId: c.id,
      slotId: s.id,
      requestKey: `booking-${i}`,
    }));
    const replies = await Promise.all(
      requests.map((b) => f.call("bookings", b)),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = replies.findIndex((r) => r.status === 201),
      loser = 1 - winner;
    expect((await f.call("bookings", requests[winner])).data.id).toBe(
      replies[winner]!.data.id,
    );
    expect(
      (
        await f.call("bookings", {
          ...requests[loser],
          requestKey: requests[winner]!.requestKey,
        })
      ).error,
    ).toBe("request_key_conflict");
    expect((await f.call("slots")).data[0].booked).toBe(1);
    const cancel1 = await f.call(
      `bookings/${replies[winner]!.data.id}/cancel`,
      {},
    );
    const cancel2 = await f.call(
      `bookings/${replies[winner]!.data.id}/cancel`,
      {},
    );
    expect(cancel2.data).toEqual(cancel1.data);
    expect((await f.call("bookings", requests[winner])).data.status).toBe(
      "cancelled",
    );
    expect((await f.call("bookings", requests[loser])).status).toBe(201);
    expect((await f.call("slots")).data[0].booked).toBe(1);
  });
  it("rejects malformed inputs, past slots, dangling references and unauthorized oversized bodies", async () => {
    const f = fixture();
    for (const b of [
      null,
      [],
      { displayName: 3, source: "x" },
      { displayName: "x", source: "x", tags: [null] },
    ])
      expect((await f.call("customers", b)).status).toBe(400);
    expect(
      (
        await f.call("customers", {
          displayName: "x".repeat(70000),
          source: "x",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await f.call("slots", {
          title: "bad",
          startsAt: "2026-02-30T13:00:00Z",
          endsAt: "2027-01-01T14:00:00Z",
          capacity: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call("slots", {
          title: "past",
          startsAt: "2026-01-01T13:00:00Z",
          endsAt: "2026-01-01T14:00:00Z",
          capacity: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call("bookings", {
          customerId: "missing",
          slotId: "missing",
          requestKey: "x",
        })
      ).status,
    ).toBe(404);
    expect((await f.call("customers?limit=10000")).status).toBe(400);
    expect((await f.call("bookings/missing/cancel", {})).status).toBe(404);
  });
  it("paginates export without missing or duplicating customers", async () => {
    const f = fixture();
    await f.customer("One");
    await f.customer("Two");
    await f.customer("Three");
    const ids: string[] = [];
    let after = "";
    do {
      const r = await f.call(`export?limit=1&after=${after}`);
      ids.push(...r.data.map((x: any) => x.id));
      after = r.nextCursor;
    } while (after);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
  it("supports all fourteen MCP tools against the real API", async () => {
    const f = fixture();
    const client = new TelegramHarnessClient(
      "http://local.test",
      "test-crm-key",
      (async (url, init) => f.app.request(String(url), init)) as typeof fetch,
    );
    const run = (name: string, args: Record<string, unknown> = {}) =>
      executeTool(client, name, args) as Promise<any>;
    expect(toolDefs.filter((t) => t.name.startsWith("crm_"))).toHaveLength(14);
    const c = (
      await run("crm_create_customer", { displayName: "MCP", source: "test" })
    ).data;
    await run("crm_update_customer", {
      customerId: c.id,
      displayName: "MCP2",
      source: "test",
      tags: ["mcp"],
    });
    expect(
      (await run("crm_get_customer", { customerId: c.id })).data.displayName,
    ).toBe("MCP2");
    expect((await run("crm_list_customers")).data).toHaveLength(1);
    const contact = (
      await run("crm_add_contact", {
        customerId: c.id,
        kind: "email",
        value: "mcp@example.test",
      })
    ).data;
    await run("crm_verify_contact", {
      contactId: contact.id,
      evidence: "fixture proof",
    });
    await run("crm_record_consent", {
      contactId: contact.id,
      purpose: "recontact",
      status: "granted",
      evidence: "fixture consent",
      policyVersion: "v1",
      occurredAt: "2026-11-05T08:00:00Z",
    });
    expect((await run("crm_list_recontact")).data).toHaveLength(1);
    const s = (
      await run("crm_create_slot", {
        title: "MCP slot",
        startsAt: "2026-12-01T13:00:00+09:00",
        endsAt: "2026-12-01T14:00:00+09:00",
        capacity: 1,
      })
    ).data;
    expect((await run("crm_list_slots")).data).toHaveLength(1);
    const b = (
      await run("crm_book", {
        customerId: c.id,
        slotId: s.id,
        requestKey: "mcp-1",
      })
    ).data;
    expect((await run("crm_list_bookings")).data).toHaveLength(1);
    expect(
      (await run("crm_cancel_booking", { bookingId: b.id })).data.status,
    ).toBe("cancelled");
    expect((await run("crm_export_customers")).data[0].consents).toHaveLength(
      1,
    );
    expect(f.telegram.calls).toEqual([]);
  });
  it("applies migrations and keeps CRM across reopening the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telegram-crm-test-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "crm.sqlite");
    let handle = openNodeSqliteRepo(path);
    await handle.repo.crm.saveCustomer({
      id: "durable",
      displayName: "Durable",
      source: "fixture",
      tags: [],
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:00.000Z",
    });
    handle.close();
    handle = openNodeSqliteRepo(path);
    cleanup.push(() => handle.close());
    expect((await handle.repo.crm.getCustomer("durable"))?.displayName).toBe(
      "Durable",
    );
  });
});
