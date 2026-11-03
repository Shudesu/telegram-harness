import type { IncomingKind } from "@telegram-harness/shared";

interface TelegramMessageShape {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number | string; type?: string };
  from?: { id?: number | string };
  is_automatic_forward?: boolean;
  reply_to_message?: unknown;
}

export interface ClassifiedUpdate {
  kind: IncomingKind;
  message: TelegramMessageShape;
}

/**
 * Group replies are stored as comments because channel discussion comments
 * arrive as replies in the linked group, often alongside is_automatic_forward.
 * A reply in an ordinary group is therefore included. That is a harness
 * classification, not a Telegram content type named "comment".
 */
export function classifyUpdate(update: Record<string, unknown>): ClassifiedUpdate | null {
  const channelPost = asMessage(update.channel_post) ?? asMessage(update.edited_channel_post);
  if (channelPost) return { kind: "channel_post", message: channelPost };
  const message = asMessage(update.message) ?? asMessage(update.edited_message);
  if (!message) return null;
  const chatType = message.chat?.type;
  const inGroup = chatType === "group" || chatType === "supergroup";
  if (message.is_automatic_forward || (inGroup && message.reply_to_message)) {
    return { kind: "comment", message };
  }
  return { kind: "message", message };
}

export function messageText(message: TelegramMessageShape): string | null {
  if (typeof message.text === "string") return message.text;
  if (typeof message.caption === "string") return message.caption;
  return null;
}

export function chatIdOf(message: TelegramMessageShape): string | null {
  const id = message.chat?.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

function asMessage(value: unknown): TelegramMessageShape | null {
  if (!value || typeof value !== "object") return null;
  return value as TelegramMessageShape;
}
