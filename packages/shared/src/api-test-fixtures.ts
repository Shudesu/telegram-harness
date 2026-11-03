import { BOT_TYPES, type Schema, type UserOperation, type UserOperationParams } from "./index.js";
// Minimal structural fixtures for the method-wide approval tests; semantic examples are tested separately.
export function sample(schema: Schema, depth = 0): unknown {
  if (depth > 35) throw new Error("recursive_fixture");
  if (schema.ref === "InputFile") return { filename: "file.png", base64: "AQID" };
  if (schema.ref === "SecretReference") return { secretEnvName: "TELEGRAM_WEBHOOK_SECRET" };
  if (schema.ref) return sample(BOT_TYPES[schema.ref], depth + 1);
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return sample(schema.anyOf[0], depth + 1);
  if (schema.type === "string") return "example";
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "array") return [sample(schema.items!, depth + 1)];
  return Object.fromEntries((schema.required ?? []).map((key) => [key, sample(schema.properties![key], depth + 1)]));
}
export const userFixtures = {
  dialogs: { limit: 10 }, history: { peer: "me" }, search: { peer: "me", query: "hello" },
  send_message: { peer: "me", text: "hello" }, edit_message: { peer: "me", messageId: 1, text: "edited" },
  delete_messages: { peer: "me", messageIds: [1] }, forward_messages: { peer: "me", fromPeer: "@example", messageIds: [1] },
  send_media: { peer: "me", file: { filename: "tiny.png", base64: "AQID" } }, download_media: { peer: "me", messageId: 1 },
  contacts: {}, delete_contact: { peer: "@example" }, folders: {},
  upsert_folder: { id: 2, title: "Work", includePeers: ["me"] }, delete_folder: { id: 2 },
  send_reaction: { peer: "me", messageId: 1, emoji: "👍" }, stories: { peer: "me" }, stories_by_id: { peer: "me", ids: [1] },
  scheduled_messages: { peer: "me" }, send_scheduled: { peer: "me", messageIds: [1] }, delete_scheduled: { peer: "me", messageIds: [1] },
  send_poll: { peer: "me", question: "Choose", answers: ["A", "B"] }, vote_poll: { peer: "me", messageId: 1, options: ["AA=="] }, stop_poll: { peer: "me", messageId: 1 },
  mark_read: { peer: "me", maxId: 1 }, profile: {}, update_profile: { firstName: "Owner" }, update_username: { username: "example_owner" }, update_profile_photo: { file: { filename: "tiny.png", base64: "AQID" } },
  join_channel: { peer: "@example" }, leave_channel: { peer: "@example" }, pin_message: { peer: "me", messageId: 1 }, set_chat_permissions: { peer: "@example", sendMessages: false },
} satisfies { [M in UserOperation]: UserOperationParams[M] };

