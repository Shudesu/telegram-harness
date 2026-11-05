import {
  approveAccountAction,
  approveDraft,
  createDraft,
  forgetUserSession,
  rejectAccountAction,
  rejectDraft,
  requestAddBotAdmin,
  requestBotFatherCreate,
  requestCreateChannel,
  requestCreateSupergroup,
  requestEditTitle,
  runPublisher,
  startUserLogin,
  submitUserCode,
  submitUserPassword,
} from "./actions";

export const dynamic = "force-dynamic";

interface DraftRow {
  id: string;
  kind: string;
  status: string;
  action: string;
  payload: { text?: string };
  source: string;
}

interface MessageRow {
  id: string;
  text: string | null;
  status: string;
  dryRun: boolean;
  telegramMessageIds: string[];
}

interface Health {
  data?: { telegramMode?: string; userAccountMode?: string; version?: string };
}

interface AccountActionRow {
  id: string;
  action: string;
  status: string;
  summary: string;
}

interface UserStatus {
  authorized?: boolean;
  mode?: string;
  selfUserId?: string | null;
  login?: { status?: string; hint?: string | null } | null;
}

interface OwnedChatRow {
  id: string;
  title: string;
  username: string | null;
  kind: string;
  role: string;
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = (await searchParams).notice;
  const base = process.env.TELEGRAM_HARNESS_API_URL;
  const key = process.env.API_KEY;
  if (!base || !key) {
    return (
      <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 20px" }}>
        <a href="/crm/customers">顧客台帳・予約管理 →</a>
          <h1>Telegram Harness</h1>
        <p>サーバー側の TELEGRAM_HARNESS_API_URL と API_KEY を設定すると、承認キューがここに出ます。</p>
      </main>
    );
  }
  const headers = { authorization: `Bearer ${key}` };
  let approvals: DraftRow[] = [];
  let accountActions: AccountActionRow[] = [];
  let messages: MessageRow[] = [];
  let chats: OwnedChatRow[] = [];
  let userStatus: UserStatus | null = null;
  let mode = "unknown";
  let userMode = "unknown";
  let loadError = "";
  try {
    const [queueRes, messageRes, healthRes, statusRes, chatRes] = await Promise.all([
      fetch(`${base}/api/approvals`, { headers, cache: "no-store" }),
      fetch(`${base}/api/messages`, { headers, cache: "no-store" }),
      fetch(`${base}/api/health`, { cache: "no-store" }),
      fetch(`${base}/api/user/status`, { headers, cache: "no-store" }),
      fetch(`${base}/api/user/chats`, { headers, cache: "no-store" }),
    ]);
    const queue = await readJson<{ data: DraftRow[]; accountActions?: AccountActionRow[] }>(queueRes);
    approvals = queue?.data ?? [];
    accountActions = queue?.accountActions ?? [];
    messages = (await readJson<{ data: MessageRow[] }>(messageRes))?.data ?? [];
    const health = await readJson<Health>(healthRes);
    mode = health?.data?.telegramMode ?? "unknown";
    userMode = health?.data?.userAccountMode ?? "unknown";
    userStatus = (await readJson<{ data: UserStatus }>(statusRes))?.data ?? null;
    chats = (await readJson<{ data: OwnedChatRow[] }>(chatRes))?.data ?? [];
  } catch (error) {
    loadError = error instanceof Error ? error.message : "load_failed";
  }

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 20px 64px" }}>
      <p style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 12 }}>Telegram Harness</p>
      <h1 style={{ fontWeight: 500, fontSize: 40, margin: "8px 0" }}>承認キュー</h1>
      <p>
        下書きを作っても、承認しても、それだけでは Telegram に届きません。公開は承認済みだけを処理する publisher
        の仕事です。Bot API は <strong>{mode}</strong>、ユーザーアカウントは <strong>{userMode}</strong> です。dry-run
        はネットワークへ接続しません。
      </p>
      {notice ? (
        <p style={{ background: "#fff", border: "1px solid #d9d2c5", padding: "12px 14px" }}>{notice}</p>
      ) : null}
      {loadError ? <p>読み込みに失敗しました: {loadError}</p> : null}

      <section style={{ marginTop: 28 }}>
        <h2>テキスト下書き</h2>
        <form action={createDraft} style={{ display: "grid", gap: 8 }}>
          <label>
            チャンネル ID
            <input name="channelId" required style={fieldStyle} />
          </label>
          <label>
            本文
            <textarea name="text" required rows={4} style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            承認待ちにする
          </button>
        </form>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>pending</h2>
        {approvals.length === 0 ? <p>承認待ちはありません。</p> : null}
        {approvals.map((draft) => (
          <article key={draft.id} style={cardStyle}>
            <p style={{ margin: 0 }}>
              {draft.action} / {draft.kind} / {draft.source}
            </p>
            <p>{draft.payload.text || "（本文なし）"}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <form action={approveDraft}>
                <input type="hidden" name="id" value={draft.id} />
                <button type="submit" style={buttonStyle}>
                  承認
                </button>
              </form>
              <form action={rejectDraft}>
                <input type="hidden" name="id" value={draft.id} />
                <button type="submit" style={{ ...buttonStyle, background: "#fff", color: "#1c1915" }}>
                  却下
                </button>
              </form>
            </div>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>ユーザーアカウントの承認待ち</h2>
        <p>作成、編集、管理者変更、BotFather はここを通ります。承認しても、publisher の前には実行しません。</p>
        {accountActions.length === 0 ? <p>アカウント操作の承認待ちはありません。</p> : null}
        {accountActions.map((action) => (
          <article key={action.id} style={cardStyle}>
            <p style={{ margin: 0 }}>
              {action.action} / {action.status}
            </p>
            <p>{action.summary}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <form action={approveAccountAction}>
                <input type="hidden" name="id" value={action.id} />
                <button type="submit" style={buttonStyle}>
                  承認
                </button>
              </form>
              <form action={rejectAccountAction}>
                <input type="hidden" name="id" value={action.id} />
                <button type="submit" style={{ ...buttonStyle, background: "#fff", color: "#1c1915" }}>
                  却下
                </button>
              </form>
            </div>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>自分のアカウント</h2>
        <p>
          状態: {userStatus?.authorized ? "ログイン済み" : "未ログイン"} / モード {userStatus?.mode ?? userMode}
          {userStatus?.selfUserId ? ` / id ${userStatus.selfUserId}` : ""}
        </p>
        {userStatus?.login?.status === "password_required" ? (
          <form action={submitUserPassword} style={{ display: "grid", gap: 8 }}>
            <label>
              2FA パスワード{userStatus.login.hint ? `（ヒント: ${userStatus.login.hint}）` : ""}
              <input name="password" type="password" required style={fieldStyle} />
            </label>
            <button type="submit" style={buttonStyle}>
              パスワードを送る
            </button>
          </form>
        ) : userStatus?.login?.status === "code_sent" ? (
          <form action={submitUserCode} style={{ display: "grid", gap: 8 }}>
            <label>
              ログインコード
              <input name="code" required style={fieldStyle} />
            </label>
            <button type="submit" style={buttonStyle}>
              コードを送る
            </button>
          </form>
        ) : (
          <form action={startUserLogin} style={{ display: "grid", gap: 8 }}>
            <label>
              電話番号
              <input name="phone" placeholder="+12025550123" required style={fieldStyle} />
            </label>
            <button type="submit" style={buttonStyle}>
              コードを送ってもらう
            </button>
          </form>
        )}
        <form action={forgetUserSession} style={{ marginTop: 8 }}>
          <button type="submit" style={{ ...buttonStyle, background: "#fff", color: "#1c1915" }}>
            ローカルセッションを捨てる
          </button>
        </form>
        <h3>チャンネルとグループ</h3>
        {chats.length === 0 ? <p>一覧はログイン後に出ます。メンバー名簿は取りません。</p> : null}
        {chats.map((chat) => (
          <p key={chat.id}>
            {chat.title} / {chat.kind} / {chat.role}
            {chat.username ? ` / @${chat.username}` : ""} / {chat.id}
          </p>
        ))}
        <form action={requestCreateChannel} style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label>
            チャンネル名
            <input name="title" required style={fieldStyle} />
          </label>
          <label>
            説明
            <input name="about" style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            チャンネル作成を承認待ちにする
          </button>
        </form>
        <form action={requestCreateSupergroup} style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label>
            スーパーグループ名
            <input name="title" required style={fieldStyle} />
          </label>
          <label>
            説明
            <input name="about" style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            スーパーグループ作成を承認待ちにする
          </button>
        </form>
        <form action={requestEditTitle} style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label>
            チャンネル ID
            <input name="ownedChatId" required style={fieldStyle} />
          </label>
          <label>
            新しいタイトル
            <input name="title" required style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            タイトル変更を承認待ちにする
          </button>
        </form>
        <form action={requestAddBotAdmin} style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label>
            チャンネル ID
            <input name="ownedChatId" required style={fieldStyle} />
          </label>
          <label>
            登録済みボット ID
            <input name="botId" required style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            ボットを管理者にする操作を承認待ちにする
          </button>
        </form>
        <form action={requestBotFatherCreate} style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label>
            表示名
            <input name="displayName" required style={fieldStyle} />
          </label>
          <label>
            ユーザー名（bot で終わる）
            <input name="username" required style={fieldStyle} />
          </label>
          <label>
            トークンを入れる環境変数名
            <input name="tokenEnvName" placeholder="TELEGRAM_BOT_TOKEN_MAIN" required style={fieldStyle} />
          </label>
          <button type="submit" style={buttonStyle}>
            BotFather 作成を承認待ちにする
          </button>
        </form>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>承認済みの公開</h2>
        <form action={runPublisher}>
          <button type="submit" style={buttonStyle}>
            承認済みだけ公開する
          </button>
        </form>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>記録</h2>
        {messages.length === 0 ? <p>まだ記録はありません。</p> : null}
        {messages.map((message) => (
          <article key={message.id} style={cardStyle}>
            <p style={{ margin: 0 }}>
              {message.status}
              {message.dryRun ? " / dry-run（実送信なし）" : ""} / ids {message.telegramMessageIds.join(", ")}
            </p>
            <p>{message.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

const fieldStyle = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: 8,
  border: "1px solid #cfc6b8",
  background: "#fff",
  font: "inherit",
};

const buttonStyle = {
  background: "#1c1915",
  color: "#f4f1ea",
  border: "1px solid #1c1915",
  padding: "8px 14px",
  font: "inherit",
  cursor: "pointer",
};

const cardStyle = {
  background: "#fff",
  border: "1px solid #e2dacd",
  padding: 12,
  marginBottom: 10,
};
