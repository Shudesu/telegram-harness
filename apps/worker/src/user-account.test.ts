import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { D1Repo, MemoryRepo, createNodeSqliteD1 } from "@telegram-harness/db";
import { DryRunTelegram } from "@telegram-harness/telegram-sdk";
import { DryRunUserAccount, EnvSecretStore } from "@telegram-harness/user-account";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const PHONE = "+12025550123";

function boot() {
  const repo = new MemoryRepo();
  const telegram = new DryRunTelegram();
  const user = new DryRunUserAccount();
  const env: Record<string, string | undefined> = {
    API_KEY: "test-api-key",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    TELEGRAM_BOT_TOKEN_MAIN: "test-token-value",
    TELEGRAM_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
  };
  let clock = Date.parse("2026-11-03T00:00:00.000Z");
  const app = createApp({
    repo,
    telegram,
    userAccount: user,
    secrets: new EnvSecretStore(env),
    env,
    now: () => new Date(clock),
  });
  return {
    app,
    user,
    telegram,
    env,
    setTime(iso: string) {
      clock = Date.parse(iso);
    },
  };
}

async function api(app: ReturnType<typeof createApp>, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", "Bearer test-api-key");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers });
}

async function login(app: ReturnType<typeof createApp>) {
  const start = await api(app, "/api/user/login/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
  expect(start.status).toBe(200);
  const code = await api(app, "/api/user/login/code", { method: "POST", body: JSON.stringify({ code: "12345" }) });
  expect(code.status).toBe(200);
  return { start: await start.clone().json(), code: await code.json() };
}

describe("user account approval gate", () => {
  it("logs in without returning the phone, code, or session", async () => {
    const { app, env, user } = boot();
    const started = await api(app, "/api/user/login/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
    const startBody = JSON.stringify(await started.json());
    expect(started.status).toBe(200);
    expect(startBody).not.toContain(PHONE);
    expect(startBody).not.toContain("dry-run-session");
    expect(startBody).not.toContain("dry-run-hash");
    expect(env.TELEGRAM_USER_LOGIN_PHONE).toBeTruthy();
    expect(env.TELEGRAM_USER_LOGIN_PHONE).not.toContain(PHONE);

    const coded = await api(app, "/api/user/login/code", { method: "POST", body: JSON.stringify({ code: "12345" }) });
    const codeBody = JSON.stringify(await coded.json());
    expect(coded.status).toBe(200);
    expect(codeBody).toContain("TELEGRAM_USER_SESSION");
    expect(codeBody).not.toContain("dry-run-session");
    expect(codeBody).not.toContain("12345");
    expect(env.TELEGRAM_USER_SESSION?.startsWith("v1.")).toBe(true);
    expect(env.TELEGRAM_USER_LOGIN_PHONE).toBeUndefined();
    expect(JSON.stringify(user.calls)).not.toContain(PHONE);
  });

  it("keeps channel creation behind approve and the publisher", async () => {
    const { app, user } = boot();
    await login(app);
    const created = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "create_channel", title: "News", about: "hello" }),
    });
    expect(created.status).toBe(201);
    const action = (await created.json()) as { data: { id: string; status: string } };
    expect(action.data.status).toBe("pending");
    expect(user.calls.map((call) => call.method)).not.toContain("createChannel");

    const approved = await api(app, `/api/account/actions/${action.data.id}/approve`, { method: "POST" });
    expect((await approved.json()) as { data: { status: string } }).toMatchObject({ data: { status: "scheduled" } });
    expect(user.calls.map((call) => call.method)).not.toContain("createChannel");

    const run = await api(app, "/api/publisher/run", { method: "POST" });
    const report = (await run.json()) as { data: { account: { posted: string[] } } };
    expect(report.data.account.posted).toEqual([action.data.id]);
    expect(user.calls.map((call) => call.method)).toContain("createChannel");
    const stored = await api(app, `/api/account/actions/${action.data.id}`);
    const body = JSON.stringify(await stored.json());
    expect(body).not.toContain("dry-run-hash");
    expect(body).toContain("News");
  });

  it("stores a BotFather token as a secret and does not print it", async () => {
    const { app, env } = boot();
    await login(app);
    const created = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "botfather_create_bot",
        displayName: "Harness",
        username: "harness_example_bot",
        tokenEnvName: "TELEGRAM_BOT_TOKEN_NEWS",
      }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/account/actions/${id}/approve`, { method: "POST" });
    const run = await api(app, "/api/publisher/run", { method: "POST" });
    const runText = JSON.stringify(await run.json());
    expect(runText).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);
    const stored = JSON.stringify(await (await api(app, `/api/account/actions/${id}`)).json());
    expect(stored).toContain("TELEGRAM_BOT_TOKEN_NEWS");
    expect(stored).not.toMatch(/\d{6,}:[A-Za-z0-9_-]{20,}/);
    expect(env.TELEGRAM_BOT_TOKEN_NEWS).toMatch(/^\d+:[A-Za-z0-9_-]+$/);
    const debug = await api(app, "/api/debug/user-calls");
    expect(JSON.stringify(await debug.json())).not.toContain(env.TELEGRAM_BOT_TOKEN_NEWS);
  });

  it("adds a registered harness bot as one admin", async () => {
    const { app, telegram, user, setTime } = boot();
    await login(app);
    const bot = await api(app, "/api/bots", {
      method: "POST",
      body: JSON.stringify({ name: "Main", tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN" }),
    });
    const botId = ((await bot.json()) as { data: { id: string } }).data.id;
    const created = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "create_supergroup", title: "Room" }),
    });
    const createId = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/account/actions/${createId}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    setTime("2026-11-03T00:00:04.000Z");
    const stored = (await (await api(app, `/api/account/actions/${createId}`)).json()) as {
      data: { result: { ownedChatId: string } };
    };
    const admin = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "add_admin", ownedChatId: stored.data.result.ownedChatId, botId }),
    });
    expect(admin.status).toBe(201);
    const adminId = ((await admin.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/account/actions/${adminId}/approve`, { method: "POST" });
    const before = user.calls.length;
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.map((call) => call.method)).toContain("getMe");
    expect(user.calls.slice(before).some((call) => call.detail.startsWith("add:harness_dry_run_bot:"))).toBe(true);
    const bulk = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "add_admin", ownedChatId: stored.data.result.ownedChatId, users: ["a", "b"] }),
    });
    expect(bulk.status).toBe(400);
  });

  it("fails a long FLOOD_WAIT without retrying the write", async () => {
    const { app, user } = boot();
    await login(app);
    const created = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "create_channel", title: "Slow" }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/account/actions/${id}/approve`, { method: "POST" });
    user.scriptedError = new Error("FLOOD_WAIT_45");
    await api(app, "/api/publisher/run", { method: "POST" });
    const stored = (await (await api(app, `/api/account/actions/${id}`)).json()) as { data: { status: string; error: string } };
    expect(stored.data.status).toBe("failed");
    expect(stored.data.error).toBe("flood_wait:45");
    expect(user.calls.filter((call) => call.method === "createChannel")).toHaveLength(1);
  });

  it("caps login code sends", async () => {
    const { app, user } = boot();
    for (let i = 0; i < 3; i += 1) {
      const response = await api(app, "/api/user/login/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
      expect(response.status).toBe(200);
    }
    const blocked = await api(app, "/api/user/login/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
    expect(blocked.status).toBe(429);
    expect(user.calls.filter((call) => call.method === "sendCode")).toHaveLength(3);
  });

  it("asks for the 2FA password without echoing it", async () => {
    const { app, user } = boot();
    user.passwordRequired = true;
    await api(app, "/api/user/login/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
    const coded = await api(app, "/api/user/login/code", { method: "POST", body: JSON.stringify({ code: "12345" }) });
    expect(await coded.json()).toMatchObject({ data: { status: "password_required" } });
    const password = await api(app, "/api/user/login/password", {
      method: "POST",
      body: JSON.stringify({ password: "correct horse" }),
    });
    const text = JSON.stringify(await password.json());
    expect(password.status).toBe(200);
    expect(text).not.toContain("correct horse");
    expect(text).toContain("authorized");
  });

  it("persists an account action through sqlite", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(here, "../../../packages/db/schema.sql"), "utf8");
    const database = new DatabaseSync(":memory:");
    database.exec(sql);
    const env: Record<string, string | undefined> = {
      API_KEY: "test-api-key",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
      TELEGRAM_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64url"),
    };
    const app = createApp({
      repo: new D1Repo(createNodeSqliteD1(database)),
      telegram: new DryRunTelegram(),
      userAccount: new DryRunUserAccount(),
      secrets: new EnvSecretStore(env),
      env,
      now: () => new Date("2026-11-03T00:00:00.000Z"),
    });
    await login(app);
    const created = await api(app, "/api/account/actions", {
      method: "POST",
      body: JSON.stringify({ action: "create_channel", title: "Sqlite" }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/account/actions/${id}/approve`, { method: "POST" });
    const run = await api(app, "/api/publisher/run", { method: "POST" });
    expect(run.status).toBe(200);
    const columns = database.prepare("PRAGMA table_info(account_actions)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain("session");
    expect(columns.map((column) => column.name)).not.toContain("token");
  });
});
