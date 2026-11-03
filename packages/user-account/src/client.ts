import type { BotFatherStep } from "./botfather.js";
import { withFloodWait } from "./flood.js";
import type { ChannelStats, ChatRef, ListedChat, MtprotoApi, MtprotoSocket } from "./mtproto.js";
import {
  mtprotoCreateChannel,
  mtprotoEditAbout,
  mtprotoEditPhoto,
  mtprotoEditTitle,
  mtprotoEditUsername,
  mtprotoListOwn,
  mtprotoPassword,
  mtprotoSendCode,
  mtprotoSetAdmin,
  mtprotoSignIn,
  mtprotoStats,
} from "./mtproto.js";
import type { SignInCodeResult } from "./mtproto.js";

export interface UserCall {
  method: string;
  detail: string;
}

export interface OpenSession {
  api: MtprotoApi;
  socket: MtprotoSocket;
  exportSession(): string;
  close(): Promise<void>;
}

export interface UserAccountClient {
  readonly mode: "live" | "dry-run" | "disabled";
  readonly calls: readonly UserCall[];
  takeSessionUpdate(): string | null;
  sendLoginCode(session: string, phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean; session: string }>;
  signInWithCode(input: { session: string; phone: string; phoneCodeHash: string; code: string }): Promise<SignInCodeResult>;
  signInWithPassword(input: { session: string; password: string }): Promise<{ session: string; userId: string }>;
  listOwnChats(session: string): Promise<ListedChat[]>;
  createChannel(session: string, input: { title: string; about: string; megagroup: boolean }): Promise<ListedChat>;
  editTitle(session: string, chat: ChatRef, title: string): Promise<void>;
  editAbout(session: string, chat: ChatRef, about: string): Promise<void>;
  editUsername(session: string, chat: ChatRef, username: string): Promise<void>;
  editPhoto(session: string, chat: ChatRef, bytes: Uint8Array): Promise<void>;
  setAdmin(session: string, chat: ChatRef, username: string, admin: boolean): Promise<void>;
  getChannelStats(session: string, chat: ChatRef, messageIds: string[]): Promise<ChannelStats>;
  runBotFather(session: string, steps: BotFatherStep[]): Promise<string[]>;
}

const RETRY_METHODS = new Set(["listOwnChats", "getChannelStats"]);

export class DisabledUserAccount implements UserAccountClient {
  readonly mode = "disabled" as const;
  readonly calls: UserCall[] = [];

  takeSessionUpdate(): string | null {
    return null;
  }

  sendLoginCode(): Promise<never> {
    return this.fail();
  }
  signInWithCode(): Promise<never> {
    return this.fail();
  }
  signInWithPassword(): Promise<never> {
    return this.fail();
  }
  listOwnChats(): Promise<never> {
    return this.fail();
  }
  createChannel(): Promise<never> {
    return this.fail();
  }
  editTitle(): Promise<never> {
    return this.fail();
  }
  editAbout(): Promise<never> {
    return this.fail();
  }
  editUsername(): Promise<never> {
    return this.fail();
  }
  editPhoto(): Promise<never> {
    return this.fail();
  }
  setAdmin(): Promise<never> {
    return this.fail();
  }
  getChannelStats(): Promise<never> {
    return this.fail();
  }
  runBotFather(): Promise<never> {
    return this.fail();
  }

  private fail(): Promise<never> {
    return Promise.reject(new Error("user_network_disabled"));
  }
}

export class FailingUserAccount implements UserAccountClient {
  readonly mode = "live" as const;
  readonly calls: UserCall[] = [];
  constructor(private readonly reason: string) {}
  takeSessionUpdate(): string | null {
    return null;
  }
  sendLoginCode(): Promise<never> {
    return this.fail();
  }
  signInWithCode(): Promise<never> {
    return this.fail();
  }
  signInWithPassword(): Promise<never> {
    return this.fail();
  }
  listOwnChats(): Promise<never> {
    return this.fail();
  }
  createChannel(): Promise<never> {
    return this.fail();
  }
  editTitle(): Promise<never> {
    return this.fail();
  }
  editAbout(): Promise<never> {
    return this.fail();
  }
  editUsername(): Promise<never> {
    return this.fail();
  }
  editPhoto(): Promise<never> {
    return this.fail();
  }
  setAdmin(): Promise<never> {
    return this.fail();
  }
  getChannelStats(): Promise<never> {
    return this.fail();
  }
  runBotFather(): Promise<never> {
    return this.fail();
  }
  private fail(): Promise<never> {
    return Promise.reject(new Error(this.reason));
  }
}

export class DryRunUserAccount implements UserAccountClient {
  readonly mode = "dry-run" as const;
  readonly calls: UserCall[] = [];
  passwordRequired = false;
  scriptedError: unknown = null;
  botFatherReplies: string[] | null = null;
  private sequence = 100;
  private chats: ListedChat[] = [];

  constructor(private readonly sleep: (ms: number) => Promise<void> = async () => undefined) {}

  takeSessionUpdate(): string | null {
    return null;
  }

  async sendLoginCode(session: string, phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean; session: string }> {
    this.note("sendCode", `digits:${phone.length}`);
    void session;
    await this.maybeFail("sendCode");
    return { phoneCodeHash: "dry-run-hash", isCodeViaApp: true, session: "dry-run-session" };
  }

  async signInWithCode(input: { session: string }): Promise<SignInCodeResult> {
    this.note("signIn", "code");
    this.requireSession(input.session);
    await this.maybeFail("signIn");
    if (this.passwordRequired) {
      return { status: "password_required", hint: "dry-run", session: "dry-run-session" };
    }
    return { status: "authorized", userId: "10001", session: "dry-run-session" };
  }

  async signInWithPassword(input: { session: string }): Promise<{ session: string; userId: string }> {
    this.note("checkPassword", "password");
    this.requireSession(input.session);
    await this.maybeFail("checkPassword");
    return { session: "dry-run-session", userId: "10001" };
  }

  async listOwnChats(session: string): Promise<ListedChat[]> {
    this.note("listOwnChats", `count:${this.chats.length}`);
    this.requireSession(session);
    await this.maybeFail("listOwnChats");
    return this.chats.map((chat) => ({ ...chat }));
  }

  async createChannel(session: string, input: { title: string; about: string; megagroup: boolean }): Promise<ListedChat> {
    this.note("createChannel", input.megagroup ? "supergroup" : "channel");
    this.requireSession(session);
    await this.maybeFail("createChannel");
    this.sequence += 1;
    const chat: ListedChat = {
      telegramId: String(this.sequence),
      accessHash: "dry-run-hash",
      title: input.title,
      username: null,
      kind: input.megagroup ? "supergroup" : "channel",
      role: "creator",
    };
    this.chats.push(chat);
    return { ...chat };
  }

  async editTitle(session: string, chat: ChatRef, title: string): Promise<void> {
    this.note("editTitle", chat.telegramId);
    this.requireSession(session);
    await this.maybeFail("editTitle");
    const found = this.chats.find((item) => item.telegramId === chat.telegramId);
    if (found) found.title = title;
  }

  async editAbout(session: string, chat: ChatRef): Promise<void> {
    this.note("editAbout", chat.telegramId);
    this.requireSession(session);
    await this.maybeFail("editAbout");
  }

  async editUsername(session: string, chat: ChatRef, username: string): Promise<void> {
    this.note("editUsername", username);
    this.requireSession(session);
    await this.maybeFail("editUsername");
    const found = this.chats.find((item) => item.telegramId === chat.telegramId);
    if (found) found.username = username;
  }

  async editPhoto(session: string, chat: ChatRef): Promise<void> {
    this.note("editPhoto", chat.telegramId);
    this.requireSession(session);
    await this.maybeFail("editPhoto");
  }

  async setAdmin(session: string, chat: ChatRef, username: string, admin: boolean): Promise<void> {
    this.note("setAdmin", `${admin ? "add" : "remove"}:${username}:${chat.telegramId}`);
    this.requireSession(session);
    await this.maybeFail("setAdmin");
  }

  async getChannelStats(session: string, chat: ChatRef, messageIds: string[]): Promise<ChannelStats> {
    this.note("getChannelStats", chat.telegramId);
    this.requireSession(session);
    await this.maybeFail("getChannelStats");
    return {
      participantsCount: null,
      about: null,
      messages: messageIds.map((id) => ({ id, views: null })),
      broadcastStats: null,
      broadcastStatsReason: "dry_run",
    };
  }

  async runBotFather(session: string, steps: BotFatherStep[]): Promise<string[]> {
    this.requireSession(session);
    const replies: string[] = [];
    for (const step of steps) {
      const detail = step.file ? "file" : (step.text ?? "").startsWith("/") ? (step.text ?? "").split(" ")[0] ?? "text" : "text";
      this.note("botFather", detail ?? "text");
      await this.maybeFail("botFather");
      replies.push("ok");
    }
    if (this.botFatherReplies) return this.botFatherReplies;
    const command = steps.find((step) => step.text?.startsWith("/"))?.text;
    if (command === "/newbot" || command === "/token" || command === "/revoke") {
      replies[replies.length - 1] = `Use this token to access the HTTP API:\n${fakeToken()}`;
    }
    return replies;
  }

  private note(method: string, detail: string): void {
    this.calls.push({ method, detail });
  }

  private requireSession(session: string): void {
    if (!session) throw new Error("user_not_logged_in");
  }

  private async maybeFail(method: string): Promise<void> {
    if (!this.scriptedError) return;
    const error = this.scriptedError;
    this.scriptedError = null;
    await withFloodWait(async () => {
      throw error;
    }, this.sleep, { retry: RETRY_METHODS.has(method) });
  }
}

export class LiveUserAccount implements UserAccountClient {
  readonly mode = "live" as const;
  readonly calls: UserCall[] = [];
  private updated: string | null = null;

  constructor(
    private readonly open: (session: string) => Promise<OpenSession>,
    private readonly sleep: (ms: number) => Promise<void> = delay,
  ) {}

  takeSessionUpdate(): string | null {
    const value = this.updated;
    this.updated = null;
    return value;
  }

  sendLoginCode(session: string, phone: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean; session: string }> {
    return this.run(session, "sendCode", `digits:${phone.length}`, (opened) => mtprotoSendCode(opened.socket, phone));
  }

  signInWithCode(input: { session: string; phone: string; phoneCodeHash: string; code: string }): Promise<SignInCodeResult> {
    return this.run(input.session, "signIn", "code", (opened) => mtprotoSignIn(opened.socket, opened.api, input));
  }

  signInWithPassword(input: { session: string; password: string }): Promise<{ session: string; userId: string }> {
    return this.run(input.session, "checkPassword", "password", (opened) => mtprotoPassword(opened.socket, input.password));
  }

  listOwnChats(session: string): Promise<ListedChat[]> {
    return this.run(session, "listOwnChats", "dialogs", (opened) => mtprotoListOwn(opened.socket, 100));
  }

  createChannel(session: string, input: { title: string; about: string; megagroup: boolean }): Promise<ListedChat> {
    return this.run(session, "createChannel", input.megagroup ? "supergroup" : "channel", (opened) =>
      mtprotoCreateChannel(opened.socket, opened.api, input),
    );
  }

  editTitle(session: string, chat: ChatRef, title: string): Promise<void> {
    return this.run(session, "editTitle", chat.telegramId, (opened) => mtprotoEditTitle(opened.socket, opened.api, chat, title));
  }

  editAbout(session: string, chat: ChatRef, about: string): Promise<void> {
    return this.run(session, "editAbout", chat.telegramId, (opened) => mtprotoEditAbout(opened.socket, opened.api, chat, about));
  }

  editUsername(session: string, chat: ChatRef, username: string): Promise<void> {
    return this.run(session, "editUsername", username, (opened) => mtprotoEditUsername(opened.socket, opened.api, chat, username));
  }

  editPhoto(session: string, chat: ChatRef, bytes: Uint8Array): Promise<void> {
    return this.run(session, "editPhoto", chat.telegramId, (opened) => mtprotoEditPhoto(opened.socket, opened.api, chat, bytes));
  }

  setAdmin(session: string, chat: ChatRef, username: string, admin: boolean): Promise<void> {
    return this.run(session, "setAdmin", `${admin ? "add" : "remove"}:${username}`, (opened) =>
      mtprotoSetAdmin(opened.socket, opened.api, chat, username, admin),
    );
  }

  getChannelStats(session: string, chat: ChatRef, messageIds: string[]): Promise<ChannelStats> {
    return this.run(session, "getChannelStats", chat.telegramId, (opened) => mtprotoStats(opened.socket, opened.api, chat, messageIds));
  }

  runBotFather(session: string, steps: BotFatherStep[]): Promise<string[]> {
    const command = steps.find((step) => step.text?.startsWith("/"))?.text?.split(" ")[0] ?? "botfather";
    return this.run(session, "botFather", command, (opened) => opened.socket.exchangeBotFather(steps));
  }

  private async run<T>(session: string, method: string, detail: string, fn: (opened: OpenSession) => Promise<T>): Promise<T> {
    this.calls.push({ method, detail });
    return withFloodWait(
      async () => {
        const opened = await this.open(session);
        try {
          const value = await fn(opened);
          const next = opened.exportSession();
          if (next && next !== session) this.updated = next;
          return value;
        } finally {
          await opened.close();
        }
      },
      this.sleep,
      { retry: RETRY_METHODS.has(method) },
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeToken(): string {
  return `1000000001:${"A".repeat(35)}`;
}
