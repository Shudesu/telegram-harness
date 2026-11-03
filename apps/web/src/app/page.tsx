import { approveDraft, createDraft, rejectDraft, runPublisher } from "./actions";

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
  data?: { telegramMode?: string; version?: string };
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
        <h1>Telegram Harness</h1>
        <p>サーバー側の TELEGRAM_HARNESS_API_URL と API_KEY を設定すると、承認キューがここに出ます。</p>
      </main>
    );
  }
  const headers = { authorization: `Bearer ${key}` };
  let approvals: DraftRow[] = [];
  let messages: MessageRow[] = [];
  let mode = "unknown";
  let loadError = "";
  try {
    const [queueRes, messageRes, healthRes] = await Promise.all([
      fetch(`${base}/api/approvals`, { headers, cache: "no-store" }),
      fetch(`${base}/api/messages`, { headers, cache: "no-store" }),
      fetch(`${base}/api/health`, { cache: "no-store" }),
    ]);
    approvals = (await readJson<{ data: DraftRow[] }>(queueRes))?.data ?? [];
    messages = (await readJson<{ data: MessageRow[] }>(messageRes))?.data ?? [];
    mode = (await readJson<Health>(healthRes))?.data?.telegramMode ?? "unknown";
  } catch (error) {
    loadError = error instanceof Error ? error.message : "load_failed";
  }

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 20px 64px" }}>
      <p style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 12 }}>Telegram Harness</p>
      <h1 style={{ fontWeight: 500, fontSize: 40, margin: "8px 0" }}>承認キュー</h1>
      <p>
        下書きを作っても、承認しても、それだけでは Telegram に届きません。公開は承認済みだけを処理する publisher
        の仕事です。いまの接続モードは <strong>{mode}</strong> です。dry-run は Bot API を呼びません。
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
