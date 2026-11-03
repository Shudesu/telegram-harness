import type { ButtonSpec, Channel, Draft, PublishedMessage } from "@telegram-harness/shared";
import type { Deps } from "../deps.js";
import { nowIso } from "../deps.js";
import { redactError, resolveToken } from "./tokens.js";

export interface PublishReport {
  posted: string[];
  failed: { id: string; error: string }[];
  blocked?: "network_disabled";
}

export async function publishDue(deps: Deps): Promise<PublishReport> {
  if (deps.telegram.mode === "disabled") {
    return { posted: [], failed: [], blocked: "network_disabled" };
  }
  const claimed = await deps.repo.claimDueDrafts(nowIso(deps));
  const posted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const draft of claimed) {
    const secrets: string[] = [];
    try {
      const delivered = await deliver(deps, draft, secrets);
      draft.status = "posted";
      draft.error = null;
      draft.updatedAt = nowIso(deps);
      await deps.repo.saveDraft(draft);
      await deps.repo.addPublishLog({
        id: crypto.randomUUID(),
        draftId: draft.id,
        method: delivered.method,
        ok: true,
        error: null,
        createdAt: nowIso(deps),
      });
      posted.push(draft.id);
    } catch (error) {
      const message = redactError(error, secrets);
      draft.status = "failed";
      draft.error = message;
      draft.updatedAt = nowIso(deps);
      await deps.repo.saveDraft(draft);
      await deps.repo.addPublishLog({
        id: crypto.randomUUID(),
        draftId: draft.id,
        method: "unknown",
        ok: false,
        error: message,
        createdAt: nowIso(deps),
      });
      failed.push({ id: draft.id, error: message });
    }
  }
  return { posted, failed };
}

async function deliver(deps: Deps, draft: Draft, secrets: string[]): Promise<{ method: string }> {
  const channel = await deps.repo.getChannel(draft.channelId);
  if (!channel) throw new Error("channel_not_found");
  const bot = await deps.repo.getBot(channel.botId);
  if (!bot) throw new Error("bot_not_found");
  const token = resolveToken(deps.env, bot.tokenEnvName);
  secrets.push(token);
  if (draft.action === "delete") return deletePublished(deps, token, channel, draft);
  if (draft.action === "edit") return editPublished(deps, token, channel, draft);
  return sendDraft(deps, token, channel, draft);
}

async function sendDraft(deps: Deps, token: string, channel: Channel, draft: Draft): Promise<{ method: string }> {
  const body: Record<string, unknown> = { chat_id: channel.chatId };
  const reply = replyParameters(draft.replyToTelegramMessageId);
  if (reply) body.reply_parameters = reply;
  const keyboard = inlineKeyboard(draft.payload.buttons);
  let method = "sendMessage";
  if (draft.kind === "text") {
    body.text = draft.payload.text;
    if (draft.payload.parseMode) body.parse_mode = draft.payload.parseMode;
    if (keyboard) body.reply_markup = keyboard;
  } else if (draft.kind === "photo" || draft.kind === "video") {
    method = draft.kind === "photo" ? "sendPhoto" : "sendVideo";
    body[draft.kind] = draft.payload.media?.[0]?.url;
    if (draft.payload.text) body.caption = draft.payload.text;
    if (draft.payload.parseMode) body.parse_mode = draft.payload.parseMode;
    if (keyboard) body.reply_markup = keyboard;
  } else {
    method = "sendMediaGroup";
    body.media = (draft.payload.media ?? []).map((item, index) => ({
      type: item.type,
      media: item.url,
      ...(index === 0 && draft.payload.text ? { caption: draft.payload.text } : {}),
      ...(index === 0 && draft.payload.text && draft.payload.parseMode ? { parse_mode: draft.payload.parseMode } : {}),
    }));
  }
  const result = await deps.telegram.call<unknown>(token, method, body);
  const ids = messageIdsFrom(result);
  const stamp = nowIso(deps);
  await deps.repo.insertMessage({
    id: crypto.randomUUID(),
    channelId: channel.id,
    draftId: draft.id,
    telegramMessageIds: ids,
    kind: draft.kind,
    text: draft.payload.text ?? null,
    status: "posted",
    dryRun: deps.telegram.mode === "dry-run",
    createdAt: stamp,
    updatedAt: stamp,
  });
  return { method };
}

async function editPublished(
  deps: Deps,
  token: string,
  channel: Channel,
  draft: Draft,
): Promise<{ method: string }> {
  const message = await requireTarget(deps, draft);
  const messageId = asTelegramInteger(message.telegramMessageIds[0] ?? "");
  const body: Record<string, unknown> = { chat_id: channel.chatId, message_id: messageId };
  const keyboard = inlineKeyboard(draft.payload.buttons);
  if (keyboard) body.reply_markup = keyboard;
  let method = "editMessageReplyMarkup";
  if (draft.payload.text) {
    if (message.kind === "text") {
      method = "editMessageText";
      body.text = draft.payload.text;
    } else {
      method = "editMessageCaption";
      body.caption = draft.payload.text;
    }
    if (draft.payload.parseMode) body.parse_mode = draft.payload.parseMode;
  }
  await deps.telegram.call(token, method, body);
  message.status = "edited";
  if (draft.payload.text) message.text = draft.payload.text;
  message.updatedAt = nowIso(deps);
  await deps.repo.saveMessage(message);
  return { method };
}

async function deletePublished(
  deps: Deps,
  token: string,
  channel: Channel,
  draft: Draft,
): Promise<{ method: string }> {
  const message = await requireTarget(deps, draft);
  const messageIds = message.telegramMessageIds.map((id) => asTelegramInteger(id));
  await deps.telegram.call(token, "deleteMessages", {
    chat_id: channel.chatId,
    message_ids: messageIds,
  });
  message.status = "deleted";
  message.updatedAt = nowIso(deps);
  await deps.repo.saveMessage(message);
  return { method: "deleteMessages" };
}

async function requireTarget(deps: Deps, draft: Draft): Promise<PublishedMessage> {
  if (!draft.targetMessageId) throw new Error("target_missing");
  const message = await deps.repo.getMessage(draft.targetMessageId);
  if (!message || message.status === "deleted") throw new Error("target_missing");
  if (message.channelId !== draft.channelId) throw new Error("target_channel_mismatch");
  return message;
}

function inlineKeyboard(buttons: ButtonSpec[] | undefined): Record<string, unknown> | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((button) => [
      button.url
        ? { text: button.text, url: button.url }
        : { text: button.text, callback_data: button.callbackData },
    ]),
  };
}

function replyParameters(messageId: string | null): { message_id: number } | undefined {
  if (!messageId) return undefined;
  return { message_id: asTelegramInteger(messageId) };
}

function asTelegramInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error("message_id_not_safe_integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("message_id_not_safe_integer");
  return parsed;
}

function messageIdsFrom(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (!item || typeof item !== "object" || !("message_id" in item)) throw new Error("unexpected_telegram_result");
      return String((item as { message_id: unknown }).message_id);
    });
  }
  if (result && typeof result === "object" && "message_id" in result) {
    return [String((result as { message_id: unknown }).message_id)];
  }
  throw new Error("unexpected_telegram_result");
}
