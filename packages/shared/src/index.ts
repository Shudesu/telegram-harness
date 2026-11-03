export const VERSION = "0.2.0";

/**
 * Limits copied from the official Bot API reference.
 * Text and caption bounds are defined there as counts *after entities parsing*.
 * Callers that only have the raw string cannot reproduce that count.
 * `rawLength` below is JavaScript string length (UTF-16 code units) and is a
 * preflight, not a claim that it matches Telegram's parsed length.
 *
 * Source checked against https://core.telegram.org/bots/api on 2026-11-03.
 */
export const BOT_API_LIMITS = {
  textMin: 1,
  textMax: 4096,
  captionMax: 1024,
  albumMin: 2,
  albumMax: 10,
  callbackDataMinBytes: 1,
  callbackDataMaxBytes: 64,
  deleteMessageIdsMin: 1,
  deleteMessageIdsMax: 100,
  webhookSecretMin: 1,
  webhookSecretMax: 256,
} as const;

export const VIEWS_REASON =
  "unsupported_by_bot_api: Message has no views field. This Bot API route does not call messages.getMessagesViews. User-account stats are a separate route.";

export type DraftAction = "publish" | "edit" | "delete" | "reply";
export type DraftKind = "text" | "photo" | "video" | "album";
export type DraftStatus =
  | "pending"
  | "scheduled"
  | "publishing"
  | "posted"
  | "rejected"
  | "failed";
export type ChannelKind = "channel" | "group" | "supergroup";
export type ParseMode = "HTML" | "MarkdownV2";
export type IncomingKind = "message" | "channel_post" | "comment";
export type MessageStatus = "posted" | "edited" | "deleted";

export interface ButtonSpec {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface MediaSpec {
  type: "photo" | "video";
  url: string;
}

export interface DraftPayload {
  text?: string;
  media?: MediaSpec[];
  buttons?: ButtonSpec[];
  parseMode?: ParseMode;
}

export interface Bot {
  id: string;
  name: string;
  tokenEnvName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  botId: string;
  chatId: string;
  title: string;
  kind: ChannelKind;
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  id: string;
  channelId: string;
  action: DraftAction;
  kind: DraftKind;
  status: DraftStatus;
  payload: DraftPayload;
  scheduledAt: string | null;
  source: string;
  sourceRef: string | null;
  incomingId: string | null;
  replyToTelegramMessageId: string | null;
  targetMessageId: string | null;
  approvedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedMessage {
  id: string;
  channelId: string;
  draftId: string;
  telegramMessageIds: string[];
  kind: DraftKind;
  text: string | null;
  status: MessageStatus;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IncomingMessage {
  id: string;
  botId: string;
  updateId: number;
  chatId: string;
  telegramMessageId: string | null;
  fromUserId: string | null;
  text: string | null;
  kind: IncomingKind;
  raw: unknown;
  createdAt: string;
}

export interface PublishLog {
  id: string;
  draftId: string;
  method: string;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export interface TelegramCallRecord {
  method: string;
  body: Record<string, unknown>;
}

const TOKEN_ENV = /^TELEGRAM_BOT_TOKEN_[A-Z0-9]{1,40}$/;
const CHAT_ID = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
const SOURCE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

export function rawLength(value: string): number {
  return value.length;
}

export function validateTokenEnvName(name: string): string | null {
  if (!TOKEN_ENV.test(name)) return "invalid_token_env_name";
  return null;
}

export function validateChatId(chatId: string): string | null {
  if (!CHAT_ID.test(chatId)) return "invalid_chat_id";
  return null;
}

function validateButtons(buttons: ButtonSpec[] | undefined): string | null {
  if (!buttons) return null;
  if (!Array.isArray(buttons)) return "invalid_buttons";
  for (const button of buttons) {
    // The Bot API type page describes button text but does not state a maximum.
    // 1–256 is a harness input bound, not a documented Telegram limit.
    if (!button || typeof button.text !== "string" || button.text.length < 1 || button.text.length > 256) {
      return "invalid_button_text";
    }
    const hasUrl = typeof button.url === "string";
    const hasCallback = typeof button.callbackData === "string";
    if (hasUrl === hasCallback) return "button_needs_exactly_one_action";
    if (hasUrl && !/^https?:\/\/[^\s]+$|^tg:\/\/[^\s]+$/i.test(button.url ?? "")) return "invalid_button_url";
    if (hasCallback) {
      const bytes = new TextEncoder().encode(button.callbackData ?? "").length;
      if (bytes < BOT_API_LIMITS.callbackDataMinBytes || bytes > BOT_API_LIMITS.callbackDataMaxBytes) {
        return "callback_data_length";
      }
    }
  }
  return null;
}

function validateMedia(media: MediaSpec[] | undefined, expected: number | { min: number; max: number }): string | null {
  if (!media || !Array.isArray(media)) return "media_required";
  const min = typeof expected === "number" ? expected : expected.min;
  const max = typeof expected === "number" ? expected : expected.max;
  if (media.length < min || media.length > max) return "album_size";
  for (const item of media) {
    if (!item || (item.type !== "photo" && item.type !== "video")) return "invalid_media_type";
    if (typeof item.url !== "string" || !HTTP_URL.test(item.url) || item.url.length > 2000) return "invalid_media_url";
  }
  return null;
}

function validateCaption(text: string | undefined, required: boolean): string | null {
  if (text === undefined || text === "") return required ? "text_required" : null;
  if (typeof text !== "string") return "invalid_text";
  if (rawLength(text) > BOT_API_LIMITS.captionMax) return "caption_length";
  return null;
}

function validateBodyText(text: string | undefined): string | null {
  if (typeof text !== "string" || rawLength(text) < BOT_API_LIMITS.textMin) return "text_required";
  if (rawLength(text) > BOT_API_LIMITS.textMax) return "text_length";
  return null;
}

function validateParseMode(mode: ParseMode | undefined): string | null {
  if (mode === undefined) return null;
  if (mode !== "HTML" && mode !== "MarkdownV2") return "invalid_parse_mode";
  return null;
}

export function validatePublishPayload(kind: DraftKind, payload: DraftPayload): string | null {
  const parseError = validateParseMode(payload.parseMode);
  if (parseError) return parseError;
  if (kind === "album" && payload.buttons && payload.buttons.length > 0) {
    return "album_reply_markup_unsupported";
  }
  const buttonError = validateButtons(payload.buttons);
  if (buttonError) return buttonError;
  if (kind === "text") {
    if (payload.media && payload.media.length > 0) return "text_kind_rejects_media";
    return validateBodyText(payload.text);
  }
  if (kind === "photo" || kind === "video") {
    const mediaError = validateMedia(payload.media, 1);
    if (mediaError) return mediaError === "album_size" ? "media_count" : mediaError;
    if (payload.media?.[0]?.type !== kind) return "media_type_mismatch";
    return validateCaption(payload.text, false);
  }
  if (kind === "album") {
    const mediaError = validateMedia(payload.media, {
      min: BOT_API_LIMITS.albumMin,
      max: BOT_API_LIMITS.albumMax,
    });
    if (mediaError) return mediaError;
    return validateCaption(payload.text, false);
  }
  return "invalid_kind";
}

export function validateEditPayload(kind: DraftKind, payload: DraftPayload): string | null {
  if (kind === "album") return "album_edit_unsupported";
  const parseError = validateParseMode(payload.parseMode);
  if (parseError) return parseError;
  const buttonError = validateButtons(payload.buttons);
  if (buttonError) return buttonError;
  const hasButtons = Boolean(payload.buttons && payload.buttons.length > 0);
  const hasText = typeof payload.text === "string" && payload.text.length > 0;
  if (!hasButtons && !hasText) return "edit_empty";
  if (!hasText) return null;
  if (kind === "text") return validateBodyText(payload.text);
  return validateCaption(payload.text, true);
}

export function validateScheduledAt(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return "invalid_scheduled_at";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "invalid_scheduled_at";
  return null;
}

export function validateSource(source: string, sourceRef: string): string | null {
  if (!SOURCE.test(source)) return "invalid_source";
  if (typeof sourceRef !== "string" || sourceRef.length < 1 || sourceRef.length > 128) return "invalid_source_ref";
  return null;
}

export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export {
  ACCOUNT_ACTIONS,
  USER_INPUT_LIMITS,
  type AccountAction,
  type AccountActionName,
  type AccountRequest,
  type AccountStatus,
  type OwnedChat,
  type OwnedChatKind,
  type OwnedChatRole,
  type UserLogin,
  type UserAccountState,
  type UserRateKind,
  validateAccountRequest,
  validateLoginCode,
  validateLoginPassword,
  validatePhone,
  validatePhotoUrl,
  validatePublicUsername,
} from "./account.js";

export function redactSecrets(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/\d{6,}:[A-Za-z0-9_-]{10,}/g, "[redacted-token]");
  return out;
}

export * from "./api-schema.js";
export * from "./bot-api.js";
export * from "./user-api.js";
