import type {
  AccountAction,
  Bot,
  Channel,
  Draft,
  IncomingMessage,
  OwnedChat,
  PublishLog,
  PublishedMessage,
  UserAccountState,
  UserLogin,
  UserRateKind,
} from "@telegram-harness/shared";
import type { Repo } from "./repo.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRepo implements Repo {
  private bots: Bot[] = [];
  private channels: Channel[] = [];
  private drafts: Draft[] = [];
  private messages: PublishedMessage[] = [];
  private incoming: IncomingMessage[] = [];
  private logs: PublishLog[] = [];
  private accountActions: AccountAction[] = [];
  private ownedChats: OwnedChat[] = [];
  private login: UserLogin | null = null;
  private userState: UserAccountState | null = null;
  private rateEvents: { id: string; kind: UserRateKind; createdAt: string }[] = [];

  async insertBot(bot: Bot): Promise<void> {
    this.bots.push(clone(bot));
  }

  async listBots(): Promise<Bot[]> {
    return this.bots.map(clone);
  }

  async getBot(id: string): Promise<Bot | null> {
    return clone(this.bots.find((bot) => bot.id === id) ?? null);
  }

  async insertChannel(channel: Channel): Promise<void> {
    if (this.channels.some((item) => item.botId === channel.botId && item.chatId === channel.chatId)) {
      throw new Error("duplicate_channel");
    }
    this.channels.push(clone(channel));
  }

  async listChannels(botId?: string): Promise<Channel[]> {
    return this.channels.filter((channel) => !botId || channel.botId === botId).map(clone);
  }

  async getChannel(id: string): Promise<Channel | null> {
    return clone(this.channels.find((channel) => channel.id === id) ?? null);
  }

  async findChannel(botId: string, chatId: string): Promise<Channel | null> {
    return clone(this.channels.find((channel) => channel.botId === botId && channel.chatId === chatId) ?? null);
  }

  async insertDraft(draft: Draft): Promise<void> {
    if (draft.sourceRef && this.drafts.some((item) => item.source === draft.source && item.sourceRef === draft.sourceRef)) {
      throw new Error("duplicate_source");
    }
    this.drafts.push(clone(draft));
  }

  async saveDraft(draft: Draft): Promise<void> {
    const index = this.drafts.findIndex((item) => item.id === draft.id);
    if (index < 0) throw new Error("draft_not_found");
    this.drafts[index] = clone(draft);
  }

  async getDraft(id: string): Promise<Draft | null> {
    return clone(this.drafts.find((draft) => draft.id === id) ?? null);
  }

  async listDrafts(filter?: { status?: Draft["status"]; channelId?: string; limit?: number }): Promise<Draft[]> {
    const limit = filter?.limit ?? 50;
    return this.drafts
      .filter((draft) => (!filter?.status || draft.status === filter.status) && (!filter?.channelId || draft.channelId === filter.channelId))
      .slice()
      .reverse()
      .slice(0, limit)
      .map(clone);
  }

  async findDraftBySource(source: string, sourceRef: string): Promise<Draft | null> {
    return clone(this.drafts.find((draft) => draft.source === source && draft.sourceRef === sourceRef) ?? null);
  }

  async claimDueDrafts(nowIso: string, limit = 20): Promise<Draft[]> {
    const due = this.drafts
      .filter((draft) => draft.status === "scheduled" && (draft.scheduledAt === null || draft.scheduledAt <= nowIso))
      .sort((a, b) => (a.scheduledAt ?? a.createdAt).localeCompare(b.scheduledAt ?? b.createdAt))
      .slice(0, limit);
    const claimed: Draft[] = [];
    for (const draft of due) {
      if (draft.status !== "scheduled") continue;
      draft.status = "publishing";
      draft.updatedAt = nowIso;
      claimed.push(clone(draft));
    }
    return claimed;
  }

  async insertMessage(message: PublishedMessage): Promise<void> {
    this.messages.push(clone(message));
  }

  async saveMessage(message: PublishedMessage): Promise<void> {
    const index = this.messages.findIndex((item) => item.id === message.id);
    if (index < 0) throw new Error("message_not_found");
    this.messages[index] = clone(message);
  }

  async getMessage(id: string): Promise<PublishedMessage | null> {
    return clone(this.messages.find((message) => message.id === id) ?? null);
  }

  async listMessages(channelId?: string): Promise<PublishedMessage[]> {
    return this.messages.filter((message) => !channelId || message.channelId === channelId).map(clone);
  }

  async insertIncoming(message: IncomingMessage): Promise<"duplicate" | IncomingMessage> {
    if (this.incoming.some((item) => item.botId === message.botId && item.updateId === message.updateId)) {
      return "duplicate";
    }
    this.incoming.push(clone(message));
    return clone(message);
  }

  async listIncoming(botId?: string): Promise<IncomingMessage[]> {
    return this.incoming.filter((item) => !botId || item.botId === botId).map(clone);
  }

  async getIncoming(id: string): Promise<IncomingMessage | null> {
    return clone(this.incoming.find((item) => item.id === id) ?? null);
  }

  async addPublishLog(entry: PublishLog): Promise<void> {
    this.logs.push(clone(entry));
  }

  async insertAccountAction(action: AccountAction): Promise<void> {
    this.accountActions.push(clone(action));
  }

  async saveAccountAction(action: AccountAction): Promise<void> {
    const index = this.accountActions.findIndex((item) => item.id === action.id);
    if (index < 0) throw new Error("account_action_not_found");
    this.accountActions[index] = clone(action);
  }

  async getAccountAction(id: string): Promise<AccountAction | null> {
    return clone(this.accountActions.find((item) => item.id === id) ?? null);
  }

  async listAccountActions(filter?: { status?: AccountAction["status"]; limit?: number }): Promise<AccountAction[]> {
    const limit = filter?.limit ?? 50;
    return this.accountActions
      .filter((item) => !filter?.status || item.status === filter.status)
      .slice()
      .reverse()
      .slice(0, limit)
      .map(clone);
  }

  async claimDueAccountActions(nowIso: string, limit = 20): Promise<AccountAction[]> {
    const due = this.accountActions
      .filter((item) => item.status === "scheduled" && (item.scheduledAt === null || item.scheduledAt <= nowIso))
      .sort((a, b) => (a.scheduledAt ?? a.createdAt).localeCompare(b.scheduledAt ?? b.createdAt))
      .slice(0, limit);
    const claimed: AccountAction[] = [];
    for (const item of due) {
      if (item.status !== "scheduled") continue;
      item.status = "publishing";
      item.updatedAt = nowIso;
      claimed.push(clone(item));
    }
    return claimed;
  }

  async upsertOwnedChat(chat: OwnedChat): Promise<OwnedChat> {
    const existing = this.ownedChats.find((item) => item.telegramId === chat.telegramId);
    if (existing) {
      existing.accessHash = chat.accessHash;
      existing.title = chat.title;
      existing.username = chat.username;
      existing.kind = chat.kind;
      existing.role = chat.role;
      existing.syncedAt = chat.syncedAt;
      return clone(existing);
    }
    this.ownedChats.push(clone(chat));
    return clone(chat);
  }

  async listOwnedChats(): Promise<OwnedChat[]> {
    return this.ownedChats.map(clone);
  }

  async getOwnedChat(id: string): Promise<OwnedChat | null> {
    return clone(this.ownedChats.find((item) => item.id === id) ?? null);
  }

  async saveUserLogin(login: UserLogin): Promise<void> {
    this.login = clone(login);
  }

  async getUserLogin(): Promise<UserLogin | null> {
    return clone(this.login);
  }

  async clearUserLogin(): Promise<void> {
    this.login = null;
  }

  async saveUserState(state: UserAccountState): Promise<void> {
    this.userState = clone(state);
  }

  async getUserState(): Promise<UserAccountState | null> {
    return clone(this.userState);
  }

  async clearUserState(): Promise<void> {
    this.userState = null;
  }

  async addUserRateEvent(event: { id: string; kind: UserRateKind; createdAt: string }): Promise<void> {
    const cutoff = Date.parse(event.createdAt) - 2 * 60 * 60 * 1000;
    this.rateEvents = this.rateEvents.filter((item) => Date.parse(item.createdAt) >= cutoff);
    this.rateEvents.push({ ...event });
  }

  async countUserRateEvents(kind: UserRateKind, sinceIso: string): Promise<number> {
    return this.rateEvents.filter((item) => item.kind === kind && item.createdAt >= sinceIso).length;
  }

  async latestUserRateEvent(kind: UserRateKind): Promise<string | null> {
    const found = this.rateEvents.filter((item) => item.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return found[0]?.createdAt ?? null;
  }
}
