import type {
  Bot,
  Channel,
  ChannelKind,
  Draft,
  DraftAction,
  DraftKind,
  DraftPayload,
  DraftStatus,
  IncomingKind,
  IncomingMessage,
  MessageStatus,
  PublishLog,
  PublishedMessage,
} from "@telegram-harness/shared";
import type { Repo } from "./repo.js";

export interface D1RunResult {
  meta?: { changes?: number };
}

export interface D1Prepared {
  bind(...args: unknown[]): D1Prepared;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<D1RunResult>;
}

export interface D1Like {
  prepare(sql: string): D1Prepared;
  exec(sql: string): Promise<unknown>;
}

interface BotRow {
  id: string;
  name: string;
  token_env_name: string;
  created_at: string;
  updated_at: string;
}

interface ChannelRow {
  id: string;
  bot_id: string;
  chat_id: string;
  title: string;
  kind: ChannelKind;
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id: string;
  channel_id: string;
  action: DraftAction;
  kind: DraftKind;
  status: DraftStatus;
  payload_json: string;
  scheduled_at: string | null;
  source: string;
  source_ref: string | null;
  incoming_id: string | null;
  reply_to_telegram_message_id: string | null;
  target_message_id: string | null;
  approved_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  channel_id: string;
  draft_id: string;
  telegram_message_ids_json: string;
  kind: DraftKind;
  text: string | null;
  status: MessageStatus;
  dry_run: number;
  created_at: string;
  updated_at: string;
}

interface IncomingRow {
  id: string;
  bot_id: string;
  update_id: number;
  chat_id: string;
  telegram_message_id: string | null;
  from_user_id: string | null;
  text: string | null;
  kind: IncomingKind;
  raw_json: string;
  created_at: string;
}

function mapBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    tokenEnvName: row.token_env_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    botId: row.bot_id,
    chatId: row.chat_id,
    title: row.title,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    channelId: row.channel_id,
    action: row.action,
    kind: row.kind,
    status: row.status,
    payload: JSON.parse(row.payload_json) as DraftPayload,
    scheduledAt: row.scheduled_at,
    source: row.source,
    sourceRef: row.source_ref,
    incomingId: row.incoming_id,
    replyToTelegramMessageId: row.reply_to_telegram_message_id,
    targetMessageId: row.target_message_id,
    approvedAt: row.approved_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): PublishedMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    draftId: row.draft_id,
    telegramMessageIds: JSON.parse(row.telegram_message_ids_json) as string[],
    kind: row.kind,
    text: row.text,
    status: row.status,
    dryRun: row.dry_run === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIncoming(row: IncomingRow): IncomingMessage {
  return {
    id: row.id,
    botId: row.bot_id,
    updateId: row.update_id,
    chatId: row.chat_id,
    telegramMessageId: row.telegram_message_id,
    fromUserId: row.from_user_id,
    text: row.text,
    kind: row.kind,
    raw: JSON.parse(row.raw_json) as unknown,
    createdAt: row.created_at,
  };
}

export class D1Repo implements Repo {
  constructor(private readonly db: D1Like) {}

  async insertBot(bot: Bot): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO bots (id, name, token_env_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(bot.id, bot.name, bot.tokenEnvName, bot.createdAt, bot.updatedAt)
      .run();
  }

  async listBots(): Promise<Bot[]> {
    const rows = await this.db.prepare("SELECT * FROM bots ORDER BY created_at ASC").all<BotRow>();
    return (rows.results ?? []).map(mapBot);
  }

  async getBot(id: string): Promise<Bot | null> {
    const row = await this.db.prepare("SELECT * FROM bots WHERE id = ?").bind(id).first<BotRow>();
    return row ? mapBot(row) : null;
  }

  async insertChannel(channel: Channel): Promise<void> {
    try {
      await this.db
        .prepare(
          "INSERT INTO channels (id, bot_id, chat_id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(channel.id, channel.botId, channel.chatId, channel.title, channel.kind, channel.createdAt, channel.updatedAt)
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("duplicate_channel");
      throw error;
    }
  }

  async listChannels(botId?: string): Promise<Channel[]> {
    const statement = botId
      ? this.db.prepare("SELECT * FROM channels WHERE bot_id = ? ORDER BY created_at ASC").bind(botId)
      : this.db.prepare("SELECT * FROM channels ORDER BY created_at ASC");
    const rows = await statement.all<ChannelRow>();
    return (rows.results ?? []).map(mapChannel);
  }

  async getChannel(id: string): Promise<Channel | null> {
    const row = await this.db.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<ChannelRow>();
    return row ? mapChannel(row) : null;
  }

  async findChannel(botId: string, chatId: string): Promise<Channel | null> {
    const row = await this.db
      .prepare("SELECT * FROM channels WHERE bot_id = ? AND chat_id = ?")
      .bind(botId, chatId)
      .first<ChannelRow>();
    return row ? mapChannel(row) : null;
  }

  async insertDraft(draft: Draft): Promise<void> {
    try {
      await this.bindDraft(
        "INSERT INTO drafts (id, channel_id, action, kind, status, payload_json, scheduled_at, source, source_ref, incoming_id, reply_to_telegram_message_id, target_message_id, approved_at, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        draft,
      ).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("duplicate_source");
      throw error;
    }
  }

  async saveDraft(draft: Draft): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE drafts SET
          channel_id = ?, action = ?, kind = ?, status = ?, payload_json = ?, scheduled_at = ?,
          source = ?, source_ref = ?, incoming_id = ?, reply_to_telegram_message_id = ?,
          target_message_id = ?, approved_at = ?, error = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        draft.channelId,
        draft.action,
        draft.kind,
        draft.status,
        JSON.stringify(draft.payload),
        draft.scheduledAt,
        draft.source,
        draft.sourceRef,
        draft.incomingId,
        draft.replyToTelegramMessageId,
        draft.targetMessageId,
        draft.approvedAt,
        draft.error,
        draft.updatedAt,
        draft.id,
      )
      .run();
    if ((result.meta?.changes ?? 0) < 1) throw new Error("draft_not_found");
  }

  async getDraft(id: string): Promise<Draft | null> {
    const row = await this.db.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<DraftRow>();
    return row ? mapDraft(row) : null;
  }

  async listDrafts(filter?: { status?: Draft["status"]; channelId?: string; limit?: number }): Promise<Draft[]> {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (filter?.status) {
      clauses.push("status = ?");
      args.push(filter.status);
    }
    if (filter?.channelId) {
      clauses.push("channel_id = ?");
      args.push(filter.channelId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(filter?.limit ?? 50, 100);
    const rows = await this.db
      .prepare(`SELECT * FROM drafts ${where} ORDER BY created_at DESC LIMIT ?`)
      .bind(...args, limit)
      .all<DraftRow>();
    return (rows.results ?? []).map(mapDraft);
  }

  async findDraftBySource(source: string, sourceRef: string): Promise<Draft | null> {
    const row = await this.db
      .prepare("SELECT * FROM drafts WHERE source = ? AND source_ref = ?")
      .bind(source, sourceRef)
      .first<DraftRow>();
    return row ? mapDraft(row) : null;
  }

  async claimDueDrafts(nowIso: string, limit = 20): Promise<Draft[]> {
    const rows = await this.db
      .prepare(
        `SELECT id FROM drafts
         WHERE status = 'scheduled' AND (scheduled_at IS NULL OR scheduled_at <= ?)
         ORDER BY COALESCE(scheduled_at, created_at) ASC
         LIMIT ?`,
      )
      .bind(nowIso, limit)
      .all<{ id: string }>();
    const claimed: Draft[] = [];
    for (const row of rows.results ?? []) {
      const update = await this.db
        .prepare("UPDATE drafts SET status = 'publishing', updated_at = ? WHERE id = ? AND status = 'scheduled'")
        .bind(nowIso, row.id)
        .run();
      if ((update.meta?.changes ?? 0) !== 1) continue;
      const draft = await this.getDraft(row.id);
      if (draft) claimed.push(draft);
    }
    return claimed;
  }

  async insertMessage(message: PublishedMessage): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO messages (
          id, channel_id, draft_id, telegram_message_ids_json, kind, text, status, dry_run, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        message.id,
        message.channelId,
        message.draftId,
        JSON.stringify(message.telegramMessageIds),
        message.kind,
        message.text,
        message.status,
        message.dryRun ? 1 : 0,
        message.createdAt,
        message.updatedAt,
      )
      .run();
  }

  async saveMessage(message: PublishedMessage): Promise<void> {
    const result = await this.db
      .prepare(
        "UPDATE messages SET text = ?, status = ?, telegram_message_ids_json = ?, updated_at = ? WHERE id = ?",
      )
      .bind(message.text, message.status, JSON.stringify(message.telegramMessageIds), message.updatedAt, message.id)
      .run();
    if ((result.meta?.changes ?? 0) < 1) throw new Error("message_not_found");
  }

  async getMessage(id: string): Promise<PublishedMessage | null> {
    const row = await this.db.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<MessageRow>();
    return row ? mapMessage(row) : null;
  }

  async listMessages(channelId?: string): Promise<PublishedMessage[]> {
    const statement = channelId
      ? this.db.prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at ASC").bind(channelId)
      : this.db.prepare("SELECT * FROM messages ORDER BY created_at ASC");
    const rows = await statement.all<MessageRow>();
    return (rows.results ?? []).map(mapMessage);
  }

  async insertIncoming(message: IncomingMessage): Promise<"duplicate" | IncomingMessage> {
    try {
      await this.db
        .prepare(
          `INSERT INTO incoming_messages (
            id, bot_id, update_id, chat_id, telegram_message_id, from_user_id, text, kind, raw_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          message.id,
          message.botId,
          message.updateId,
          message.chatId,
          message.telegramMessageId,
          message.fromUserId,
          message.text,
          message.kind,
          JSON.stringify(message.raw),
          message.createdAt,
        )
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return "duplicate";
      throw error;
    }
    return message;
  }

  async listIncoming(botId?: string): Promise<IncomingMessage[]> {
    const statement = botId
      ? this.db.prepare("SELECT * FROM incoming_messages WHERE bot_id = ? ORDER BY update_id ASC").bind(botId)
      : this.db.prepare("SELECT * FROM incoming_messages ORDER BY update_id ASC");
    const rows = await statement.all<IncomingRow>();
    return (rows.results ?? []).map(mapIncoming);
  }

  async getIncoming(id: string): Promise<IncomingMessage | null> {
    const row = await this.db.prepare("SELECT * FROM incoming_messages WHERE id = ?").bind(id).first<IncomingRow>();
    return row ? mapIncoming(row) : null;
  }

  async addPublishLog(entry: PublishLog): Promise<void> {
    await this.db
      .prepare("INSERT INTO publish_log (id, draft_id, method, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(entry.id, entry.draftId, entry.method, entry.ok ? 1 : 0, entry.error, entry.createdAt)
      .run();
  }

  private bindDraft(sql: string, draft: Draft): D1Prepared {
    return this.db
      .prepare(sql)
      .bind(
        draft.id,
        draft.channelId,
        draft.action,
        draft.kind,
        draft.status,
        JSON.stringify(draft.payload),
        draft.scheduledAt,
        draft.source,
        draft.sourceRef,
        draft.incomingId,
        draft.replyToTelegramMessageId,
        draft.targetMessageId,
        draft.approvedAt,
        draft.error,
        draft.createdAt,
        draft.updatedAt,
      );
  }
}

interface StatementSync {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  run(...args: unknown[]): { changes: number };
}

interface DatabaseSyncLike {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
}

export function createNodeSqliteD1(db: DatabaseSyncLike): D1Like {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      let args: unknown[] = [];
      const prepared: D1Prepared = {
        bind(...next: unknown[]) {
          args = next;
          return prepared;
        },
        async first<T>() {
          return (statement.get(...args) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...args) as T[] };
        },
        async run() {
          const info = statement.run(...args);
          return { meta: { changes: info.changes } };
        },
      };
      return prepared;
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
}
