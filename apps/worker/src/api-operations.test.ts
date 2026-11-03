import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepo, D1Repo, createNodeSqliteD1, type Repo } from "@telegram-harness/db";
import { BOT_METHODS, BOT_SCHEMAS, USER_OPERATIONS, type BotMethod, type UserOperation, type AccountAction } from "@telegram-harness/shared";
import { sample, userFixtures } from "../../../packages/shared/src/api-test-fixtures.js";
import { DisabledTelegram, DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { DryRunUserAccount, EnvSecretStore, encryptSession } from "@telegram-harness/user-account";
import { createApp } from "./app.js";

async function boot(repo: Repo = new MemoryRepo(), withUser = false) {
  const telegram = new DryRunTelegram();
  const user = new DryRunUserAccount();
  const env: Record<string,string> = { API_KEY: "test-key", TELEGRAM_BOT_TOKEN_MAIN: "test-bot-placeholder", TELEGRAM_WEBHOOK_SECRET: "test-hook-placeholder", TELEGRAM_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url") };
  if (withUser) env.TELEGRAM_USER_SESSION = await encryptSession("mock-session", Buffer.alloc(32,9));
  let clock = Date.parse("2026-11-04T00:00:00.000Z");
  const app = createApp({ repo, telegram, ...(withUser ? { userAccount: user } : {}), env, secrets: new EnvSecretStore(env), now: () => new Date(clock) });
  await repo.insertBot({ id: "bot-1", name: "Test", tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN", createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() });
  async function api(path: string, body?: unknown) {
    return app.request(path, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer test-key", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  return { repo, telegram, user, app, api, env, advance: (ms = 10_000) => { clock += ms; } };
}

describe("all Bot methods through HTTP and the existing approval queue", () => {
  it.each(Object.keys(BOT_METHODS) as BotMethod[])("%s obeys its reviewed permission and runs at most once", async (method) => {
    const { api, telegram, repo } = await boot();
    const body = { botId: "bot-1", method, params: sample(BOT_SCHEMAS[method]) };
    const mode = BOT_METHODS[method].mode;
    if (mode === "excluded") {
      expect((await api("/api/bot/read", body)).status).toBe(400);
      expect((await api("/api/bot/requests", body)).status).toBe(400);
      expect(telegram.calls).toHaveLength(0);
      return;
    }
    if (mode === "read") {
      expect((await api("/api/bot/requests", body)).status).toBe(400);
      expect((await api("/api/bot/read", body)).status).toBe(200);
      expect(telegram.calls.map((c) => c.method)).toEqual([method]);
      expect(await repo.listAccountActions()).toEqual([]);
      return;
    }
    expect((await api("/api/bot/read", body)).status).toBe(400);
    const response = await api("/api/bot/requests", body);
    expect(response.status).toBe(201);
    const action = (await response.json()).data as AccountAction;
    expect(action.status).toBe("pending");
    expect(action.approvedAt).toBeNull();
    await api("/api/publisher/run", {});
    expect(telegram.calls).toHaveLength(0);
    expect((await api(`/api/account/actions/${action.id}/approve`, {})).status).toBe(200);
    expect(telegram.calls).toHaveLength(0);
    await Promise.all([api("/api/publisher/run", {}), api("/api/publisher/run", {})]);
    expect(telegram.calls.map((c) => c.method)).toEqual([method]);
    expect((await repo.getAccountAction(action.id))?.status).toBe("posted");
    expect((await api(`/api/account/actions/${action.id}/approve`, {})).status).toBe(409);
  });
});

describe("all owner operations through HTTP and approval", () => {
  it.each(Object.keys(USER_OPERATIONS) as UserOperation[])("%s respects the queue boundary", async (operation) => {
    const { api, user, repo } = await boot(undefined, true);
    const body = { operation, params: userFixtures[operation] };
    const read = USER_OPERATIONS[operation].mode === "read";
    expect((await api(read ? "/api/user/requests" : "/api/user/read", body)).status).toBe(400);
    const response = await api(read ? "/api/user/read" : "/api/user/requests", body);
    expect(response.status).toBe(read ? 200 : 201);
    if (!read) {
      const action = (await response.json()).data as AccountAction;
      await api("/api/publisher/run", {});
      expect(user.calls).toHaveLength(0);
      await api(`/api/account/actions/${action.id}/approve`, {});
      expect(user.calls).toHaveLength(0);
      await api("/api/publisher/run", {});
      await api("/api/publisher/run", {});
      expect((await repo.getAccountAction(action.id))?.status).toBe("posted");
    }
    expect(user.calls).toEqual([{ method: "executeOperation", detail: operation }]);
  });
});

describe("API safety and queue transitions", () => {
  it("authenticates discovery and requests; rejects malformed bodies, extra control fields, and arbitrary calls", async () => {
    const { app, api, telegram } = await boot();
    expect((await app.request("/api/operations")).status).toBe(401);
    expect((await api("/api/operations?provider=bot&name=sendPoll")).status).toBe(200);
    expect((await api("/api/operations?provider=user&name=auth.LogOut")).status).toBe(404);
    for (const body of [null, [], { botId: "bot-1", method: "sendMessage", params: { chat_id: 1, text: "hi" }, status: "scheduled" }, { botId: "bot-1", method: "sendMessage", params: { chat_id: 1, text: "hi" }, scheduledAt: 1 }]) expect((await api("/api/bot/requests", body)).status).toBe(400);
    expect((await api("/api/user/requests", { operation: "auth.LogOut", params: {} })).status).toBe(400);
    expect((await api("/api/account/actions", { action: "bot_api_call", payload: {} })).status).toBe(400);
    expect(telegram.calls).toHaveLength(0);
  });
  it("keeps failed requests failed until requeue and a new approval; hides upstream errors", async () => {
    const { api, repo, telegram } = await boot();
    const action = (await (await api("/api/bot/requests", { botId: "bot-1", method: "sendMessage", params: { chat_id: 1, text: "hi" } })).json()).data as AccountAction;
    const call = vi.spyOn(telegram, "call").mockRejectedValueOnce(new Error("secret echoed by upstream"));
    await api(`/api/account/actions/${action.id}/approve`, {});
    await api("/api/publisher/run", {});
    expect((await repo.getAccountAction(action.id))?.error).toBe("bot_api_call_failed");
    await api("/api/publisher/run", {});
    expect(call).toHaveBeenCalledTimes(1);
    await api(`/api/account/actions/${action.id}/requeue`, {});
    await api("/api/publisher/run", {});
    expect(call).toHaveBeenCalledTimes(1);
    await api(`/api/account/actions/${action.id}/approve`, {});
    await api("/api/publisher/run", {});
    expect(call).toHaveBeenCalledTimes(2);
    expect((await repo.getAccountAction(action.id))?.status).toBe("posted");
  });
  it("honors future schedules, cancellation, and rejection", async () => {
    const { api, telegram, advance } = await boot();
    const action = (await (await api("/api/bot/requests", { botId: "bot-1", method: "deleteWebhook", params: {}, scheduledAt: "2026-11-04T01:00:00.000Z" })).json()).data;
    await api(`/api/account/actions/${action.id}/approve`, {});
    await api("/api/publisher/run", {});
    expect(telegram.calls).toHaveLength(0);
    await api(`/api/account/actions/${action.id}/cancel`, {});
    advance(3_600_000);
    await api("/api/publisher/run", {});
    await api(`/api/account/actions/${action.id}/reject`, {});
    expect((await api(`/api/account/actions/${action.id}/approve`, {})).status).toBe(409);
    await api("/api/publisher/run", {});
    expect(telegram.calls).toHaveLength(0);
  });
  it("revalidates persisted payloads and leaves disabled operations scheduled", async () => {
    const { api, repo, telegram, env } = await boot();
    const action = (await (await api("/api/bot/requests", { botId: "bot-1", method: "deleteWebhook", params: {} })).json()).data as AccountAction;
    await api(`/api/account/actions/${action.id}/approve`, {});
    const disabledApp = createApp({ repo, telegram: new DisabledTelegram(), env, now: () => new Date("2026-11-04T00:00:01Z") });
    await disabledApp.request("/api/publisher/run", { method: "POST", headers: { authorization: "Bearer test-key" } });
    expect((await repo.getAccountAction(action.id))?.status).toBe("scheduled");
    const tampered = (await repo.getAccountAction(action.id))!;
    tampered.payload.method = "logOut";
    await repo.saveAccountAction(tampered);
    await api("/api/publisher/run", {});
    expect(telegram.calls).toHaveLength(0);
    expect((await repo.getAccountAction(action.id))?.status).toBe("failed");
  });
  it("uses secret references without persisting values or leaking result fields", async () => {
    const { api, telegram, repo, env } = await boot();
    const request = { botId: "bot-1", method: "setWebhook", params: { url: "https://example.com/hook", secret_token: { secretEnvName: "TELEGRAM_WEBHOOK_SECRET" } } };
    const action = (await (await api("/api/bot/requests", request)).json()).data as AccountAction;
    const call = vi.spyOn(telegram, "call").mockResolvedValue({ token: "private-value", accessHash: "hash", nested: { text: env.TELEGRAM_WEBHOOK_SECRET } });
    await api(`/api/account/actions/${action.id}/approve`, {});
    await api("/api/publisher/run", {});
    expect(call.mock.calls[0][2]).toMatchObject({ secret_token: env.TELEGRAM_WEBHOOK_SECRET });
    const stored = JSON.stringify(await repo.getAccountAction(action.id));
    expect(stored).not.toContain(env.TELEGRAM_WEBHOOK_SECRET);
    expect(stored).not.toContain("private-value");
    expect(stored).not.toContain("accessHash");
    expect(stored).toContain("TELEGRAM_WEBHOOK_SECRET");
  });
  it("reschedules every rate-limited owner operation instead of stranding claimed rows", async () => {
    const { api, repo, user, advance } = await boot(undefined, true);
    const actions = [];
    for (let i=0; i<3; i++) {
      const action = (await (await api("/api/user/requests", { operation: "send_message", params: { peer: "me", text: "hello" } })).json()).data;
      actions.push(action.id);
      await api(`/api/account/actions/${action.id}/approve`, {});
    }
    await api("/api/publisher/run", {});
    expect(user.calls).toHaveLength(1);
    expect((await repo.listAccountActions()).map((a) => a.status).sort()).toEqual(["posted", "scheduled", "scheduled"]);
    advance(); await api("/api/publisher/run", {});
    advance(); await api("/api/publisher/run", {});
    expect(user.calls).toHaveLength(3);
    expect((await repo.listAccountActions()).every((a) => a.status === "posted")).toBe(true);
  });
});

describe("D1/SQLite queue and migrations", () => {
  it("upgrades populated v2 tables, atomically approves/cancels, and executes new actions", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const name of ["0001_init.sql", "0002_user_account.sql"]) db.exec(readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), "utf8"));
      const repo = new D1Repo(createNodeSqliteD1(db));
      const stamp = "2026-11-04T00:00:00.000Z";
      const old: AccountAction = { id: "old", action: "create_channel", status: "pending", payload: { title: "Kept", about: "" }, summary: "kept", scheduledAt: null, approvedAt: null, error: null, result: null, createdAt: stamp, updatedAt: stamp };
      await repo.insertAccountAction(old);
      db.exec(readFileSync(new URL("../../../packages/db/migrations/0003_api_operations.sql", import.meta.url), "utf8"));
      expect(await repo.getAccountAction("old")).toEqual(old);
      const { api, telegram } = await boot(repo);
      const action = (await (await api("/api/bot/requests", { botId: "bot-1", method: "sendMessage", params: { chat_id: 1, text: "hi" } })).json()).data as AccountAction;
      const responses = await Promise.all([api(`/api/account/actions/${action.id}/approve`, {}), api(`/api/account/actions/${action.id}/approve`, {})]);
      expect(responses.map((r) => r.status).sort()).toEqual([200,409]);
      await Promise.all([api("/api/publisher/run", {}), api("/api/publisher/run", {})]);
      expect(telegram.calls).toHaveLength(1);
      expect(await repo.transitionAccountAction({ ...action, status: "pending" }, "scheduled")).toBe(false);
      expect((await repo.getAccountAction(action.id))?.status).toBe("posted");
    } finally { db.close(); }
  });
});

describe("independent providers", () => {
  it("does not let a disabled owner queue starve approved Bot API requests", async () => {
    const { api, repo, telegram } = await boot();
    for (let i=0; i<21; i++) {
      const action = (await (await api("/api/user/requests", { operation: "send_message", params: { peer: "me", text: "hi" } })).json()).data;
      await api(`/api/account/actions/${action.id}/approve`, {});
    }
    const bot = (await (await api("/api/bot/requests", { botId: "bot-1", method: "deleteWebhook", params: {} })).json()).data;
    await api(`/api/account/actions/${bot.id}/approve`, {});
    await api("/api/publisher/run", {});
    expect(telegram.calls).toHaveLength(1);
    expect((await repo.listAccountActions()).filter((a) => a.status === "scheduled")).toHaveLength(21);
  });
});

it("requires an approval timestamp when claiming account actions in both repositories", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(readFileSync(new URL("../../../packages/db/schema.sql", import.meta.url), "utf8"));
    for (const repo of [new MemoryRepo(), new D1Repo(createNodeSqliteD1(database))]) {
      const { api } = await boot(repo);
      const action = (await (await api("/api/bot/requests", { botId: "bot-1", method: "deleteWebhook", params: {} })).json()).data as AccountAction;
      action.status = "scheduled";
      await repo.saveAccountAction(action);
      expect(await repo.claimDueAccountActions("2026-11-04T00:00:01.000Z")).toEqual([]);
    }
  } finally { database.close(); }
});
