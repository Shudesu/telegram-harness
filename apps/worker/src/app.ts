import { VERSION, safeEqual, validateChatId, validateEditPayload, validatePublishPayload, validateScheduledAt, validateSource, validateTokenEnvName, VIEWS_REASON } from "@telegram-harness/shared";
import type { ChannelKind, Draft, DraftKind, DraftPayload, ParseMode } from "@telegram-harness/shared";
import { Hono } from "hono";
import type { Deps } from "./deps.js";
import { nowIso } from "./deps.js";
import { publishDue } from "./services/publisher.js";
import { resolveToken } from "./services/tokens.js";
import { chatIdOf, classifyUpdate, messageText } from "./services/updates.js";

const MAX_BODY_BYTES = 1_000_000;

export function createApp(input: Omit<Deps, "now"> & { now?: () => Date }) {
  const deps: Deps = { ...input, now: input.now ?? (() => new Date()) };
  const app = new Hono();

  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/api/health" || path.startsWith("/api/telegram/webhook/")) return next();
    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    const keys = authorizedKeys(deps, path);
    if (!presented || !keys.some((key) => safeEqual(presented, key))) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/api/health", (c) =>
    c.json({
      success: true,
      data: {
        name: "telegram-harness",
        version: VERSION,
        telegramMode: deps.telegram.mode,
      },
    }),
  );

  app.post("/api/bots", async (c) => {
    const body = await readJson<{ name?: string; tokenEnvName?: string }>(c);
    if (body instanceof Response) return body;
    const name = body.name?.trim() ?? "";
    const tokenEnvName = body.tokenEnvName ?? "";
    if (name.length < 1 || name.length > 80) return fail(c, 400, "invalid_name");
    const nameError = validateTokenEnvName(tokenEnvName);
    if (nameError) return fail(c, 400, nameError);
    if (!deps.env[tokenEnvName]) return fail(c, 400, "missing_token_env");
    const stamp = nowIso(deps);
    const bot = { id: crypto.randomUUID(), name, tokenEnvName, createdAt: stamp, updatedAt: stamp };
    await deps.repo.insertBot(bot);
    return c.json({ success: true, data: bot }, 201);
  });

  app.get("/api/bots", async (c) => c.json({ success: true, data: await deps.repo.listBots() }));

  app.post("/api/channels", async (c) => {
    const body = await readJson<{ botId?: string; chatId?: string; title?: string; kind?: ChannelKind }>(c);
    if (body instanceof Response) return body;
    const bot = body.botId ? await deps.repo.getBot(body.botId) : null;
    if (!bot) return fail(c, 404, "bot_not_found");
    const chatError = validateChatId(body.chatId ?? "");
    if (chatError) return fail(c, 400, chatError);
    const title = body.title?.trim() ?? "";
    if (title.length < 1 || title.length > 128) return fail(c, 400, "invalid_title");
    if (body.kind !== "channel" && body.kind !== "group" && body.kind !== "supergroup") return fail(c, 400, "invalid_kind");
    const stamp = nowIso(deps);
    const channel = {
      id: crypto.randomUUID(),
      botId: bot.id,
      chatId: body.chatId ?? "",
      title,
      kind: body.kind,
      createdAt: stamp,
      updatedAt: stamp,
    };
    try {
      await deps.repo.insertChannel(channel);
    } catch (error) {
      if (error instanceof Error && error.message === "duplicate_channel") return fail(c, 409, "duplicate_channel");
      throw error;
    }
    return c.json({ success: true, data: channel }, 201);
  });

  app.get("/api/channels", async (c) => {
    const botId = c.req.query("botId");
    return c.json({ success: true, data: await deps.repo.listChannels(botId) });
  });

  app.post("/api/drafts", async (c) => {
    const body = await readJson<DraftBody>(c);
    if (body instanceof Response) return body;
    const created = await createContentDraft(deps, body, { action: "publish", source: "manual", sourceRef: null });
    if (created instanceof Response) return created;
    return c.json({ success: true, data: created }, 201);
  });

  app.get("/api/drafts", async (c) => {
    const status = c.req.query("status");
    const allowed = ["pending", "scheduled", "publishing", "posted", "rejected", "failed"] as const;
    const parsed = allowed.find((item) => item === status);
    if (status && !parsed) return fail(c, 400, "invalid_status");
    const data = await deps.repo.listDrafts({ status: parsed, channelId: c.req.query("channelId"), limit: limitOf(c.req.query("limit")) });
    return c.json({ success: true, data });
  });

  app.get("/api/approvals", async (c) => {
    const data = await deps.repo.listDrafts({ status: "pending", limit: limitOf(c.req.query("limit")) });
    return c.json({ success: true, data });
  });

  app.get("/api/drafts/:id", async (c) => {
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    return c.json({ success: true, data: draft });
  });

  app.post("/api/drafts/:id/schedule", async (c) => {
    const body = await readJson<{ scheduledAt?: string }>(c);
    if (body instanceof Response) return body;
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    if (draft.status !== "pending") return fail(c, 409, "Draft is not pending");
    const scheduledAt = body.scheduledAt ?? "";
    const error = validateScheduledAt(scheduledAt);
    if (error) return fail(c, 400, error);
    draft.scheduledAt = scheduledAt;
    draft.updatedAt = nowIso(deps);
    await deps.repo.saveDraft(draft);
    return c.json({ success: true, data: draft });
  });

  app.post("/api/drafts/:id/approve", async (c) => {
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    if (draft.status !== "pending") return fail(c, 409, "Draft is not pending");
    const stamp = nowIso(deps);
    if (!draft.scheduledAt) draft.scheduledAt = stamp;
    draft.status = "scheduled";
    draft.approvedAt = stamp;
    draft.updatedAt = stamp;
    await deps.repo.saveDraft(draft);
    return c.json({ success: true, data: draft });
  });

  app.post("/api/drafts/:id/reject", async (c) => {
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    if (draft.status !== "pending") return fail(c, 409, "Draft is not pending");
    draft.status = "rejected";
    draft.updatedAt = nowIso(deps);
    await deps.repo.saveDraft(draft);
    return c.json({ success: true, data: draft });
  });

  app.post("/api/drafts/:id/cancel", async (c) => {
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    if (draft.status !== "scheduled") return fail(c, 409, "Draft is not scheduled");
    draft.status = "pending";
    draft.approvedAt = null;
    draft.updatedAt = nowIso(deps);
    await deps.repo.saveDraft(draft);
    return c.json({ success: true, data: draft });
  });

  app.post("/api/drafts/:id/requeue", async (c) => {
    const draft = await deps.repo.getDraft(c.req.param("id"));
    if (!draft) return fail(c, 404, "Not found");
    if (draft.status !== "failed") return fail(c, 409, "Draft is not failed");
    draft.status = "pending";
    draft.approvedAt = null;
    draft.error = null;
    draft.updatedAt = nowIso(deps);
    await deps.repo.saveDraft(draft);
    return c.json({ success: true, data: draft });
  });

  app.post("/api/publisher/run", async (c) => {
    const report = await publishDue(deps);
    if (report.blocked) return fail(c, 409, report.blocked);
    return c.json({ success: true, data: report });
  });

  app.get("/api/messages", async (c) => {
    const data = await deps.repo.listMessages(c.req.query("channelId"));
    return c.json({ success: true, data });
  });

  app.post("/api/messages/:id/edits", async (c) => {
    const body = await readJson<DraftPayload>(c);
    if (body instanceof Response) return body;
    const message = await deps.repo.getMessage(c.req.param("id"));
    if (!message || message.status === "deleted") return fail(c, 404, "Not found");
    const payload = pickPayload(body);
    const error = validateEditPayload(message.kind, payload);
    if (error) return fail(c, 400, error);
    const draft = await insertMutationDraft(deps, message.channelId, message.kind, "edit", payload, message.id);
    return c.json({ success: true, data: draft }, 201);
  });

  app.post("/api/messages/:id/deletes", async (c) => {
    const message = await deps.repo.getMessage(c.req.param("id"));
    if (!message || message.status === "deleted") return fail(c, 404, "Not found");
    const draft = await insertMutationDraft(deps, message.channelId, message.kind, "delete", {}, message.id);
    return c.json({ success: true, data: draft }, 201);
  });

  app.get("/api/channels/:id/stats", async (c) => {
    const channel = await deps.repo.getChannel(c.req.param("id"));
    if (!channel) return fail(c, 404, "Not found");
    const messages = await deps.repo.listMessages(channel.id);
    const messageViews = messages.map((message) => ({
      id: message.id,
      telegramMessageIds: message.telegramMessageIds,
      views: null,
      viewsReason: VIEWS_REASON,
    }));
    if (deps.telegram.mode !== "live") {
      return c.json({
        success: true,
        data: {
          memberCount: null,
          memberCountReason: "not_live",
          views: null,
          viewsReason: VIEWS_REASON,
          messages: messageViews,
        },
      });
    }
    const bot = await deps.repo.getBot(channel.botId);
    if (!bot) return fail(c, 404, "bot_not_found");
    try {
      const token = resolveToken(deps.env, bot.tokenEnvName);
      const memberCount = await deps.telegram.call<number>(token, "getChatMemberCount", { chat_id: channel.chatId });
      const chat = await deps.telegram.call<Record<string, unknown>>(token, "getChat", { chat_id: channel.chatId });
      return c.json({
        success: true,
        data: {
          memberCount,
          chat: {
            id: chat.id ?? null,
            title: chat.title ?? null,
            type: chat.type ?? null,
            username: chat.username ?? null,
          },
          views: null,
          viewsReason: VIEWS_REASON,
          messages: messageViews,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "stats_failed";
      if (message === "network_disabled") return fail(c, 409, message);
      return fail(c, 502, "stats_unavailable");
    }
  });

  app.post("/api/telegram/webhook/:botId", async (c) => {
    const expected = deps.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    const presented = c.req.header("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !safeEqual(presented, expected)) return fail(c, 401, "Unauthorized");
    const bot = await deps.repo.getBot(c.req.param("botId"));
    if (!bot) return fail(c, 404, "Not found");
    const length = Number(c.req.header("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) return fail(c, 413, "body_too_large");
    const update = await readJson<Record<string, unknown>>(c);
    if (update instanceof Response) return update;
    const updateId = update.update_id;
    if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return fail(c, 400, "invalid_update");
    const classified = classifyUpdate(update);
    if (!classified) return c.json({ success: true, data: { ignored: true } });
    const chatId = chatIdOf(classified.message);
    if (!chatId) return fail(c, 400, "invalid_update");
    const stored = await deps.repo.insertIncoming({
      id: crypto.randomUUID(),
      botId: bot.id,
      updateId,
      chatId,
      telegramMessageId:
        typeof classified.message.message_id === "number" ? String(classified.message.message_id) : null,
      fromUserId: classified.message.from?.id === undefined ? null : String(classified.message.from.id),
      text: messageText(classified.message),
      kind: classified.kind,
      raw: update,
      createdAt: nowIso(deps),
    });
    if (stored === "duplicate") return c.json({ success: true, data: { duplicate: true } });
    return c.json({ success: true, data: stored }, 201);
  });

  app.get("/api/incoming", async (c) => {
    const data = await deps.repo.listIncoming(c.req.query("botId"));
    return c.json({ success: true, data });
  });

  app.post("/api/incoming/:id/replies", async (c) => {
    const incoming = await deps.repo.getIncoming(c.req.param("id"));
    if (!incoming) return fail(c, 404, "Not found");
    if (!incoming.telegramMessageId) return fail(c, 409, "incoming_has_no_message");
    const channel = await deps.repo.findChannel(incoming.botId, incoming.chatId);
    if (!channel) return fail(c, 409, "channel_not_registered");
    const body = await readJson<DraftBody>(c);
    if (body instanceof Response) return body;
    const created = await createContentDraft(
      deps,
      { ...body, channelId: channel.id },
      {
        action: "reply",
        source: "webhook",
        sourceRef: null,
        incomingId: incoming.id,
        replyToTelegramMessageId: incoming.telegramMessageId,
      },
    );
    if (created instanceof Response) return created;
    return c.json({ success: true, data: created }, 201);
  });

  app.post("/api/intake/drafts", async (c) => {
    const body = await readJson<DraftBody & { source?: string; sourceRef?: string }>(c);
    if (body instanceof Response) return body;
    const sourceError = validateSource(body.source ?? "", body.sourceRef ?? "");
    if (sourceError) return fail(c, 400, sourceError);
    const existing = await deps.repo.findDraftBySource(body.source ?? "", body.sourceRef ?? "");
    if (existing) return c.json({ success: true, data: existing, idempotent: true });
    const created = await createContentDraft(deps, body, {
      action: "publish",
      source: body.source ?? "",
      sourceRef: body.sourceRef ?? "",
    });
    if (created instanceof Response) return created;
    return c.json({ success: true, data: created }, 201);
  });

  app.get("/api/debug/telegram-calls", (c) => {
    if (deps.telegram.mode !== "dry-run") return fail(c, 404, "Not found");
    return c.json({ success: true, data: deps.telegram.calls });
  });

  return app;
}

interface DraftBody {
  channelId?: string;
  kind?: DraftKind;
  text?: string;
  media?: DraftPayload["media"];
  buttons?: DraftPayload["buttons"];
  parseMode?: ParseMode;
  scheduledAt?: string | null;
}

async function createContentDraft(
  deps: Deps,
  body: DraftBody,
  meta: {
    action: "publish" | "reply";
    source: string;
    sourceRef: string | null;
    incomingId?: string;
    replyToTelegramMessageId?: string;
  },
): Promise<Draft | Response> {
  const channel = body.channelId ? await deps.repo.getChannel(body.channelId) : null;
  if (!channel) return jsonResponse(404, "channel_not_found");
  if (body.kind !== "text" && body.kind !== "photo" && body.kind !== "video" && body.kind !== "album") {
    return jsonResponse(400, "invalid_kind");
  }
  const payload = pickPayload(body);
  const error = validatePublishPayload(body.kind, payload);
  if (error) return jsonResponse(400, error);
  if (body.scheduledAt) {
    const scheduledError = validateScheduledAt(body.scheduledAt);
    if (scheduledError) return jsonResponse(400, scheduledError);
  }
  const stamp = nowIso(deps);
  const draft: Draft = {
    id: crypto.randomUUID(),
    channelId: channel.id,
    action: meta.action,
    kind: body.kind,
    status: "pending",
    payload,
    scheduledAt: body.scheduledAt ?? null,
    source: meta.source,
    sourceRef: meta.sourceRef,
    incomingId: meta.incomingId ?? null,
    replyToTelegramMessageId: meta.replyToTelegramMessageId ?? null,
    targetMessageId: null,
    approvedAt: null,
    error: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await deps.repo.insertDraft(draft);
  return draft;
}

async function insertMutationDraft(
  deps: Deps,
  channelId: string,
  kind: DraftKind,
  action: "edit" | "delete",
  payload: DraftPayload,
  targetMessageId: string,
): Promise<Draft> {
  const stamp = nowIso(deps);
  const draft: Draft = {
    id: crypto.randomUUID(),
    channelId,
    action,
    kind,
    status: "pending",
    payload,
    scheduledAt: null,
    source: "manual",
    sourceRef: null,
    incomingId: null,
    replyToTelegramMessageId: null,
    targetMessageId,
    approvedAt: null,
    error: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await deps.repo.insertDraft(draft);
  return draft;
}

function pickPayload(body: DraftPayload): DraftPayload {
  return {
    ...(body.text !== undefined ? { text: body.text } : {}),
    ...(body.media !== undefined ? { media: body.media } : {}),
    ...(body.buttons !== undefined ? { buttons: body.buttons } : {}),
    ...(body.parseMode !== undefined ? { parseMode: body.parseMode } : {}),
  };
}

function authorizedKeys(deps: Deps, path: string): string[] {
  const primary = deps.env.API_KEY;
  if (!primary) return [];
  if (path === "/api/intake/drafts" && deps.env.INTAKE_API_KEY) return [primary, deps.env.INTAKE_API_KEY];
  return [primary];
}

function limitOf(value: string | undefined): number {
  const parsed = Number(value ?? "50");
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

async function readJson<T>(c: { req: { json: () => Promise<unknown>; header: (name: string) => string | undefined } }): Promise<T | Response> {
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return jsonResponse(413, "body_too_large");
  try {
    return (await c.req.json()) as T;
  } catch {
    return jsonResponse(400, "invalid_json");
  }
}

function fail(c: { json: (body: unknown, status?: number) => Response }, status: number, error: string): Response {
  return c.json({ success: false, error }, status);
}

function jsonResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
