import type { AccountAction, OwnedChat } from "@telegram-harness/shared";
import { USER_INPUT_LIMITS } from "@telegram-harness/shared";
import {
  buildBotFatherScript,
  downloadPhoto,
  extractBotToken,
  redactUserText,
  USER_RATE_LIMITS,
} from "@telegram-harness/user-account";
import type { Deps } from "../deps.js";
import { nowIso } from "../deps.js";
import { resolveToken } from "./tokens.js";
import { RateLimitError, consumeUserRate } from "./user-rate.js";
import { collectSecretValues, openSession, persistSession } from "./user-session.js";

export interface AccountReport {
  posted: string[];
  failed: { id: string; error: string }[];
  rescheduled: string[];
  blocked?: "user_network_disabled" | "user_not_logged_in";
}

export async function executeDueAccountActions(deps: Deps): Promise<AccountReport> {
  if (deps.userAccount.mode === "disabled") {
    return { posted: [], failed: [], rescheduled: [], blocked: "user_network_disabled" };
  }
  try {
    await openSession(deps);
  } catch {
    return { posted: [], failed: [], rescheduled: [], blocked: "user_not_logged_in" };
  }
  const claimed = await deps.repo.claimDueAccountActions(nowIso(deps));
  const posted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const rescheduled: string[] = [];
  for (const action of claimed) {
    const outcome = await runOne(deps, action);
    if (outcome === "posted") posted.push(action.id);
    else if (outcome === "rescheduled") {
      rescheduled.push(action.id);
      break;
    } else {
      failed.push({ id: action.id, error: action.error ?? "mtproto_failed" });
      if (action.error === "rate_limited" || action.error?.startsWith("flood_wait:")) break;
    }
  }
  return { posted, failed, rescheduled };
}

async function runOne(deps: Deps, action: AccountAction): Promise<"posted" | "failed" | "rescheduled"> {
  const secrets = collectSecretValues(deps);
  try {
    await consumeUserRate(deps, "write");
  } catch (error) {
    if (error instanceof RateLimitError && error.code === "rate_limited_interval") {
      action.status = "scheduled";
      action.scheduledAt = new Date(deps.now().getTime() + USER_RATE_LIMITS.minWriteIntervalMs).toISOString();
      action.error = null;
      action.updatedAt = nowIso(deps);
      await deps.repo.saveAccountAction(action);
      return "rescheduled";
    }
    action.status = "failed";
    action.error = "rate_limited";
    action.updatedAt = nowIso(deps);
    await deps.repo.saveAccountAction(action);
    return "failed";
  }
  try {
    const session = await openSession(deps);
    secrets.push(session);
    const result = await perform(deps, action, session, secrets);
    const next = deps.userAccount.takeSessionUpdate();
    if (next) {
      secrets.push(next);
      await persistSession(deps, next);
    }
    action.status = "posted";
    action.error = null;
    action.result = result;
    action.updatedAt = nowIso(deps);
    await deps.repo.saveAccountAction(action);
    return "posted";
  } catch (error) {
    const next = deps.userAccount.takeSessionUpdate();
    if (next) {
      secrets.push(next);
      try {
        await persistSession(deps, next);
      } catch {
        // The original failure is the one stored.
      }
    }
    action.status = "failed";
    action.error = safeError(error, secrets);
    action.updatedAt = nowIso(deps);
    await deps.repo.saveAccountAction(action);
    return "failed";
  }
}

async function perform(
  deps: Deps,
  action: AccountAction,
  session: string,
  secrets: string[],
): Promise<Record<string, unknown>> {
  const payload = action.payload;
  if (action.action === "create_channel" || action.action === "create_supergroup") {
    const chat = await deps.userAccount.createChannel(session, {
      title: String(payload.title ?? ""),
      about: String(payload.about ?? ""),
      megagroup: action.action === "create_supergroup",
    });
    const stored = await deps.repo.upsertOwnedChat({
      id: crypto.randomUUID(),
      telegramId: chat.telegramId,
      accessHash: chat.accessHash,
      title: chat.title,
      username: chat.username,
      kind: chat.kind === "group" ? "supergroup" : chat.kind,
      role: "creator",
      syncedAt: nowIso(deps),
    });
    return { ownedChatId: stored.id, telegramId: stored.telegramId, title: stored.title, kind: stored.kind };
  }
  if (action.action.startsWith("botfather_")) {
    return runBotFather(deps, action, session, secrets);
  }
  const chat = await requireOwned(deps, payload.ownedChatId);
  const ref = { telegramId: chat.telegramId, accessHash: chat.accessHash };
  if (action.action === "edit_title") {
    const title = String(payload.title ?? "");
    await deps.userAccount.editTitle(session, ref, title);
    chat.title = title;
    chat.syncedAt = nowIso(deps);
    await deps.repo.upsertOwnedChat(chat);
    return { ownedChatId: chat.id, title };
  }
  if (action.action === "edit_description") {
    await deps.userAccount.editAbout(session, ref, String(payload.description ?? ""));
    return { ownedChatId: chat.id };
  }
  if (action.action === "edit_photo") {
    const bytes = await photoBytes(deps, String(payload.photoUrl ?? ""));
    await deps.userAccount.editPhoto(session, ref, bytes);
    return { ownedChatId: chat.id };
  }
  if (action.action === "edit_username") {
    const username = String(payload.username ?? "");
    await deps.userAccount.editUsername(session, ref, username);
    chat.username = username;
    chat.syncedAt = nowIso(deps);
    await deps.repo.upsertOwnedChat(chat);
    return { ownedChatId: chat.id, username };
  }
  if (action.action === "add_admin" || action.action === "remove_admin") {
    const username = await resolveAdminUsername(deps, action, secrets);
    await deps.userAccount.setAdmin(session, ref, username, action.action === "add_admin");
    return { ownedChatId: chat.id, username };
  }
  throw new Error("invalid_action");
}

async function runBotFather(
  deps: Deps,
  action: AccountAction,
  session: string,
  secrets: string[],
): Promise<Record<string, unknown>> {
  const script = buildBotFatherScript(action.action, action.payload);
  if (action.action === "botfather_set_photo") {
    script.steps[script.steps.length - 1] = { file: await photoBytes(deps, String(action.payload.photoUrl ?? "")) };
  }
  const replies = await deps.userAccount.runBotFather(session, script.steps);
  if (!script.expectToken) {
    return { username: action.payload.username ?? null };
  }
  const token = extractBotToken(replies);
  if (!token) throw new Error("botfather_token_missing");
  secrets.push(token);
  const tokenEnvName = String(action.payload.tokenEnvName ?? "");
  try {
    await deps.secrets.put(tokenEnvName, token);
  } catch {
    throw new Error("secret_store_failed");
  }
  return { tokenEnvName, username: action.payload.username ?? null };
}

async function photoBytes(deps: Deps, url: string): Promise<Uint8Array> {
  if (deps.userAccount.mode !== "live") return new Uint8Array([1]);
  return downloadPhoto(url);
}

async function requireOwned(deps: Deps, id: unknown): Promise<OwnedChat> {
  if (typeof id !== "string") throw new Error("invalid_owned_chat");
  const chat = await deps.repo.getOwnedChat(id);
  if (!chat) throw new Error("owned_chat_not_found");
  if (chat.kind === "group") throw new Error("basic_group_unsupported");
  if (chat.role !== "creator" && chat.role !== "admin") throw new Error("not_owner_admin");
  return chat;
}

async function resolveAdminUsername(deps: Deps, action: AccountAction, secrets: string[]): Promise<string> {
  if (typeof action.payload.botId === "string") {
    const bot = await deps.repo.getBot(action.payload.botId);
    if (!bot) throw new Error("bot_not_found");
    if (deps.telegram.mode === "disabled") throw new Error("bot_lookup_unavailable");
    const token = await resolveToken(deps.env, bot.tokenEnvName, deps.secrets);
    secrets.push(token);
    const me = await deps.telegram.call<{ username?: string; is_bot?: boolean }>(token, "getMe", {});
    if (!me.is_bot || typeof me.username !== "string" || !me.username.toLowerCase().endsWith("bot")) {
      throw new Error("bot_username_unavailable");
    }
    if (me.username.length > USER_INPUT_LIMITS.titleMax) throw new Error("bot_username_unavailable");
    return me.username;
  }
  if (typeof action.payload.username !== "string") throw new Error("invalid_username");
  return action.payload.username;
}

function safeError(error: unknown, secrets: string[]): string {
  const raw = error instanceof Error ? error.message : "mtproto_failed";
  const redacted = redactUserText(raw, secrets);
  if (
    redacted.startsWith("flood_wait:") ||
    redacted.startsWith("botfather_") ||
    redacted === "rate_limited" ||
    /^[a-z0-9_]+$/.test(redacted)
  ) {
    return redacted.slice(0, 160);
  }
  return "mtproto_failed";
}
