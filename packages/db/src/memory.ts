import type {
  Bot,
  Channel,
  Draft,
  IncomingMessage,
  PublishLog,
  PublishedMessage,
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
}
