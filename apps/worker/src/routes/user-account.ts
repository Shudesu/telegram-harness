import type { OwnedChat } from "@telegram-harness/shared";
import { USER_INPUT_LIMITS, validateAccountRequest, validateLoginCode, validateLoginPassword, validatePhone } from "@telegram-harness/shared";
import { assertPublicPayload, redactUserText, SESSION_ENV_NAME } from "@telegram-harness/user-account";
import type { Hono } from "hono";
import type { Deps } from "../deps.js";
import { nowIso } from "../deps.js";
import {
  LOGIN_PHONE_ENV_NAME,
  LOGIN_SESSION_ENV_NAME,
  clearLoginSecrets,
  collectSecretValues,
  openSession,
  persistSession,
  readLoginSecret,
  saveLoginSecret,
} from "../services/user-session.js";
import { RateLimitError, consumeUserRate } from "../services/user-rate.js";

const MAX_BODY_BYTES = 1_000_000;
const LOGIN_TTL_MS = 10 * 60 * 1000;

export function mountUserAccount(app: Hono, deps: Deps): void {
  app.get("/api/user/status", async (c) => {
    const login = await deps.repo.getUserLogin();
    let authorized = false;
    let reason: string | null = null;
    try {
      await openSession(deps);
      authorized = true;
    } catch (error) {
      authorized = false;
      reason = error instanceof Error && error.message === "session_decrypt_failed" ? "session_decrypt_failed" : null;
    }
    const state = await deps.repo.getUserState();
    return send(c, {
      authorized,
      reason,
      sessionEnvName: SESSION_ENV_NAME,
      selfUserId: state?.selfUserId ?? null,
      mode: deps.userAccount.mode,
      login: login
        ? { status: login.status, expiresAt: login.expiresAt, hint: login.hint }
        : null,
    });
  });

  app.post("/api/user/login/start", async (c) => {
    if (deps.userAccount.mode === "disabled") return fail(c, 409, "user_network_disabled");
    const body = await readJson<{ phone?: string; replace?: boolean }>(c);
    if (body instanceof Response) return body;
    const phoneError = validatePhone(body.phone ?? "");
    if (phoneError) return fail(c, 400, phoneError);
    const phone = body.phone ?? "";
    const secrets = collectSecretValues(deps, [phone]);
    try {
      await openSession(deps);
      if (body.replace !== true) return fail(c, 409, "already_authorized");
    } catch (error) {
      if (error instanceof Error && error.message === "session_decrypt_failed") return fail(c, 409, "session_decrypt_failed");
    }
    try {
      await consumeUserRate(deps, "login");
      const sent = await deps.userAccount.sendLoginCode("", phone);
      const session = consumeSession(deps, sent.session, secrets);
      await saveLoginSecret(deps, LOGIN_SESSION_ENV_NAME, session);
      await saveLoginSecret(deps, LOGIN_PHONE_ENV_NAME, phone);
      const stamp = nowIso(deps);
      await deps.repo.saveUserLogin({
        id: "current",
        status: "code_sent",
        phoneCodeHash: sent.phoneCodeHash,
        hint: null,
        expiresAt: new Date(deps.now().getTime() + LOGIN_TTL_MS).toISOString(),
        updatedAt: stamp,
      });
      return send(c, { status: "code_sent", isCodeViaApp: sent.isCodeViaApp });
    } catch (error) {
      return fail(c, statusFor(error), safeCode(error, secrets));
    }
  });

  app.post("/api/user/login/code", async (c) => {
    if (deps.userAccount.mode === "disabled") return fail(c, 409, "user_network_disabled");
    const body = await readJson<{ code?: string }>(c);
    if (body instanceof Response) return body;
    const codeError = validateLoginCode(body.code ?? "");
    if (codeError) return fail(c, 400, codeError);
    const login = await deps.repo.getUserLogin();
    if (!login || login.status !== "code_sent") return fail(c, 409, "login_not_started");
    if (login.expiresAt <= nowIso(deps)) return fail(c, 409, "login_expired");
    const secrets = collectSecretValues(deps, [body.code ?? ""]);
    try {
      const phone = await readLoginSecret(deps, LOGIN_PHONE_ENV_NAME);
      const session = await readLoginSecret(deps, LOGIN_SESSION_ENV_NAME);
      secrets.push(phone, session);
      const result = await deps.userAccount.signInWithCode({
        session,
        phone,
        phoneCodeHash: login.phoneCodeHash,
        code: body.code ?? "",
      });
      const nextSession = consumeSession(deps, result.session, secrets);
      if (result.status === "password_required") {
        await saveLoginSecret(deps, LOGIN_SESSION_ENV_NAME, nextSession);
        login.status = "password_required";
        login.hint = result.hint;
        login.updatedAt = nowIso(deps);
        await deps.repo.saveUserLogin(login);
        return send(c, { status: "password_required", hint: result.hint });
      }
      await finishLogin(deps, nextSession, result.userId);
      return send(c, { status: "authorized", sessionEnvName: SESSION_ENV_NAME, selfUserId: result.userId });
    } catch (error) {
      return fail(c, statusFor(error), safeCode(error, secrets));
    }
  });

  app.post("/api/user/login/password", async (c) => {
    if (deps.userAccount.mode === "disabled") return fail(c, 409, "user_network_disabled");
    const body = await readJson<{ password?: string }>(c);
    if (body instanceof Response) return body;
    const passwordError = validateLoginPassword(body.password ?? "");
    if (passwordError) return fail(c, 400, passwordError);
    const login = await deps.repo.getUserLogin();
    if (!login || login.status !== "password_required") return fail(c, 409, "password_not_required");
    if (login.expiresAt <= nowIso(deps)) return fail(c, 409, "login_expired");
    const secrets = collectSecretValues(deps, [body.password ?? ""]);
    try {
      const session = await readLoginSecret(deps, LOGIN_SESSION_ENV_NAME);
      secrets.push(session);
      const result = await deps.userAccount.signInWithPassword({ session, password: body.password ?? "" });
      const nextSession = consumeSession(deps, result.session, secrets);
      await finishLogin(deps, nextSession, result.userId);
      return send(c, { status: "authorized", sessionEnvName: SESSION_ENV_NAME, selfUserId: result.userId });
    } catch (error) {
      return fail(c, statusFor(error), safeCode(error, secrets));
    }
  });

  app.post("/api/user/session/forget", async (c) => {
    await deps.secrets.delete(SESSION_ENV_NAME);
    await clearLoginSecrets(deps);
    await deps.repo.clearUserLogin();
    await deps.repo.clearUserState();
    return send(c, { forgotten: true, remoteLogout: false });
  });

  app.get("/api/user/chats", async (c) => {
    if (deps.userAccount.mode === "disabled") return fail(c, 409, "user_network_disabled");
    const secrets = collectSecretValues(deps);
    try {
      const session = await openSession(deps);
      secrets.push(session);
      await consumeUserRate(deps, "read");
      const listed = await deps.userAccount.listOwnChats(session);
      await rememberSession(deps, secrets);
      const data = [];
      for (const chat of listed) {
        if (chat.role === "member") continue;
        const stored = await deps.repo.upsertOwnedChat({
          id: crypto.randomUUID(),
          telegramId: chat.telegramId,
          accessHash: chat.accessHash,
          title: chat.title,
          username: chat.username,
          kind: chat.kind,
          role: chat.role,
          syncedAt: nowIso(deps),
        });
        data.push(publicChat(stored));
      }
      return send(c, data);
    } catch (error) {
      return fail(c, statusFor(error), safeCode(error, secrets));
    }
  });

  app.get("/api/user/chats/:id/stats", async (c) => {
    if (deps.userAccount.mode === "disabled") return fail(c, 409, "user_network_disabled");
    const chat = await deps.repo.getOwnedChat(c.req.param("id"));
    if (!chat) return fail(c, 404, "owned_chat_not_found");
    if (chat.kind === "group") return fail(c, 409, "basic_group_unsupported");
    const messageIds = parseMessageIds(c.req.query("messageIds"));
    if (messageIds instanceof Response) return messageIds;
    const secrets = collectSecretValues(deps);
    try {
      const session = await openSession(deps);
      secrets.push(session);
      await consumeUserRate(deps, "read");
      const stats = await deps.userAccount.getChannelStats(
        session,
        { telegramId: chat.telegramId, accessHash: chat.accessHash },
        messageIds,
      );
      await rememberSession(deps, secrets);
      return send(c, {
        ownedChatId: chat.id,
        dryRun: deps.userAccount.mode === "dry-run",
        participantsCount: stats.participantsCount,
        about: stats.about,
        messages: stats.messages,
        broadcastStats: stats.broadcastStats,
        broadcastStatsReason: stats.broadcastStatsReason,
      });
    } catch (error) {
      return fail(c, statusFor(error), safeCode(error, secrets));
    }
  });

  app.post("/api/account/actions", async (c) => {
    const body = await readJson<Record<string, unknown>>(c);
    if (body instanceof Response) return body;
    const scheduledAt = typeof body.scheduledAt === "string" ? body.scheduledAt : null;
    const request = validateAccountRequest(body, scheduledAt);
    if ("error" in request) return fail(c, 400, request.error);
    const ownedError = await ownedReady(deps, request.action, request.payload);
    if (ownedError) return fail(c, ownedError.status, ownedError.error);
    const stamp = nowIso(deps);
    const action = {
      id: crypto.randomUUID(),
      action: request.action,
      status: "pending" as const,
      payload: request.payload,
      summary: request.summary,
      scheduledAt: request.scheduledAt,
      approvedAt: null,
      error: null,
      result: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await deps.repo.insertAccountAction(action);
    return send(c, action, 201);
  });

  app.get("/api/account/actions", async (c) => {
    const status = c.req.query("status");
    const allowed = ["pending", "scheduled", "publishing", "posted", "rejected", "failed"] as const;
    const parsed = allowed.find((item) => item === status);
    if (status && !parsed) return fail(c, 400, "invalid_status");
    const data = await deps.repo.listAccountActions({ status: parsed, limit: limitOf(c.req.query("limit")) });
    return send(c, data);
  });

  app.get("/api/account/actions/:id", async (c) => {
    const action = await deps.repo.getAccountAction(c.req.param("id"));
    if (!action) return fail(c, 404, "Not found");
    return send(c, action);
  });

  app.post("/api/account/actions/:id/approve", async (c) => {
    const action = await deps.repo.getAccountAction(c.req.param("id"));
    if (!action) return fail(c, 404, "Not found");
    if (action.status !== "pending") return fail(c, 409, "Draft is not pending");
    const stamp = nowIso(deps);
    if (!action.scheduledAt) action.scheduledAt = stamp;
    action.status = "scheduled";
    action.approvedAt = stamp;
    action.updatedAt = stamp;
    if (!await deps.repo.transitionAccountAction(action, "pending")) return fail(c, 409, "Action state changed");
    return send(c, action);
  });

  app.post("/api/account/actions/:id/reject", async (c) => {
    const action = await deps.repo.getAccountAction(c.req.param("id"));
    if (!action) return fail(c, 404, "Not found");
    if (action.status !== "pending") return fail(c, 409, "Draft is not pending");
    action.status = "rejected";
    action.updatedAt = nowIso(deps);
    if (!await deps.repo.transitionAccountAction(action, "pending")) return fail(c, 409, "Action state changed");
    return send(c, action);
  });

  app.post("/api/account/actions/:id/cancel", async (c) => {
    const action = await deps.repo.getAccountAction(c.req.param("id"));
    if (!action) return fail(c, 404, "Not found");
    if (action.status !== "scheduled") return fail(c, 409, "Draft is not scheduled");
    action.status = "pending";
    action.approvedAt = null;
    action.updatedAt = nowIso(deps);
    if (!await deps.repo.transitionAccountAction(action, "scheduled")) return fail(c, 409, "Action state changed");
    return send(c, action);
  });

  app.post("/api/account/actions/:id/requeue", async (c) => {
    const action = await deps.repo.getAccountAction(c.req.param("id"));
    if (!action) return fail(c, 404, "Not found");
    if (action.status !== "failed") return fail(c, 409, "Draft is not failed");
    action.status = "pending";
    action.approvedAt = null;
    action.error = null;
    action.updatedAt = nowIso(deps);
    if (!await deps.repo.transitionAccountAction(action, "failed")) return fail(c, 409, "Action state changed");
    return send(c, action);
  });

  app.get("/api/debug/user-calls", (c) => {
    if (deps.userAccount.mode !== "dry-run") return fail(c, 404, "Not found");
    return send(c, deps.userAccount.calls);
  });
}

function consumeSession(deps: Deps, fallback: string, secrets: string[]): string {
  const next = deps.userAccount.takeSessionUpdate() ?? fallback;
  secrets.push(next);
  return next;
}

async function finishLogin(deps: Deps, session: string, userId: string): Promise<void> {
  await persistSession(deps, session);
  await clearLoginSecrets(deps);
  await deps.repo.clearUserLogin();
  await deps.repo.saveUserState({
    sessionEnvName: SESSION_ENV_NAME,
    selfUserId: userId,
    updatedAt: nowIso(deps),
  });
}

async function rememberSession(deps: Deps, secrets: string[]): Promise<void> {
  const next = deps.userAccount.takeSessionUpdate();
  if (!next) return;
  secrets.push(next);
  await persistSession(deps, next);
}

async function ownedReady(
  deps: Deps,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ status: 404 | 409; error: string } | null> {
  if (!action.startsWith("edit_") && action !== "add_admin" && action !== "remove_admin") return null;
  const id = payload.ownedChatId;
  if (typeof id !== "string") return { status: 404, error: "owned_chat_not_found" };
  const chat = await deps.repo.getOwnedChat(id);
  if (!chat) return { status: 404, error: "owned_chat_not_found" };
  if (chat.kind === "group") return { status: 409, error: "basic_group_unsupported" };
  return null;
}

function publicChat(chat: OwnedChat): Record<string, unknown> {
  return {
    id: chat.id,
    telegramId: chat.telegramId,
    title: chat.title,
    username: chat.username,
    kind: chat.kind,
    role: chat.role,
    syncedAt: chat.syncedAt,
  };
}

function parseMessageIds(value: string | undefined): string[] | Response {
  if (!value) return [];
  const ids = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  if (ids.length > USER_INPUT_LIMITS.messageIdsMax) return jsonResponse(400, "too_many_message_ids");
  if (ids.some((id) => !/^[1-9]\d{0,14}$/.test(id))) return jsonResponse(400, "invalid_message_id");
  return ids;
}

function statusFor(error: unknown): 400 | 401 | 409 | 429 | 502 {
  const code = error instanceof Error ? error.message : "";
  if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EXPIRED" || code === "PASSWORD_HASH_INVALID") return 401;
  if (code === "rate_limited" || code.startsWith("flood_wait:")) return 429;
  if (
    code === "user_network_disabled" ||
    code === "user_not_logged_in" ||
    code === "missing_api_credentials" ||
    code === "already_authorized" ||
    code === "login_expired" ||
    code === "login_not_started" ||
    code === "session_decrypt_failed"
  ) {
    return 409;
  }
  if (code.startsWith("invalid_") || code.startsWith("missing_session") || code === "PHONE_NUMBER_INVALID") return 400;
  return 502;
}

function safeCode(error: unknown, secrets: string[]): string {
  const raw = error instanceof RateLimitError ? error.code : error instanceof Error ? error.message : "mtproto_failed";
  const redacted = redactUserText(raw, secrets);
  if (
    redacted.startsWith("flood_wait:") ||
    redacted.startsWith("botfather_") ||
    /^[a-z0-9_]+$/.test(redacted) ||
    /^[A-Z0-9_]+$/.test(redacted)
  ) {
    return redacted.slice(0, 160);
  }
  return "mtproto_failed";
}

function send(c: { json: (body: unknown, status?: number) => Response }, data: unknown, status = 200): Response {
  try {
    assertPublicPayload(data);
  } catch {
    return jsonResponse(500, "response_contained_secret_field");
  }
  return c.json({ success: true, data }, status);
}

function fail(c: { json: (body: unknown, status?: number) => Response }, status: number, error: string): Response {
  return c.json({ success: false, error }, status as 400);
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

function limitOf(value: string | undefined): number {
  const parsed = Number(value ?? "50");
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

function jsonResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
