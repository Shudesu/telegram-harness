import type {
  Bot,
  Channel,
  Draft,
  IncomingMessage,
  PublishLog,
  PublishedMessage,
} from "@telegram-harness/shared";

export interface Repo {
  insertBot(bot: Bot): Promise<void>;
  listBots(): Promise<Bot[]>;
  getBot(id: string): Promise<Bot | null>;
  insertChannel(channel: Channel): Promise<void>;
  listChannels(botId?: string): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | null>;
  findChannel(botId: string, chatId: string): Promise<Channel | null>;
  insertDraft(draft: Draft): Promise<void>;
  saveDraft(draft: Draft): Promise<void>;
  getDraft(id: string): Promise<Draft | null>;
  listDrafts(filter?: { status?: Draft["status"]; channelId?: string; limit?: number }): Promise<Draft[]>;
  findDraftBySource(source: string, sourceRef: string): Promise<Draft | null>;
  claimDueDrafts(nowIso: string, limit?: number): Promise<Draft[]>;
  insertMessage(message: PublishedMessage): Promise<void>;
  saveMessage(message: PublishedMessage): Promise<void>;
  getMessage(id: string): Promise<PublishedMessage | null>;
  listMessages(channelId?: string): Promise<PublishedMessage[]>;
  insertIncoming(message: IncomingMessage): Promise<"duplicate" | IncomingMessage>;
  listIncoming(botId?: string): Promise<IncomingMessage[]>;
  getIncoming(id: string): Promise<IncomingMessage | null>;
  addPublishLog(entry: PublishLog): Promise<void>;
}
