import { Api, type TelegramClient, utils } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import bigInt from "big-integer";
import { validateUserOperation, type UserOperation, type UserOperationParams } from "@telegram-harness/shared";

/** Deliberately finite API surface. No caller-supplied TL constructor, auth operation, or RPC name. */
export type OperationClient = Pick<TelegramClient, "getDialogs" | "getMessages" | "sendMessage" | "editMessage" | "deleteMessages" | "forwardMessages" | "sendFile" | "iterDownload" | "getInputEntity" | "getEntity" | "getMe" | "uploadFile" | "invoke">;
const MAX_DOWNLOAD_BYTES = 512_000; // Harness response bound, not Telegram's file limit.
function uploadFile(file: { filename: string; base64: string }): CustomFile {
  const bytes = Buffer.from(file.base64, "base64");
  return new CustomFile(file.filename, bytes.length, "", bytes);
}
function peerValue(peer: string) { return /^-?\d+$/.test(peer) ? bigInt(peer) : peer; }
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") return value.toJSON();
  return value;
}

export async function executeGramOperation<M extends UserOperation>(client: OperationClient, operation: M, params: UserOperationParams[M]): Promise<unknown> {
  const error = validateUserOperation(operation, params);
  if (error) throw new Error(error);
  const peer = (value: string) => client.getInputEntity(peerValue(value));
  const peers = (values: string[]) => Promise.all(values.map(peer));
  const channel = async (value: string) => utils.getInputChannel(await peer(value));
  const user = async (value: string) => utils.getInputUser(await peer(value));
  const handlers: { [K in UserOperation]: (p: UserOperationParams[K]) => Promise<unknown> } = {
    dialogs: async (p) => (await client.getDialogs({ limit: p.limit ?? 50, offsetDate: p.offsetDate, folder: p.folderId })).map((dialog) => ({ id: dialog.id?.toString(), title: dialog.title, unreadCount: dialog.unreadCount, date: dialog.date, isUser: dialog.isUser, isGroup: dialog.isGroup, isChannel: dialog.isChannel })),
    history: async (p) => plain(await client.getMessages(peerValue(p.peer), { limit: p.limit ?? 50, offsetId: p.offsetId })),
    search: async (p) => plain(await client.getMessages(peerValue(p.peer), { limit: p.limit ?? 50, offsetId: p.offsetId, search: p.query })),
    send_message: async (p) => plain(await client.sendMessage(peerValue(p.peer), { message: p.text, replyTo: p.replyTo, schedule: p.scheduleDate, silent: p.silent, parseMode: false })),
    edit_message: async (p) => plain(await client.editMessage(peerValue(p.peer), { message: p.messageId, text: p.text, schedule: p.scheduleDate, parseMode: false })),
    delete_messages: async (p) => plain(await client.deleteMessages(peerValue(p.peer), p.messageIds, { revoke: p.revoke ?? false })),
    forward_messages: async (p) => plain(await client.forwardMessages(peerValue(p.peer), { messages: p.messageIds, fromPeer: peerValue(p.fromPeer), schedule: p.scheduleDate, silent: p.silent })),
    send_media: async (p) => plain(await client.sendFile(peerValue(p.peer), { file: uploadFile(p.file), caption: p.caption, forceDocument: p.forceDocument, scheduleDate: p.scheduleDate, parseMode: false, workers: 1 })),
    download_media: async (p) => {
      const messages = await client.getMessages(peerValue(p.peer), { ids: [p.messageId] });
      const media = messages[0]?.media;
      if (!media || media instanceof Api.MessageMediaWebPage) throw new Error("media_not_downloadable");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of client.iterDownload({ file: media, requestSize: 65536, chunkSize: 65536, limit: 9 })) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_DOWNLOAD_BYTES) throw new Error("media_exceeds_harness_limit");
        chunks.push(bytes);
      }
      return { base64: Buffer.concat(chunks).toString("base64"), bytes: size };
    },
    contacts: async () => plain(await client.invoke(new Api.contacts.GetContacts({ hash: bigInt.zero }))),
    delete_contact: async (p) => plain(await client.invoke(new Api.contacts.DeleteContacts({ id: [await user(p.peer)] }))),
    folders: async () => plain(await client.invoke(new Api.messages.GetDialogFilters())),
    upsert_folder: async (p) => plain(await client.invoke(new Api.messages.UpdateDialogFilter({ id: p.id, filter: new Api.DialogFilter({ id: p.id, title: new Api.TextWithEntities({ text: p.title, entities: [] }), includePeers: await peers(p.includePeers), excludePeers: await peers(p.excludePeers ?? []), pinnedPeers: await peers(p.pinnedPeers ?? []) }) }))),
    delete_folder: async (p) => plain(await client.invoke(new Api.messages.UpdateDialogFilter({ id: p.id }))),
    send_reaction: async (p) => plain(await client.invoke(new Api.messages.SendReaction({ peer: await peer(p.peer), msgId: p.messageId, big: p.big, reaction: p.customEmojiId ? [new Api.ReactionCustomEmoji({ documentId: bigInt(p.customEmojiId) })] : p.emoji ? [new Api.ReactionEmoji({ emoticon: p.emoji })] : [] }))),
    stories: async (p) => plain(await client.invoke(new Api.stories.GetPeerStories({ peer: await peer(p.peer) }))),
    stories_by_id: async (p) => plain(await client.invoke(new Api.stories.GetStoriesByID({ peer: await peer(p.peer), id: p.ids }))),
    scheduled_messages: async (p) => plain(await client.invoke(new Api.messages.GetScheduledHistory({ peer: await peer(p.peer), hash: bigInt.zero }))),
    send_scheduled: async (p) => plain(await client.invoke(new Api.messages.SendScheduledMessages({ peer: await peer(p.peer), id: p.messageIds }))),
    delete_scheduled: async (p) => plain(await client.invoke(new Api.messages.DeleteScheduledMessages({ peer: await peer(p.peer), id: p.messageIds }))),
    send_poll: async (p) => {
      const poll = new Api.Poll({ id: bigInt.zero, question: new Api.TextWithEntities({ text: p.question, entities: [] }), answers: p.answers.map((text, i) => new Api.PollAnswer({ text: new Api.TextWithEntities({ text, entities: [] }), option: Buffer.from([i]) })), publicVoters: p.anonymous === false, multipleChoice: p.multipleChoice, quiz: p.quiz });
      return plain(await client.sendMessage(peerValue(p.peer), { message: "", file: new Api.InputMediaPoll({ poll, correctAnswers: p.quiz ? [Buffer.from([p.correctOption!])] : undefined }), schedule: p.scheduleDate }));
    },
    vote_poll: async (p) => plain(await client.invoke(new Api.messages.SendVote({ peer: await peer(p.peer), msgId: p.messageId, options: p.options.map((value) => Buffer.from(value, "base64")) }))),
    stop_poll: async (p) => {
      const message = (await client.getMessages(peerValue(p.peer), { ids: [p.messageId] }))[0];
      if (!(message?.media instanceof Api.MessageMediaPoll)) throw new Error("poll_not_found");
      const poll = new Api.Poll({ ...message.media.poll, closed: true });
      return plain(await client.invoke(new Api.messages.EditMessage({ peer: await peer(p.peer), id: p.messageId, media: new Api.InputMediaPoll({ poll }) })));
    },
    mark_read: async (p) => {
      const target = await peer(p.peer);
      return plain(await client.invoke(target instanceof Api.InputPeerChannel
        ? new Api.channels.ReadHistory({ channel: utils.getInputChannel(target), maxId: p.maxId })
        : new Api.messages.ReadHistory({ peer: target, maxId: p.maxId })));
    },
    profile: async () => plain(await client.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() }))),
    update_profile: async (p) => plain(await client.invoke(new Api.account.UpdateProfile(p))),
    update_username: async (p) => plain(await client.invoke(new Api.account.UpdateUsername(p))),
    update_profile_photo: async (p) => plain(await client.invoke(new Api.photos.UploadProfilePhoto({ file: await client.uploadFile({ file: uploadFile(p.file), workers: 1 }) }))),
    join_channel: async (p) => plain(await client.invoke(new Api.channels.JoinChannel({ channel: await channel(p.peer) }))),
    leave_channel: async (p) => plain(await client.invoke(new Api.channels.LeaveChannel({ channel: await channel(p.peer) }))),
    pin_message: async (p) => plain(await client.invoke(new Api.messages.UpdatePinnedMessage({ peer: await peer(p.peer), id: p.messageId, silent: p.silent, unpin: p.unpin }))),
    set_chat_permissions: async (p) => plain(await client.invoke(new Api.messages.EditChatDefaultBannedRights({ peer: await peer(p.peer), bannedRights: new Api.ChatBannedRights({ untilDate: p.untilDate ?? 0, sendMessages: p.sendMessages === false, sendMedia: p.sendMedia === false, inviteUsers: p.inviteUsers === false, changeInfo: p.changeInfo === false, pinMessages: p.pinMessages === false }) }))),
  };
  return handlers[operation](params);
}
