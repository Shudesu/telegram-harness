import { Api, Logger, TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger";
import { CustomFile } from "telegram/client/uploads";
import { computeCheck } from "telegram/Password";
import { StringSession } from "telegram/sessions";
import bigInt from "big-integer";
import { exchangeWithBotFather, type BotFatherStep } from "./botfather.js";
import type { OpenSession } from "./client.js";
import { ADMIN_RIGHTS_OFF, ADMIN_RIGHTS_ON, type MtprotoApi, type MtprotoSocket } from "./mtproto.js";

// GramJS 2.26.22 loops `for (attempt = 0; attempt < requestRetries; attempt++)`.
// 0 never sends. 1 sends once and does not retry. floodSleepThreshold 0 keeps the library from sleeping.
export const GRAMJS_CLIENT_OPTIONS = {
  connectionRetries: 1,
  requestRetries: 1,
  autoReconnect: false,
  floodSleepThreshold: 0,
} as const;

export async function openGramJsSession(options: { apiId: number; apiHash: string; session: string }): Promise<OpenSession> {
  const client = new TelegramClient(new StringSession(options.session), options.apiId, options.apiHash, {
    ...GRAMJS_CLIENT_OPTIONS,
    baseLogger: new Logger(LogLevel.NONE),
  });
  client.setLogLevel(LogLevel.NONE);
  client.floodSleepThreshold = 0;
  await client.connect();
  const api = createApi();
  const socket = createSocket(client, options.apiId, options.apiHash);
  return {
    api,
    socket,
    exportSession: () => String(client.session.save()),
    close: async () => {
      await client.disconnect();
    },
  };
}

function createSocket(client: TelegramClient, apiId: number, apiHash: string): MtprotoSocket {
  return {
    invoke: (request) => client.invoke(request as never),
    async sendCode(phone: string) {
      const sent = await client.sendCode({ apiId, apiHash }, phone, false);
      return { phoneCodeHash: sent.phoneCodeHash, isCodeViaApp: sent.isCodeViaApp };
    },
    async checkPassword(password: string) {
      const info = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(info, password);
      const result = await client.invoke(new Api.auth.CheckPassword({ password: check }));
      if (!("user" in result) || !result.user) throw new Error("mtproto_failed");
      return stringifyId(result.user.id);
    },
    async getDialogEntities(limit: number) {
      const dialogs = await client.getDialogs({ limit });
      return dialogs.map((dialog) => dialog.entity).filter((entity) => entity !== undefined);
    },
    async getEntity(username: string) {
      if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) throw new Error("invalid_username");
      return client.getEntity(username);
    },
    async upload(bytes: Uint8Array, filename: string) {
      const buffer = Buffer.from(bytes);
      return client.uploadFile({
        file: new CustomFile(filename, buffer.length, "", buffer),
        workers: 1,
      });
    },
    exchangeBotFather(steps: BotFatherStep[]) {
      return exchangeWithBotFather(
        {
          async send(peer, step) {
            if (peer !== "botfather") throw new Error("dm_target_rejected");
            if (step.file) {
              const buffer = Buffer.from(step.file);
              await client.sendMessage(peer, { file: new CustomFile("photo.jpg", buffer.length, "", buffer) });
              return;
            }
            await client.sendMessage(peer, { message: step.text ?? "" });
          },
          async maxId(peer) {
            if (peer !== "botfather") throw new Error("dm_target_rejected");
            const messages = await client.getMessages(peer, { limit: 1 });
            return Number(messages[0]?.id ?? 0);
          },
          async incomingAfter(peer, afterId) {
            if (peer !== "botfather") throw new Error("dm_target_rejected");
            const messages = await client.getMessages(peer, { limit: 5 });
            const found = messages.find((message) => Number(message.id) > afterId && !message.out);
            if (!found) return null;
            return { id: Number(found.id), text: String(found.message ?? "") };
          },
        },
        steps,
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
    },
    exportSession: () => String(client.session.save()),
  };
}

function createApi(): MtprotoApi {
  return {
    signIn: (input) => new Api.auth.SignIn(input),
    getPassword: () => new Api.account.GetPassword(),
    createChannel: (input) => new Api.channels.CreateChannel({
        title: input.title,
        about: input.about,
        broadcast: !input.megagroup,
        megagroup: input.megagroup,
      }),
    editTitle: (channel, title) => new Api.channels.EditTitle({ channel: channel as never, title }),
    editAbout: (channel, about) => new Api.messages.EditChatAbout({ peer: channel as never, about }),
    editUsername: (channel, username) => new Api.channels.UpdateUsername({ channel: channel as never, username }),
    editPhoto: (channel, file) =>
      new Api.channels.EditPhoto({
        channel: channel as never,
        photo: new Api.InputChatUploadedPhoto({ file: file as never }),
      }),
    editAdmin: (channel, user, admin) => {
      const rights = admin ? ADMIN_RIGHTS_ON : ADMIN_RIGHTS_OFF;
      return new Api.channels.EditAdmin({
        channel: channel as never,
        userId: user as never,
        adminRights: new Api.ChatAdminRights({ ...rights }),
        rank: admin ? "admin" : "",
      });
    },
    getFullChannel: (channel) => new Api.channels.GetFullChannel({ channel: channel as never }),
    getMessagesViews: (channel, ids) =>
      new Api.messages.GetMessagesViews({
        peer: channel as never,
        id: ids,
        increment: false,
      }),
    getBroadcastStats: (channel) => new Api.stats.GetBroadcastStats({ channel: channel as never, dark: false }),
    inputChannel: (telegramId, accessHash) =>
      new Api.InputChannel({
        channelId: bigInt(telegramId) as never,
        accessHash: bigInt(accessHash || "0") as never,
      }),
  };
}

function stringifyId(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^\d{1,30}$/.test(value)) return value;
  if (value && typeof value === "object") {
    const text = String(value);
    if (/^\d{1,30}$/.test(text)) return text;
  }
  throw new Error("mtproto_failed");
}
