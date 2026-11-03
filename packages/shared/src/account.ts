export type AccountStatus = "pending" | "scheduled" | "publishing" | "posted" | "rejected" | "failed";

const TOKEN_ENV = /^TELEGRAM_BOT_TOKEN_[A-Z0-9]{1,40}$/;
const SCHEDULED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Harness input bounds. They are not claims about Telegram's published limits.
 * Official ceilings that were not re-read from core.telegram.org are unknown.
 * See docs/user-account.md.
 */
export const USER_INPUT_LIMITS = {
  titleMax: 128,
  aboutMax: 255,
  botDescriptionMax: 512,
  botAboutMax: 120,
  displayNameMax: 64,
  commandMax: 30,
  commandNameMax: 32,
  commandDescriptionMax: 256,
  photoUrlMax: 2000,
  messageIdsMax: 20,
  passwordMax: 256,
} as const;

export const ACCOUNT_ACTIONS = [
  "create_channel",
  "create_supergroup",
  "edit_title",
  "edit_description",
  "edit_photo",
  "edit_username",
  "add_admin",
  "remove_admin",
  "botfather_create_bot",
  "botfather_set_name",
  "botfather_set_description",
  "botfather_set_about",
  "botfather_set_commands",
  "botfather_set_photo",
  "botfather_fetch_token",
  "botfather_revoke_token",
] as const;

export type AccountActionName = (typeof ACCOUNT_ACTIONS)[number];
export type OwnedChatKind = "channel" | "supergroup" | "group";
export type OwnedChatRole = "creator" | "admin";
export type UserRateKind = "read" | "write" | "login";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const BANNED_KEYS = new Set([
  "users",
  "members",
  "phones",
  "phone",
  "recipients",
  "targets",
  "invite",
  "inviteLink",
  "userIds",
  "contacts",
  "session",
  "token",
  "password",
  "apiHash",
  "api_hash",
  "accessHash",
  "access_hash",
  "__proto__",
  "constructor",
  "prototype",
]);

export interface OwnedChat {
  id: string;
  telegramId: string;
  accessHash: string;
  title: string;
  username: string | null;
  kind: OwnedChatKind;
  role: OwnedChatRole;
  syncedAt: string;
}

export interface AccountAction {
  id: string;
  action: AccountActionName;
  status: AccountStatus;
  payload: Record<string, unknown>;
  summary: string;
  scheduledAt: string | null;
  approvedAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserLogin {
  id: "current";
  status: "code_sent" | "password_required";
  phoneCodeHash: string;
  hint: string | null;
  expiresAt: string;
  updatedAt: string;
}

export interface UserAccountState {
  sessionEnvName: string;
  selfUserId: string | null;
  updatedAt: string;
}

export interface AccountRequest {
  action: AccountActionName;
  payload: Record<string, unknown>;
  summary: string;
  scheduledAt: string | null;
}

export function validatePhone(phone: string): string | null {
  if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone)) return "invalid_phone";
  return null;
}

export function validateLoginCode(code: string): string | null {
  if (typeof code !== "string" || !/^\d{5,6}$/.test(code)) return "invalid_login_code";
  return null;
}

export function validateLoginPassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 1 || password.length > USER_INPUT_LIMITS.passwordMax) {
    return "invalid_password";
  }
  if (password.includes("\u0000")) return "invalid_password";
  return null;
}

export function validatePublicUsername(value: string): string | null {
  if (typeof value !== "string" || !PUBLIC_USERNAME.test(value)) return "invalid_username";
  return null;
}

export function validatePhotoUrl(value: string): string | null {
  if (typeof value !== "string" || value.length < 12 || value.length > USER_INPUT_LIMITS.photoUrlMax) {
    return "invalid_photo_url";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "invalid_photo_url";
  }
  if (parsed.protocol !== "https:") return "invalid_photo_url";
  if (parsed.username || parsed.password) return "invalid_photo_url";
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return "invalid_photo_url";
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "invalid_photo_url";
  return null;
}

export function validateAccountRequest(input: unknown, scheduledAt?: string | null): AccountRequest | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "invalid_body" };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => BANNED_KEYS.has(key))) return { error: "bulk_or_secret_field_rejected" };
  const action = body.action;
  if (typeof action !== "string" || !isAccountAction(action)) return { error: "invalid_action" };
  const schedule = readSchedule(scheduledAt ?? null);
  if ("error" in schedule) return schedule;
  const built = buildPayload(action, body);
  if ("error" in built) return built;
  return { action, payload: built.payload, summary: built.summary, scheduledAt: schedule.scheduledAt };
}

function isAccountAction(value: string): value is AccountActionName {
  return (ACCOUNT_ACTIONS as readonly string[]).includes(value);
}

function readSchedule(value: string | null): { scheduledAt: string | null } | { error: string } {
  if (value === null || value === undefined || value === "") return { scheduledAt: null };
  if (!SCHEDULED_AT.test(value) || Number.isNaN(Date.parse(value))) return { error: "invalid_scheduled_at" };
  return { scheduledAt: value };
}

function buildPayload(
  action: AccountActionName,
  body: Record<string, unknown>,
): { payload: Record<string, unknown>; summary: string } | { error: string } {
  switch (action) {
    case "create_channel":
    case "create_supergroup": {
      const title = readText(body.title, 1, USER_INPUT_LIMITS.titleMax);
      if (!title) return { error: "invalid_title" };
      const about = readOptionalText(body.about, USER_INPUT_LIMITS.aboutMax);
      if (about === undefined) return { error: "invalid_about" };
      const label = action === "create_channel" ? "チャンネル" : "スーパーグループ";
      return { payload: { title, about }, summary: `${label}を作成: ${clip(title)}` };
    }
    case "edit_title": {
      const ownedChatId = readId(body.ownedChatId);
      const title = readText(body.title, 1, USER_INPUT_LIMITS.titleMax);
      if (!ownedChatId || !title) return { error: ownedChatId ? "invalid_title" : "invalid_owned_chat" };
      return { payload: { ownedChatId, title }, summary: `タイトルを変更: ${clip(title)}` };
    }
    case "edit_description": {
      const ownedChatId = readId(body.ownedChatId);
      const description = readOptionalText(body.description, USER_INPUT_LIMITS.aboutMax);
      if (!ownedChatId) return { error: "invalid_owned_chat" };
      if (description === undefined) return { error: "invalid_description" };
      return { payload: { ownedChatId, description }, summary: `説明を変更: ${clip(description || "（空）")}` };
    }
    case "edit_photo": {
      const ownedChatId = readId(body.ownedChatId);
      if (!ownedChatId) return { error: "invalid_owned_chat" };
      if (typeof body.photoUrl !== "string" || validatePhotoUrl(body.photoUrl)) return { error: "invalid_photo_url" };
      return { payload: { ownedChatId, photoUrl: body.photoUrl }, summary: "写真を変更" };
    }
    case "edit_username": {
      const ownedChatId = readId(body.ownedChatId);
      if (!ownedChatId) return { error: "invalid_owned_chat" };
      if (typeof body.username !== "string" || validatePublicUsername(body.username)) return { error: "invalid_username" };
      return { payload: { ownedChatId, username: body.username }, summary: `ユーザー名を変更: @${body.username}` };
    }
    case "add_admin": {
      const ownedChatId = readId(body.ownedChatId);
      if (!ownedChatId) return { error: "invalid_owned_chat" };
      const hasBot = body.botId !== undefined;
      const hasUsername = body.username !== undefined;
      if (hasBot === hasUsername) return { error: "admin_needs_one_target" };
      if (Array.isArray(body.botId) || Array.isArray(body.username)) return { error: "bulk_or_secret_field_rejected" };
      if (hasBot) {
        if (typeof body.botId !== "string" || !UUID.test(body.botId)) return { error: "invalid_bot" };
        return { payload: { ownedChatId, botId: body.botId }, summary: "登録済みボットを管理者にする" };
      }
      if (typeof body.username !== "string" || validatePublicUsername(body.username)) return { error: "invalid_username" };
      return { payload: { ownedChatId, username: body.username }, summary: `管理者を追加: @${body.username}` };
    }
    case "remove_admin": {
      const ownedChatId = readId(body.ownedChatId);
      if (!ownedChatId) return { error: "invalid_owned_chat" };
      if (typeof body.username !== "string" || validatePublicUsername(body.username)) return { error: "invalid_username" };
      return { payload: { ownedChatId, username: body.username }, summary: `管理者を外す: @${body.username}` };
    }
    case "botfather_create_bot": {
      const displayName = readText(body.displayName, 1, USER_INPUT_LIMITS.displayNameMax);
      if (!displayName) return { error: "invalid_display_name" };
      const username = readBotUsername(body.username);
      if (!username) return { error: "username_must_end_with_bot" };
      const tokenEnvName = readTokenEnv(body.tokenEnvName);
      if (!tokenEnvName) return { error: "invalid_token_env_name" };
      return {
        payload: { displayName, username, tokenEnvName },
        summary: `BotFather でボットを作成: @${username} → ${tokenEnvName}`,
      };
    }
    case "botfather_set_name": {
      const username = readBotUsername(body.username);
      const name = readText(body.name, 1, USER_INPUT_LIMITS.displayNameMax);
      if (!username) return { error: "username_must_end_with_bot" };
      if (!name) return { error: "invalid_display_name" };
      return { payload: { username, name }, summary: `BotFather で名前を変更: @${username}` };
    }
    case "botfather_set_description": {
      const username = readBotUsername(body.username);
      const text = readText(body.text, 1, USER_INPUT_LIMITS.botDescriptionMax);
      if (!username) return { error: "username_must_end_with_bot" };
      if (!text) return { error: "invalid_text" };
      return { payload: { username, text }, summary: `BotFather で description を変更: @${username}` };
    }
    case "botfather_set_about": {
      const username = readBotUsername(body.username);
      const text = readText(body.text, 1, USER_INPUT_LIMITS.botAboutMax);
      if (!username) return { error: "username_must_end_with_bot" };
      if (!text) return { error: "invalid_text" };
      return { payload: { username, text }, summary: `BotFather で about を変更: @${username}` };
    }
    case "botfather_set_commands": {
      const username = readBotUsername(body.username);
      if (!username) return { error: "username_must_end_with_bot" };
      const commands = readCommands(body.commands);
      if (!commands) return { error: "invalid_commands" };
      return { payload: { username, commands }, summary: `BotFather でコマンドを変更: @${username} (${commands.length})` };
    }
    case "botfather_set_photo": {
      const username = readBotUsername(body.username);
      if (!username) return { error: "username_must_end_with_bot" };
      if (typeof body.photoUrl !== "string" || validatePhotoUrl(body.photoUrl)) return { error: "invalid_photo_url" };
      return { payload: { username, photoUrl: body.photoUrl }, summary: `BotFather で写真を変更: @${username}` };
    }
    case "botfather_fetch_token":
    case "botfather_revoke_token": {
      const username = readBotUsername(body.username);
      if (!username) return { error: "username_must_end_with_bot" };
      const tokenEnvName = readTokenEnv(body.tokenEnvName);
      if (!tokenEnvName) return { error: "invalid_token_env_name" };
      const label = action === "botfather_fetch_token" ? "トークンを取得" : "トークンを再発行";
      return { payload: { username, tokenEnvName }, summary: `BotFather で${label}: @${username} → ${tokenEnvName}` };
    }
    default:
      return { error: "invalid_action" };
  }
}

function readId(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value;
}

function readText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

function readOptionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return "";
  return readText(value, 0, max) ?? undefined;
}

function readBotUsername(value: unknown): string | null {
  if (typeof value !== "string" || validatePublicUsername(value)) return null;
  if (!value.toLowerCase().endsWith("bot")) return null;
  return value;
}

function readTokenEnv(value: unknown): string | null {
  if (typeof value !== "string" || !TOKEN_ENV.test(value)) return null;
  return value;
}

function readCommands(value: unknown): { command: string; description: string }[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > USER_INPUT_LIMITS.commandMax) return null;
  const commands: { command: string; description: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "command" && key !== "description")) return null;
    if (typeof record.command !== "string" || !/^[a-z0-9_]{1,32}$/.test(record.command)) return null;
    const description = readText(record.description, 1, USER_INPUT_LIMITS.commandDescriptionMax);
    if (!description) return null;
    commands.push({ command: record.command, description });
  }
  return commands;
}

function clip(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
