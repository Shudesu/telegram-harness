import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { D1Repo, MemoryRepo, createNodeSqliteD1 } from "@telegram-harness/db";
import { DisabledTelegram, DryRunTelegram, LiveTelegram, type TelegramClient } from "@telegram-harness/telegram-sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const TOKEN = "test-token-value";

function boot(telegram: TelegramClient = new DryRunTelegram()) {
  const repo = new MemoryRepo();
  let clock = Date.parse("2026-11-03T00:00:00.000Z");
  const env = {
    API_KEY: "test-api-key",
    INTAKE_API_KEY: "test-intake-key",
    TELEGRAM_WEBHOOK_SECRET: "hook-secret",
    TELEGRAM_BOT_TOKEN_MAIN: TOKEN,
  };
  const app = createApp({
    repo,
    telegram,
    env,
    now: () => new Date(clock),
  });
  return {
    app,
    telegram,
    repo,
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

async function seed(app: ReturnType<typeof createApp>) {
  const botRes = await api(app, "/api/bots", {
    method: "POST",
    body: JSON.stringify({ name: "Main", tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN" }),
  });
  const bot = (await botRes.json()) as { data: { id: string } };
  const channelRes = await api(app, "/api/channels", {
    method: "POST",
    body: JSON.stringify({ botId: bot.data.id, chatId: "@example_channel", title: "Example", kind: "channel" }),
  });
  const channel = (await channelRes.json()) as { data: { id: string } };
  return { botId: bot.data.id, channelId: channel.data.id };
}

describe("approval gate", () => {
  it("keeps every send behind approve and the publisher", async () => {
    const { app, telegram } = boot();
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        channelId,
        kind: "text",
        text: "hello channel",
        buttons: [{ text: "Open", url: "https://example.com/post" }],
      }),
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { data: { id: string; status: string } };
    expect(draft.data.status).toBe("pending");
    expect(telegram.calls).toHaveLength(0);

    const tooEarly = await api(app, "/api/publisher/run", { method: "POST" });
    expect((await tooEarly.json()) as { data: { posted: string[] } }).toMatchObject({ data: { posted: [] } });
    expect(telegram.calls).toHaveLength(0);

    const approved = await api(app, `/api/drafts/${draft.data.id}/approve`, { method: "POST" });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as { data: { status: string } };
    expect(approvedBody.data.status).toBe("scheduled");
    expect(telegram.calls).toHaveLength(0);

    const published = await api(app, "/api/publisher/run", { method: "POST" });
    const report = (await published.json()) as { data: { posted: string[] } };
    expect(report.data.posted).toEqual([draft.data.id]);
    expect(telegram.calls).toEqual([
      {
        method: "sendMessage",
        body: {
          chat_id: "@example_channel",
          text: "hello channel",
          reply_markup: { inline_keyboard: [[{ text: "Open", url: "https://example.com/post" }]] },
        },
      },
    ]);
    expect(JSON.stringify(telegram.calls)).not.toContain(TOKEN);
  });

  it("does not send a rejected draft or a future schedule", async () => {
    const { app, telegram, setTime } = boot();
    const { channelId } = await seed(app);
    const rejectedRes = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId, kind: "text", text: "nope" }),
    });
    const rejected = (await rejectedRes.json()) as { data: { id: string } };
    expect((await api(app, `/api/drafts/${rejected.data.id}/reject`, { method: "POST" })).status).toBe(200);
    await api(app, "/api/publisher/run", { method: "POST" });

    const later = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        channelId,
        kind: "photo",
        text: "caption",
        media: [{ type: "photo", url: "https://example.com/a.jpg" }],
        scheduledAt: "2026-11-04T00:00:00.000Z",
      }),
    });
    const scheduled = (await later.json()) as { data: { id: string } };
    await api(app, `/api/drafts/${scheduled.data.id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls).toHaveLength(0);

    setTime("2026-11-04T00:00:01.000Z");
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.map((call) => call.method)).toEqual(["sendPhoto"]);
  });

  it("blocks the publisher when live network is disabled and does not mark the draft posted", async () => {
    const telegram = new DisabledTelegram();
    const { app } = boot(telegram);
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId, kind: "text", text: "wait" }),
    });
    const draft = (await created.json()) as { data: { id: string } };
    await api(app, `/api/drafts/${draft.data.id}/approve`, { method: "POST" });
    const run = await api(app, "/api/publisher/run", { method: "POST" });
    expect(run.status).toBe(409);
    const stored = await api(app, `/api/drafts/${draft.data.id}`);
    expect(await stored.json()).toMatchObject({ data: { status: "scheduled" } });
  });

  it("redacts the bot token when a send fails", async () => {
    const telegram: TelegramClient = {
      mode: "dry-run",
      calls: [],
      async call(token: string) {
        throw new Error(`upstream blew up with ${token}`);
      },
    };
    const { app } = boot(telegram);
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId, kind: "text", text: "x" }),
    });
    const draft = (await created.json()) as { data: { id: string } };
    await api(app, `/api/drafts/${draft.data.id}/approve`, { method: "POST" });
    const run = await api(app, "/api/publisher/run", { method: "POST" });
    const body = (await run.json()) as { data: { failed: { error: string }[] } };
    expect(body.data.failed[0]?.error).not.toContain(TOKEN);
    const stored = await api(app, `/api/drafts/${draft.data.id}`);
    expect(JSON.stringify(await stored.json())).not.toContain(TOKEN);
  });

  it("requires a fresh approval before a failed draft can send", async () => {
    let failNext = true;
    const telegram: TelegramClient = {
      mode: "dry-run",
      calls: [],
      async call(_token: string, method: string, body: Record<string, unknown>) {
        if (failNext) {
          failNext = false;
          throw new Error("temporary");
        }
        this.calls.push({ method, body });
        return { message_id: 7 };
      },
    };
    const { app } = boot(telegram);
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId, kind: "text", text: "retry me" }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/drafts/${id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls).toHaveLength(0);
    await api(app, `/api/drafts/${id}/requeue`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls).toHaveLength(0);
    await api(app, `/api/drafts/${id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls).toHaveLength(1);
  });

  it("edits and deletes only after their own approval", async () => {
    const { app, telegram } = boot();
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({ channelId, kind: "text", text: "original" }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/drafts/${id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    const messages = (await (await api(app, "/api/messages")).json()) as { data: { id: string }[] };
    const messageId = messages.data[0]?.id ?? "";
    const edit = await api(app, `/api/messages/${messageId}/edits`, {
      method: "POST",
      body: JSON.stringify({ text: "updated" }),
    });
    const editId = ((await edit.json()) as { data: { id: string; status: string } }).data;
    expect(editId.status).toBe("pending");
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.map((call) => call.method)).toEqual(["sendMessage"]);
    await api(app, `/api/drafts/${editId.id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.map((call) => call.method)).toEqual(["sendMessage", "editMessageText"]);

    const removal = await api(app, `/api/messages/${messageId}/deletes`, { method: "POST" });
    const removalId = ((await removal.json()) as { data: { id: string } }).data.id;
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.map((call) => call.method)).not.toContain("deleteMessages");
    await api(app, `/api/drafts/${removalId}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls.at(-1)?.method).toBe("deleteMessages");
  });

  it("stores webhook messages and sends a reply only after approval", async () => {
    const { app, telegram } = boot();
    const { botId, channelId } = await seed(app);
    await api(app, "/api/channels", {
      method: "POST",
      body: JSON.stringify({ botId, chatId: "-100200", title: "Discussion", kind: "supergroup" }),
    });
    const webhook = await app.request(`/api/telegram/webhook/${botId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "hook-secret",
      },
      body: JSON.stringify({
        update_id: 10,
        message: {
          message_id: 55,
          text: "nice post",
          chat: { id: -100200, type: "supergroup" },
          reply_to_message: { message_id: 1 },
          from: { id: 9 },
        },
      }),
    });
    expect(webhook.status).toBe(201);
    const incoming = (await webhook.json()) as { data: { id: string; kind: string } };
    expect(incoming.data.kind).toBe("comment");
    const duplicate = await app.request(`/api/telegram/webhook/${botId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "hook-secret",
      },
      body: JSON.stringify({ update_id: 10, message: { message_id: 55, text: "nice post", chat: { id: -100200, type: "supergroup" } } }),
    });
    expect(await duplicate.json()).toMatchObject({ data: { duplicate: true } });
    const unauthenticated = await app.request(`/api/telegram/webhook/${botId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 11, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "x" } }),
    });
    expect(unauthenticated.status).toBe(401);

    const reply = await api(app, `/api/incoming/${incoming.data.id}/replies`, {
      method: "POST",
      body: JSON.stringify({ kind: "text", text: "thanks" }),
    });
    const replyDraft = (await reply.json()) as { data: { id: string; status: string } };
    expect(replyDraft.data.status).toBe("pending");
    expect(telegram.calls).toHaveLength(0);
    await api(app, `/api/drafts/${replyDraft.data.id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls[0]).toMatchObject({
      method: "sendMessage",
      body: { chat_id: "-100200", text: "thanks", reply_parameters: { message_id: 55 } },
    });
    expect(channelId).toBeTruthy();
  });

  it("accepts cross-post intake as a pending draft and is idempotent", async () => {
    const { app, telegram } = boot();
    const { channelId } = await seed(app);
    const body = JSON.stringify({
      source: "x-harness",
      sourceRef: "draft-1",
      channelId,
      kind: "album",
      text: "album",
      media: [
        { type: "photo", url: "https://example.com/1.jpg" },
        { type: "video", url: "https://example.com/2.mp4" },
      ],
    });
    const first = await api(app, "/api/intake/drafts", {
      method: "POST",
      headers: { authorization: "Bearer test-intake-key" },
      body,
    });
    expect(first.status).toBe(201);
    const second = await api(app, "/api/intake/drafts", {
      method: "POST",
      headers: { authorization: "Bearer test-intake-key" },
      body,
    });
    const again = (await second.json()) as { idempotent: boolean; data: { status: string } };
    expect(again.idempotent).toBe(true);
    expect(again.data.status).toBe("pending");
    expect(telegram.calls).toHaveLength(0);

    const withButtons = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        channelId,
        kind: "album",
        media: [
          { type: "photo", url: "https://example.com/1.jpg" },
          { type: "photo", url: "https://example.com/2.jpg" },
        ],
        buttons: [{ text: "Go", url: "https://example.com" }],
      }),
    });
    expect(withButtons.status).toBe(400);
  });

  it("returns member count from getChatMemberCount and does not invent views", async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { chat_id?: string };
      const method = String(_url).split("/").pop();
      if (method === "getChatMemberCount") return jsonResponse({ ok: true, result: 128 });
      if (method === "getChat") {
        return jsonResponse({ ok: true, result: { id: body.chat_id, title: "Example", type: "channel", username: "example_channel" } });
      }
      return jsonResponse({ ok: false, description: "nope", error_code: 400 });
    };
    const telegram = new LiveTelegram({ allowNetwork: true, fetchImpl: fetchImpl as typeof fetch });
    const { app } = boot(telegram);
    const { channelId } = await seed(app);
    const stats = await api(app, `/api/channels/${channelId}/stats`);
    const payload = (await stats.json()) as {
      data: { memberCount: number; views: null; viewsReason: string };
    };
    expect(payload.data.memberCount).toBe(128);
    expect(payload.data.views).toBeNull();
    expect(payload.data.viewsReason).toContain("unsupported_by_bot_api");
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
  });

  it("publishes an approved album through D1 without calling the network client twice", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(here, "../../../packages/db/schema.sql"), "utf8");
    const database = new DatabaseSync(":memory:");
    database.exec(sql);
    const telegram = new DryRunTelegram();
    const app = createApp({
      repo: new D1Repo(createNodeSqliteD1(database)),
      telegram,
      env: {
        API_KEY: "test-api-key",
        TELEGRAM_WEBHOOK_SECRET: "hook-secret",
        TELEGRAM_BOT_TOKEN_MAIN: TOKEN,
      },
      now: () => new Date("2026-11-03T00:00:00.000Z"),
    });
    const { channelId } = await seed(app);
    const created = await api(app, "/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        channelId,
        kind: "album",
        text: "set",
        media: [
          { type: "photo", url: "https://example.com/1.jpg" },
          { type: "video", url: "https://example.com/2.mp4" },
        ],
      }),
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await api(app, `/api/drafts/${id}/approve`, { method: "POST" });
    await api(app, `/api/drafts/${id}/approve`, { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    await api(app, "/api/publisher/run", { method: "POST" });
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0]?.method).toBe("sendMediaGroup");
    expect(telegram.calls[0]?.body.media).toEqual([
      { type: "photo", media: "https://example.com/1.jpg", caption: "set" },
      { type: "video", media: "https://example.com/2.mp4" },
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
