import { BOT_METHODS, BOT_SCHEMAS, BOT_TYPES, USER_OPERATIONS, publicSchema, TelegramHarnessClient } from "@telegram-harness/sdk";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    oneOf?: Record<string, unknown>[];
    $defs?: Record<string, unknown>;
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
  { name: "list_api_operations", description: "Bot API とオーナーアカウントの操作一覧、読み書き区分、除外理由。操作ごとの型は get_api_operation で取得。", inputSchema: { type: "object", properties: {} } },
  { name: "get_api_operation", description: "指定操作の JSON Schema と読み書き区分を取得する。", inputSchema: { type: "object", properties: { provider: { type: "string", enum: ["bot", "user"] }, name: { type: "string" } }, required: ["provider", "name"] } },
  ...(["bot", "user"] as const).flatMap((provider) => (["read", "write"] as const).map((mode): ToolDef => ({
    name: `${mode === "write" ? "request" : "read"}_${provider}_api`,
    description: mode === "write" ? "指定操作を pending で保存。実行には approve_account_action と run_publisher が別々に必要。params の型は get_api_operation で確認。" : "許可された読み取り操作を実行。書き込み操作は拒否。params の型は get_api_operation で確認。",
    inputSchema: {
      type: "object",
      properties: {
        ...(provider === "bot" ? { botId: { type: "string" }, method: { type: "string", enum: Object.entries(BOT_METHODS).filter(([,v]) => v.mode === mode).map(([k]) => k) } } : { operation: { type: "string", enum: Object.entries(USER_OPERATIONS).filter(([,v]) => v.mode === mode).map(([k]) => k) } }),
        params: { type: "object", description: "get_api_operation の schema に準拠する引数。秘密は secretEnvName で参照。" },
        ...(mode === "write" ? { scheduledAt: { type: "string", description: "Harness publisher の実行予定 UTC ISO-8601" } } : {}),
      },
      required: provider === "bot" ? ["botId", "method", "params"] : ["operation", "params"],
      additionalProperties: false,
      ...operationVariants(provider, mode),
    },
  }))),
  { name: "cancel_account_action", description: "publisher が取得する前の scheduled 操作を pending に戻す。", inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] } },
  { name: "get_account_action", description: "操作の全引数、状態、実行結果を確認する。承認前にこの内容を確認。", inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] } },
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
  {
    name: "user_login_start",
    description: "所有者の電話番号へログインコードを送る。セッショントークンは返さない。チャンネル操作はしない。",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "E.164, for example +12025550123" },
        replace: { type: "boolean", description: "Replace the single stored session. Does not create another account." },
      },
      required: ["phone"],
    },
  },
  {
    name: "user_login_code",
    description: "ログインコードを確定する。パスワードが必要なら password_required を返す。セッション文字列は返さない。",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "user_login_password",
    description: "2FA パスワードでログインを終える。パスワードもセッション文字列もレスポンスに含めない。",
    inputSchema: { type: "object", properties: { password: { type: "string" } }, required: ["password"] },
  },
  {
    name: "user_session_status",
    description: "ユーザーセッションの有無とログイン途中の状態。秘密の値は含めない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "user_session_forget",
    description: "ローカルの暗号化セッションを捨てる。Telegram 側のログアウトはしない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_own_chats",
    description: "ログイン中のアカウントが作成者または管理者のチャンネルとグループだけを読む。メンバー一覧は取らない。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_own_channel_stats",
    description: "自分のチャンネルの閲覧数と、取れる範囲の統計を読む。increment はしない。書き込まない。",
    inputSchema: {
      type: "object",
      properties: {
        ownedChatId: { type: "string" },
        messageIds: { type: "string", description: "Comma-separated message ids, at most 20." },
      },
      required: ["ownedChatId"],
    },
  },
  {
    name: "request_create_channel",
    description: "チャンネル作成を承認待ちにする。このツールは作成しない。実行は approve_account_action と run_publisher。",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, about: { type: "string" }, scheduledAt: { type: "string" } },
      required: ["title"],
    },
  },
  {
    name: "request_create_supergroup",
    description: "スーパーグループ作成を承認待ちにする。このツールは作成しない。",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, about: { type: "string" }, scheduledAt: { type: "string" } },
      required: ["title"],
    },
  },
  {
    name: "request_edit_channel_title",
    description: "自分のチャンネルのタイトル変更を承認待ちにする。まだ変更しない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, title: { type: "string" } },
      required: ["ownedChatId", "title"],
    },
  },
  {
    name: "request_edit_channel_description",
    description: "自分のチャンネルの説明変更を承認待ちにする。まだ変更しない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, description: { type: "string" } },
      required: ["ownedChatId"],
    },
  },
  {
    name: "request_edit_channel_photo",
    description: "自分のチャンネルの写真変更を承認待ちにする。https の URL のみ。まだ変更しない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, photoUrl: { type: "string" } },
      required: ["ownedChatId", "photoUrl"],
    },
  },
  {
    name: "request_edit_channel_username",
    description: "自分のチャンネルのユーザー名変更を承認待ちにする。まだ変更しない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, username: { type: "string" } },
      required: ["ownedChatId", "username"],
    },
  },
  {
    name: "request_add_channel_admin",
    description: "管理者追加を承認待ちにする。対象は登録済みボットの botId か、公開ユーザー名ひとつ。一括招待はできない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, botId: { type: "string" }, username: { type: "string" } },
      required: ["ownedChatId"],
    },
  },
  {
    name: "request_remove_channel_admin",
    description: "管理者を外す操作を承認待ちにする。ユーザー名ひとつだけ。まだ外さない。",
    inputSchema: {
      type: "object",
      properties: { ownedChatId: { type: "string" }, username: { type: "string" } },
      required: ["ownedChatId", "username"],
    },
  },
  {
    name: "request_botfather_create_bot",
    description: "BotFather でのボット作成を承認待ちにする。トークン値は渡さない。tokenEnvName は保存先の環境変数名。",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string" },
        username: { type: "string" },
        tokenEnvName: { type: "string" },
      },
      required: ["displayName", "username", "tokenEnvName"],
    },
  },
  {
    name: "request_botfather_set_name",
    description: "BotFather の名前変更を承認待ちにする。まだ送らない。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, name: { type: "string" } },
      required: ["username", "name"],
    },
  },
  {
    name: "request_botfather_set_description",
    description: "BotFather の description 変更を承認待ちにする。まだ送らない。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, text: { type: "string" } },
      required: ["username", "text"],
    },
  },
  {
    name: "request_botfather_set_about",
    description: "BotFather の about 変更を承認待ちにする。まだ送らない。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, text: { type: "string" } },
      required: ["username", "text"],
    },
  },
  {
    name: "request_botfather_set_commands",
    description: "BotFather のコマンド変更を承認待ちにする。まだ送らない。",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string" },
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: { command: { type: "string" }, description: { type: "string" } },
            required: ["command", "description"],
          },
        },
      },
      required: ["username", "commands"],
    },
  },
  {
    name: "request_botfather_set_photo",
    description: "BotFather のプロフィール写真変更を承認待ちにする。https の URL のみ。まだ送らない。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, photoUrl: { type: "string" } },
      required: ["username", "photoUrl"],
    },
  },
  {
    name: "request_botfather_fetch_token",
    description: "BotFather からのトークン取得を承認待ちにする。トークン値は環境変数名の先にだけ保存する。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, tokenEnvName: { type: "string" } },
      required: ["username", "tokenEnvName"],
    },
  },
  {
    name: "request_botfather_revoke_token",
    description: "BotFather でのトークン再発行を承認待ちにする。新しい値は環境変数名の先にだけ保存する。",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, tokenEnvName: { type: "string" } },
      required: ["username", "tokenEnvName"],
    },
  },
  {
    name: "approve_account_action",
    description: "承認待ちのユーザーアカウント操作を scheduled にする。GramJS も Bot API も呼ばない。",
    inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] },
  },
  {
    name: "reject_account_action",
    description: "承認待ちのユーザーアカウント操作を却下する。Telegram には送らない。",
    inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] },
  },
  {
    name: "requeue_account_action",
    description: "失敗したユーザーアカウント操作を承認待ちに戻す。再実行には新しい承認が必要。",
    inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] },
  },
  {
    name: "list_account_actions",
    description: "ユーザーアカウント操作の一覧。status は pending, scheduled, publishing, posted, rejected, failed。",
    inputSchema: { type: "object", properties: { status: { type: "string" } } },
  },
];

/** Method-specific params are part of the actual MCP schema, not just prose. */
function operationVariants(provider: "bot" | "user", mode: "read" | "write") {
  const definitions: Record<string, unknown> = {};
  const entries = provider === "bot"
    ? Object.entries(BOT_METHODS).filter(([,entry]) => entry.mode === mode).map(([name]) => [name, publicSchema(BOT_SCHEMAS[name as keyof typeof BOT_SCHEMAS], BOT_TYPES)] as const)
    : Object.entries(USER_OPERATIONS).filter(([,entry]) => entry.mode === mode).map(([name,entry]) => [name, publicSchema(entry.schema)] as const);
  const oneOf = entries.map(([name, schema]) => {
    const { $defs, ...params } = schema;
    Object.assign(definitions, $defs);
    return { properties: { [provider === "bot" ? "method" : "operation"]: { const: name }, params } };
  });
  return { oneOf, ...(Object.keys(definitions).length ? { $defs: definitions } : {}) };
}

type Args = Record<string, unknown>;

export async function executeTool(client: TelegramHarnessClient, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "list_api_operations": return client.get("/api/operations");
    case "get_api_operation": return client.get(`/api/operations${query({ provider: args.provider, name: args.name })}`);
    case "read_bot_api": return client.post("/api/bot/read", args);
    case "request_bot_api": return client.post("/api/bot/requests", args);
    case "read_user_api": return client.post("/api/user/read", args);
    case "request_user_api": return client.post("/api/user/requests", args);
    case "cancel_account_action": return client.post(`/api/account/actions/${encodeURIComponent(String(args.actionId))}/cancel`, {});
    case "get_account_action": return client.get(`/api/account/actions/${encodeURIComponent(String(args.actionId))}`);
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
    case "user_login_start":
      return client.post("/api/user/login/start", { phone: args.phone, replace: args.replace });
    case "user_login_code":
      return client.post("/api/user/login/code", { code: args.code });
    case "user_login_password":
      return client.post("/api/user/login/password", { password: args.password });
    case "user_session_status":
      return client.get("/api/user/status");
    case "user_session_forget":
      return client.post("/api/user/session/forget", {});
    case "list_own_chats":
      return client.get("/api/user/chats");
    case "get_own_channel_stats":
      return client.get(
        `/api/user/chats/${encodeURIComponent(String(args.ownedChatId))}/stats${query({ messageIds: args.messageIds })}`,
      );
    case "request_create_channel":
      return client.post("/api/account/actions", { action: "create_channel", title: args.title, about: args.about, scheduledAt: args.scheduledAt });
    case "request_create_supergroup":
      return client.post("/api/account/actions", { action: "create_supergroup", title: args.title, about: args.about, scheduledAt: args.scheduledAt });
    case "request_edit_channel_title":
      return client.post("/api/account/actions", { action: "edit_title", ownedChatId: args.ownedChatId, title: args.title });
    case "request_edit_channel_description":
      return client.post("/api/account/actions", { action: "edit_description", ownedChatId: args.ownedChatId, description: args.description });
    case "request_edit_channel_photo":
      return client.post("/api/account/actions", { action: "edit_photo", ownedChatId: args.ownedChatId, photoUrl: args.photoUrl });
    case "request_edit_channel_username":
      return client.post("/api/account/actions", { action: "edit_username", ownedChatId: args.ownedChatId, username: args.username });
    case "request_add_channel_admin":
      return client.post("/api/account/actions", { action: "add_admin", ownedChatId: args.ownedChatId, botId: args.botId, username: args.username });
    case "request_remove_channel_admin":
      return client.post("/api/account/actions", { action: "remove_admin", ownedChatId: args.ownedChatId, username: args.username });
    case "request_botfather_create_bot":
      return client.post("/api/account/actions", {
        action: "botfather_create_bot",
        displayName: args.displayName,
        username: args.username,
        tokenEnvName: args.tokenEnvName,
      });
    case "request_botfather_set_name":
      return client.post("/api/account/actions", { action: "botfather_set_name", username: args.username, name: args.name });
    case "request_botfather_set_description":
      return client.post("/api/account/actions", { action: "botfather_set_description", username: args.username, text: args.text });
    case "request_botfather_set_about":
      return client.post("/api/account/actions", { action: "botfather_set_about", username: args.username, text: args.text });
    case "request_botfather_set_commands":
      return client.post("/api/account/actions", { action: "botfather_set_commands", username: args.username, commands: args.commands });
    case "request_botfather_set_photo":
      return client.post("/api/account/actions", { action: "botfather_set_photo", username: args.username, photoUrl: args.photoUrl });
    case "request_botfather_fetch_token":
      return client.post("/api/account/actions", { action: "botfather_fetch_token", username: args.username, tokenEnvName: args.tokenEnvName });
    case "request_botfather_revoke_token":
      return client.post("/api/account/actions", { action: "botfather_revoke_token", username: args.username, tokenEnvName: args.tokenEnvName });
    case "approve_account_action":
      return client.post(`/api/account/actions/${encodeURIComponent(String(args.actionId))}/approve`, {});
    case "reject_account_action":
      return client.post(`/api/account/actions/${encodeURIComponent(String(args.actionId))}/reject`, {});
    case "requeue_account_action":
      return client.post(`/api/account/actions/${encodeURIComponent(String(args.actionId))}/requeue`, {});
    case "list_account_actions":
      return client.get(`/api/account/actions${query({ status: args.status })}`);
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
