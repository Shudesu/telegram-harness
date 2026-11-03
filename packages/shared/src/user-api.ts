import { type Schema, safeApiInput, validateSchema } from "./api-schema.js";

/** Peers are public usernames, numeric dialog IDs, or "me"; raw access hashes are never inputs. */
export interface UserOperationParams {
  dialogs: { limit?: number; offsetDate?: number; folderId?: number };
  history: { peer: string; limit?: number; offsetId?: number };
  search: { peer: string; query: string; limit?: number; offsetId?: number };
  send_message: { peer: string; text: string; replyTo?: number; scheduleDate?: number; silent?: boolean };
  edit_message: { peer: string; messageId: number; text: string; scheduleDate?: number };
  delete_messages: { peer: string; messageIds: number[]; revoke?: boolean };
  forward_messages: { peer: string; fromPeer: string; messageIds: number[]; scheduleDate?: number; silent?: boolean };
  send_media: { peer: string; file: { filename: string; base64: string }; caption?: string; forceDocument?: boolean; scheduleDate?: number };
  download_media: { peer: string; messageId: number };
  contacts: Record<string, never>;
  delete_contact: { peer: string };
  folders: Record<string, never>;
  upsert_folder: { id: number; title: string; includePeers: string[]; excludePeers?: string[]; pinnedPeers?: string[] };
  delete_folder: { id: number };
  send_reaction: { peer: string; messageId: number; emoji?: string; customEmojiId?: string; big?: boolean };
  stories: { peer: string };
  stories_by_id: { peer: string; ids: number[] };
  scheduled_messages: { peer: string };
  send_scheduled: { peer: string; messageIds: number[] };
  delete_scheduled: { peer: string; messageIds: number[] };
  send_poll: { peer: string; question: string; answers: string[]; anonymous?: boolean; multipleChoice?: boolean; quiz?: boolean; correctOption?: number; scheduleDate?: number };
  vote_poll: { peer: string; messageId: number; options: string[] };
  stop_poll: { peer: string; messageId: number };
  mark_read: { peer: string; maxId: number };
  profile: Record<string, never>;
  update_profile: { firstName?: string; lastName?: string; about?: string };
  update_username: { username: string };
  update_profile_photo: { file: { filename: string; base64: string } };
  join_channel: { peer: string };
  leave_channel: { peer: string };
  pin_message: { peer: string; messageId: number; silent?: boolean; unpin?: boolean };
  set_chat_permissions: { peer: string; sendMessages?: boolean; sendMedia?: boolean; inviteUsers?: boolean; changeInfo?: boolean; pinMessages?: boolean; untilDate?: number };
}

const str = (maxLength = 4096): Schema => ({ type: "string", maxLength });
const int = (minimum = 0, maximum = 2147483647): Schema => ({ type: "integer", minimum, maximum });
const bool: Schema = { type: "boolean" };
const peer: Schema = { type: "string", pattern: "^(?:me|@[A-Za-z][A-Za-z0-9_]{3,31}|-?[1-9][0-9]{0,19})$" };
const list = (items: Schema, minItems = 1, maxItems = 100): Schema => ({ type: "array", items, minItems, maxItems });
const ids = list(int(1));
const file: Schema = { type: "object", properties: { filename: { ...str(100), pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }, base64: { ...str(700000), minLength: 4, pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" } }, required: ["filename", "base64"], additionalProperties: false };
const paging = { limit: int(1, 100), offsetId: int() };
function op<M extends "read" | "write">(mode: M, properties: Record<string, Schema>, required: string[] = []) { return { mode, schema: { type: "object", properties, required, additionalProperties: false } as Schema }; }
export const USER_OPERATIONS = {
  dialogs: op("read", { limit: int(1,100), offsetDate: int(), folderId: int(0,1) }),
  history: op("read", { peer, ...paging }, ["peer"]),
  search: op("read", { peer, query: str(), ...paging }, ["peer", "query"]),
  send_message: op("write", { peer, text: { ...str(), minLength: 1 }, replyTo: int(1), scheduleDate: int(1), silent: bool }, ["peer", "text"]),
  edit_message: op("write", { peer, messageId: int(1), text: str(), scheduleDate: int(1) }, ["peer", "messageId", "text"]),
  delete_messages: op("write", { peer, messageIds: ids, revoke: bool }, ["peer", "messageIds"]),
  forward_messages: op("write", { peer, fromPeer: peer, messageIds: ids, scheduleDate: int(1), silent: bool }, ["peer", "fromPeer", "messageIds"]),
  send_media: op("write", { peer, file, caption: str(1024), forceDocument: bool, scheduleDate: int(1) }, ["peer", "file"]),
  download_media: op("read", { peer, messageId: int(1) }, ["peer", "messageId"]),
  contacts: op("read", {}),
  delete_contact: op("write", { peer }, ["peer"]),
  folders: op("read", {}),
  upsert_folder: op("write", { id: int(2,255), title: { ...str(12), minLength: 1 }, includePeers: list(peer), excludePeers: list(peer,0), pinnedPeers: list(peer,0) }, ["id", "title", "includePeers"]),
  delete_folder: op("write", { id: int(2,255) }, ["id"]),
  send_reaction: op("write", { peer, messageId: int(1), emoji: str(64), customEmojiId: { ...str(30), pattern: "^[1-9][0-9]*$" }, big: bool }, ["peer", "messageId"]),
  stories: op("read", { peer }, ["peer"]),
  stories_by_id: op("read", { peer, ids }, ["peer", "ids"]),
  scheduled_messages: op("read", { peer }, ["peer"]),
  send_scheduled: op("write", { peer, messageIds: ids }, ["peer", "messageIds"]),
  delete_scheduled: op("write", { peer, messageIds: ids }, ["peer", "messageIds"]),
  send_poll: op("write", { peer, question: { ...str(300), minLength: 1 }, answers: list({ ...str(100), minLength: 1 },2,10), anonymous: bool, multipleChoice: bool, quiz: bool, correctOption: int(0,9), scheduleDate: int(1) }, ["peer", "question", "answers"]),
  vote_poll: op("write", { peer, messageId: int(1), options: list({ type: "string", minLength: 4, maxLength: 64, pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" },0,10) }, ["peer", "messageId", "options"]),
  stop_poll: op("write", { peer, messageId: int(1) }, ["peer", "messageId"]),
  mark_read: op("write", { peer, maxId: int() }, ["peer", "maxId"]),
  profile: op("read", {}),
  update_profile: op("write", { firstName: { ...str(64), minLength: 1 }, lastName: str(64), about: str(70) }),
  update_username: op("write", { username: { ...str(32), pattern: "^(?:[A-Za-z][A-Za-z0-9_]{4,31})?$" } }, ["username"]),
  update_profile_photo: op("write", { file }, ["file"]),
  join_channel: op("write", { peer }, ["peer"]),
  leave_channel: op("write", { peer }, ["peer"]),
  pin_message: op("write", { peer, messageId: int(1), silent: bool, unpin: bool }, ["peer", "messageId"]),
  set_chat_permissions: op("write", { peer, sendMessages: bool, sendMedia: bool, inviteUsers: bool, changeInfo: bool, pinMessages: bool, untilDate: int() }, ["peer"]),
} satisfies Record<keyof UserOperationParams, { mode: "read" | "write"; schema: Schema }>;
export type UserOperation = keyof UserOperationParams;
export function validateUserOperation(operation: unknown, params: unknown, mode?: "read" | "write"): string | null {
  if (typeof operation !== "string" || !Object.hasOwn(USER_OPERATIONS, operation)) return "unknown_user_operation";
  const entry = USER_OPERATIONS[operation as UserOperation];
  if (mode && entry.mode !== mode) return "user_operation_mode_mismatch";
  if (!safeApiInput(params) || !validateSchema(entry.schema, params)) return "invalid_user_params";
  const p = params as Record<string, unknown>;
  if (operation === "send_reaction" && p.emoji !== undefined && p.customEmojiId !== undefined) return "reaction_needs_one_type";
  if (operation === "send_poll" && (p.quiz ? typeof p.correctOption !== "number" || p.correctOption >= (p.answers as unknown[]).length || p.multipleChoice : p.correctOption !== undefined)) return "invalid_quiz_options";
  if (operation === "update_profile" && Object.keys(p).length === 0) return "empty_profile_update";
  return null;
}

export type UserReadOperation = { [M in UserOperation]: typeof USER_OPERATIONS[M]["mode"] extends "read" ? M : never }[UserOperation];
export type UserWriteOperation = Exclude<UserOperation, UserReadOperation>;
