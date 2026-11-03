import type { BotFatherStep } from "./botfather.js";
import { publicMtprotoError, rpcErrorName } from "./flood.js";

export interface ListedChat {
  telegramId: string;
  accessHash: string;
  title: string;
  username: string | null;
  kind: "channel" | "supergroup" | "group";
  role: "creator" | "admin" | "member";
}

export interface ChatRef {
  telegramId: string;
  accessHash: string;
}

export interface ChannelStats {
  participantsCount: number | null;
  about: string | null;
  messages: { id: string; views: number | null }[];
  broadcastStats: {
    followers: number | null;
    viewsPerPost: number | null;
    sharesPerPost: number | null;
    reactionsPerPost: number | null;
  } | null;
  broadcastStatsReason: string | null;
}

export type SignInCodeResult =
  | {
      status: "authorized";
      userId: string;
      session: string;
    }
  | {
      status: "password_required";
      hint: string | null;
      session: string;
    };

export const ADMIN_RIGHTS_ON = {
  changeInfo: true,
  postMessages: true,
  editMessages: true,
  deleteMessages: true,
  banUsers: true,
  inviteUsers: true,
  pinMessages: true,
  addAdmins: false,
  anonymous: false,
  manageCall: false,
  other: true,
  manageTopics: false,
} as const;

export const ADMIN_RIGHTS_OFF = {
  changeInfo: false,
  postMessages: false,
  editMessages: false,
  deleteMessages: false,
  banUsers: false,
  inviteUsers: false,
  pinMessages: false,
  addAdmins: false,
  anonymous: false,
  manageCall: false,
  other: false,
  manageTopics: false,
} as const;

export interface MtprotoSocket {
  invoke(request: unknown): Promise<unknown>;
  sendCode(phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }>;
  checkPassword(password: string): Promise<string>;
  getDialogEntities(limit: number): Promise<unknown[]>;
  getEntity(username: string): Promise<unknown>;
  upload(bytes: Uint8Array, filename: string): Promise<unknown>;
  exchangeBotFather(steps: BotFatherStep[]): Promise<string[]>;
  exportSession(): string;
}

export interface MtprotoApi {
  signIn(input: { phoneNumber: string; phoneCodeHash: string; phoneCode: string }): unknown;
  getPassword(): unknown;
  createChannel(input: { title: string; about: string; megagroup: boolean }): unknown;
  editTitle(channel: unknown, title: string): unknown;
  editAbout(channel: unknown, about: string): unknown;
  editUsername(channel: unknown, username: string): unknown;
  editPhoto(channel: unknown, file: unknown): unknown;
  editAdmin(channel: unknown, user: unknown, admin: boolean): unknown;
  getFullChannel(channel: unknown): unknown;
  getMessagesViews(channel: unknown, ids: number[]): unknown;
  getBroadcastStats(channel: unknown): unknown;
  inputChannel(telegramId: string, accessHash: string): unknown;
}

export async function mtprotoSendCode(socket: MtprotoSocket, phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean; session: string }> {
  try {
    const sent = await socket.sendCode(phone);
    if (!sent.phoneCodeHash) throw new Error("mtproto_failed");
    return { ...sent, session: socket.exportSession() };
  } catch (error) {
    throw publicMtprotoError(error);
  }
}

export async function mtprotoSignIn(
  socket: MtprotoSocket,
  api: MtprotoApi,
  input: { phone: string; phoneCodeHash: string; code: string },
): Promise<SignInCodeResult> {
  try {
    const result = await socket.invoke(
      api.signIn({ phoneNumber: input.phone, phoneCodeHash: input.phoneCodeHash, phoneCode: input.code }),
    );
    if (isSignUpRequired(result)) throw new Error("signup_refused");
    const userId = readUserId(result);
    if (!userId) throw new Error("mtproto_failed");
    return { status: "authorized", userId, session: socket.exportSession() };
  } catch (error) {
    if (error instanceof Error && error.message === "signup_refused") throw error;
    if (rpcErrorName(error) === "SESSION_PASSWORD_NEEDED") {
      let hint: string | null = null;
      try {
        hint = readHint(await socket.invoke(api.getPassword()));
      } catch {
        hint = null;
      }
      return { status: "password_required", hint, session: socket.exportSession() };
    }
    throw publicMtprotoError(error);
  }
}

export async function mtprotoPassword(socket: MtprotoSocket, password: string): Promise<{ userId: string; session: string }> {
  try {
    const userId = await socket.checkPassword(password);
    if (!/^\d{1,30}$/.test(userId)) throw new Error("mtproto_failed");
    return { userId, session: socket.exportSession() };
  } catch (error) {
    throw publicMtprotoError(error);
  }
}

export async function mtprotoListOwn(socket: MtprotoSocket, limit: number): Promise<ListedChat[]> {
  const entities = await socket.getDialogEntities(limit);
  const chats: ListedChat[] = [];
  for (const entity of entities) {
    const mapped = mapEntity(entity);
    if (!mapped || mapped.role === "member") continue;
    chats.push(mapped);
  }
  return chats;
}

export async function mtprotoCreateChannel(
  socket: MtprotoSocket,
  api: MtprotoApi,
  input: { title: string; about: string; megagroup: boolean },
): Promise<ListedChat> {
  const result = await socket.invoke(api.createChannel(input));
  const chat = firstCreatedChat(result);
  if (!chat) throw new Error("mtproto_failed");
  return chat;
}

export async function mtprotoEditTitle(socket: MtprotoSocket, api: MtprotoApi, chat: ChatRef, title: string): Promise<void> {
  await socket.invoke(api.editTitle(api.inputChannel(chat.telegramId, chat.accessHash), title));
}

export async function mtprotoEditAbout(socket: MtprotoSocket, api: MtprotoApi, chat: ChatRef, about: string): Promise<void> {
  await socket.invoke(api.editAbout(api.inputChannel(chat.telegramId, chat.accessHash), about));
}

export async function mtprotoEditUsername(socket: MtprotoSocket, api: MtprotoApi, chat: ChatRef, username: string): Promise<void> {
  await socket.invoke(api.editUsername(api.inputChannel(chat.telegramId, chat.accessHash), username));
}

export async function mtprotoEditPhoto(socket: MtprotoSocket, api: MtprotoApi, chat: ChatRef, bytes: Uint8Array): Promise<void> {
  const file = await socket.upload(bytes, "photo.jpg");
  await socket.invoke(api.editPhoto(api.inputChannel(chat.telegramId, chat.accessHash), file));
}

export async function mtprotoSetAdmin(
  socket: MtprotoSocket,
  api: MtprotoApi,
  chat: ChatRef,
  username: string,
  admin: boolean,
): Promise<void> {
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) throw new Error("invalid_username");
  const user = await socket.getEntity(username);
  await socket.invoke(api.editAdmin(api.inputChannel(chat.telegramId, chat.accessHash), user, admin));
}

export async function mtprotoStats(
  socket: MtprotoSocket,
  api: MtprotoApi,
  chat: ChatRef,
  messageIds: string[],
): Promise<ChannelStats> {
  const channel = api.inputChannel(chat.telegramId, chat.accessHash);
  const ids = messageIds.map((id) => Number(id));
  const viewsResult = ids.length > 0 ? await socket.invoke(api.getMessagesViews(channel, ids)) : null;
  const full = await socket.invoke(api.getFullChannel(channel));
  let broadcastStats: ChannelStats["broadcastStats"] = null;
  let broadcastStatsReason: string | null = null;
  try {
    const stats = await socket.invoke(api.getBroadcastStats(channel));
    broadcastStats = mapBroadcastStats(stats);
    if (!broadcastStats) broadcastStatsReason = "unrecognized_broadcast_stats";
  } catch (error) {
    const name = rpcErrorName(error);
    broadcastStatsReason = /^[A-Z0-9_]{1,64}$/.test(name) ? name : "broadcast_stats_unavailable";
  }
  return {
    participantsCount: readParticipants(full),
    about: readAbout(full),
    messages: mapMessageViews(viewsResult, messageIds),
    broadcastStats,
    broadcastStatsReason: broadcastStats ? null : broadcastStatsReason,
  };
}

export function mapEntity(entity: unknown): ListedChat | null {
  if (!entity || typeof entity !== "object") return null;
  const record = entity as Record<string, unknown>;
  const className = String(record.className ?? "");
  if (className === "User" || className === "UserEmpty") return null;
  const telegramId = stringifyId(record.id);
  if (!telegramId) return null;
  const accessHash = stringifyId(record.accessHash) ?? "";
  const title = typeof record.title === "string" ? record.title : "";
  const username = typeof record.username === "string" && record.username.length > 0 ? record.username : null;
  let kind: ListedChat["kind"] | null = null;
  if (className === "Channel") {
    kind = record.megagroup || record.gigagroup ? "supergroup" : "channel";
  } else if (className === "Chat") {
    kind = "group";
  }
  if (!kind || !title) return null;
  const role: ListedChat["role"] = record.creator ? "creator" : record.adminRights ? "admin" : "member";
  return { telegramId, accessHash, title, username, kind, role };
}

export function mapMessageViews(result: unknown, messageIds: string[]): { id: string; views: number | null }[] {
  const views = result && typeof result === "object" ? (result as { views?: unknown }).views : undefined;
  const list = Array.isArray(views) ? views : [];
  return messageIds.map((id, index) => {
    const item = list[index];
    const value = item && typeof item === "object" ? (item as { views?: unknown }).views : undefined;
    return { id, views: typeof value === "number" && Number.isFinite(value) ? value : null };
  });
}

export function mapBroadcastStats(result: unknown): ChannelStats["broadcastStats"] {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (record.className && record.className !== "stats.BroadcastStats") return null;
  if (!("followers" in record) && !("viewsPerPost" in record)) return null;
  return {
    followers: absCurrent(record.followers),
    viewsPerPost: absCurrent(record.viewsPerPost),
    sharesPerPost: absCurrent(record.sharesPerPost),
    reactionsPerPost: absCurrent(record.reactionsPerPost),
  };
}

function firstCreatedChat(result: unknown): ListedChat | null {
  if (!result || typeof result !== "object") return null;
  const chats = (result as { chats?: unknown }).chats;
  if (!Array.isArray(chats)) return null;
  for (const chat of chats) {
    const mapped = mapEntity(chat);
    if (!mapped || mapped.kind === "group") continue;
    return { ...mapped, role: "creator" };
  }
  return null;
}

function isSignUpRequired(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return (result as { className?: string }).className === "auth.AuthorizationSignUpRequired";
}

function readUserId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const user = (result as { user?: unknown }).user ?? result;
  if (!user || typeof user !== "object") return null;
  return stringifyId((user as { id?: unknown }).id);
}

function readHint(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const hint = (result as { hint?: unknown }).hint;
  return typeof hint === "string" && hint.length > 0 ? hint.slice(0, 80) : null;
}

function readParticipants(result: unknown): number | null {
  const full = fullChat(result);
  const count = full?.participantsCount;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

function readAbout(result: unknown): string | null {
  const about = fullChat(result)?.about;
  return typeof about === "string" ? about : null;
}

function fullChat(result: unknown): { participantsCount?: unknown; about?: unknown } | null {
  if (!result || typeof result !== "object") return null;
  const full = (result as { fullChat?: unknown }).fullChat;
  if (!full || typeof full !== "object") return null;
  return full as { participantsCount?: unknown; about?: unknown };
}

function absCurrent(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const current = (value as { current?: unknown }).current;
  if (typeof current === "number" && Number.isFinite(current)) return current;
  if (typeof current === "bigint") return Number(current);
  return null;
}

function stringifyId(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d{1,30}$/.test(value)) return value;
  if (value && typeof value === "object") {
    const text = String(value);
    if (/^-?\d{1,30}$/.test(text)) return text;
  }
  return null;
}
