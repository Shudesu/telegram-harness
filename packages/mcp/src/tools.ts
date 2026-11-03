import { TelegramHarnessClient } from "@telegram-harness/sdk";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const channelProps = {
  botId: { type: "string" },
  chatId: { type: "string", description: "Telegram chat id or @username" },
  title: { type: "string" },
  kind: { type: "string", enum: ["channel", "group", "supergroup"] },
};

const contentProps = {
  channelId: { type: "string" },
  kind: { type: "string", enum: ["text", "photo", "video", "album"] },
  text: { type: "string" },
  media: {
    type: "array",
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["photo", "video"] },
        url: { type: "string" },
      },
      required: ["type", "url"],
    },
  },
  buttons: {
    type: "array",
    description: "Inline buttons. Albums cannot carry buttons: sendMediaGroup has no reply_markup.",
    items: {
      type: "object",
      properties: {
        text: { type: "string" },
        url: { type: "string" },
        callbackData: { type: "string" },
      },
      required: ["text"],
    },
  },
  parseMode: { type: "string", enum: ["HTML", "MarkdownV2"] },
  scheduledAt: { type: "string", description: "UTC ISO-8601. Stored on the draft; approve still does not send." },
};

export const toolDefs: ToolDef[] = [
  {
    name: "register_bot",
    description: "ボットを登録する。tokenEnvName は環境変数名で、トークン値は渡さない。Telegram には送らない。",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, tokenEnvName: { type: "string" } },
      required: ["name", "tokenEnvName"],
    },
  },
  {
    name: "list_bots",
    description: "登録済みボット一覧。トークン値は含まれない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "register_channel",
    description: "ボットにチャンネルまたはグループを登録する。投稿はしない。",
    inputSchema: { type: "object", properties: channelProps, required: ["botId", "chatId", "title", "kind"] },
  },
  {
    name: "list_channels",
    description: "登録済みチャンネル一覧。",
    inputSchema: { type: "object", properties: { botId: { type: "string" } } },
  },
  {
    name: "create_draft",
    description: "投稿下書きを承認待ちで作る。このツールは送信しない。公開には approve_draft と run_publisher が別々に必要。",
    inputSchema: {
      type: "object",
      properties: contentProps,
      required: ["channelId", "kind"],
    },
  },
  {
    name: "list_drafts",
    description: "下書き一覧。status は pending, scheduled, publishing, posted, rejected, failed。",
    inputSchema: { type: "object", properties: { status: { type: "string" }, channelId: { type: "string" } } },
  },
  {
    name: "get_draft",
    description: "下書きを1件取得する。",
    inputSchema: { type: "object", properties: { draftId: { type: "string" } }, required: ["draftId"] },
  },
  {
    name: "list_approvals",
    description: "承認待ちキュー。pending の下書きだけを返す。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "approve_draft",
    description: "承認待ち下書きを scheduled にする。X Harness の approve と同じで、ここでは Telegram に送らない。",
    inputSchema: { type: "object", properties: { draftId: { type: "string" } }, required: ["draftId"] },
  },
  {
    name: "reject_draft",
    description: "承認待ち下書きを却下する。送信しない。",
    inputSchema: { type: "object", properties: { draftId: { type: "string" } }, required: ["draftId"] },
  },
  {
    name: "schedule_draft",
    description: "承認前の下書きに投稿予定時刻を入れる。承認も送信もしない。",
    inputSchema: {
      type: "object",
      properties: { draftId: { type: "string" }, scheduledAt: { type: "string" } },
      required: ["draftId", "scheduledAt"],
    },
  },
  {
    name: "run_publisher",
    description: "すでに承認済み（scheduled で時刻到来）の下書きだけを Bot API に送る。未承認は送らない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_messages",
    description: "送信済みメッセージのローカル記録。",
    inputSchema: { type: "object", properties: { channelId: { type: "string" } } },
  },
  {
    name: "request_message_edit",
    description: "公開済みメッセージの編集を承認待ち下書きにする。approve_draft までは編集しない。",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        text: { type: "string" },
        buttons: contentProps.buttons,
        parseMode: contentProps.parseMode,
      },
      required: ["messageId"],
    },
  },
  {
    name: "request_message_delete",
    description: "公開済みメッセージの削除を承認待ち下書きにする。approve_draft までは削除しない。",
    inputSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] },
  },
  {
    name: "get_channel_stats",
    description: "getChatMemberCount と getChat を読む。閲覧数は Bot API では取得しない。",
    inputSchema: { type: "object", properties: { channelId: { type: "string" } }, required: ["channelId"] },
  },
  {
    name: "list_incoming",
    description: "Webhook で保存した受信メッセージとコメント。",
    inputSchema: { type: "object", properties: { botId: { type: "string" } } },
  },
  {
    name: "create_reply_draft",
    description: "受信メッセージへの返信下書きを承認待ちで作る。送信は approve_draft と run_publisher の後。",
    inputSchema: {
      type: "object",
      properties: {
        incomingId: { type: "string" },
        kind: contentProps.kind,
        text: contentProps.text,
        media: contentProps.media,
        buttons: contentProps.buttons,
        parseMode: contentProps.parseMode,
        scheduledAt: contentProps.scheduledAt,
      },
      required: ["incomingId", "kind"],
    },
  },
  {
    name: "intake_draft",
    description: "他の SNS 下書きをクロスポストの承認待ちとして取り込む。送信しない。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        sourceRef: { type: "string" },
        ...contentProps,
      },
      required: ["source", "sourceRef", "channelId", "kind"],
    },
  },
];

type Args = Record<string, unknown>;

export async function executeTool(client: TelegramHarnessClient, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "register_bot":
      return client.post("/api/bots", { name: args.name, tokenEnvName: args.tokenEnvName });
    case "list_bots":
      return client.get("/api/bots");
    case "register_channel":
      return client.post("/api/channels", args);
    case "list_channels":
      return client.get(`/api/channels${query({ botId: args.botId })}`);
    case "create_draft":
      return client.post("/api/drafts", args);
    case "list_drafts":
      return client.get(`/api/drafts${query({ status: args.status, channelId: args.channelId })}`);
    case "get_draft":
      return client.get(`/api/drafts/${encodeURIComponent(String(args.draftId))}`);
    case "list_approvals":
      return client.get("/api/approvals");
    case "approve_draft":
      return client.post(`/api/drafts/${encodeURIComponent(String(args.draftId))}/approve`, {});
    case "reject_draft":
      return client.post(`/api/drafts/${encodeURIComponent(String(args.draftId))}/reject`, {});
    case "schedule_draft":
      return client.post(`/api/drafts/${encodeURIComponent(String(args.draftId))}/schedule`, {
        scheduledAt: args.scheduledAt,
      });
    case "run_publisher":
      return client.post("/api/publisher/run", {});
    case "list_messages":
      return client.get(`/api/messages${query({ channelId: args.channelId })}`);
    case "request_message_edit":
      return client.post(`/api/messages/${encodeURIComponent(String(args.messageId))}/edits`, {
        text: args.text,
        buttons: args.buttons,
        parseMode: args.parseMode,
      });
    case "request_message_delete":
      return client.post(`/api/messages/${encodeURIComponent(String(args.messageId))}/deletes`, {});
    case "get_channel_stats":
      return client.get(`/api/channels/${encodeURIComponent(String(args.channelId))}/stats`);
    case "list_incoming":
      return client.get(`/api/incoming${query({ botId: args.botId })}`);
    case "create_reply_draft":
      return client.post(`/api/incoming/${encodeURIComponent(String(args.incomingId))}/replies`, {
        kind: args.kind,
        text: args.text,
        media: args.media,
        buttons: args.buttons,
        parseMode: args.parseMode,
        scheduledAt: args.scheduledAt,
      });
    case "intake_draft":
      return client.post("/api/intake/drafts", args);
    default:
      throw new Error(`unknown_tool:${name}`);
  }
}

function query(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
