"use server";

import { redirect } from "next/navigation";

function api(): { base: string; key: string } {
  const base = process.env.TELEGRAM_HARNESS_API_URL;
  const key = process.env.API_KEY;
  if (!base || !key) throw new Error("missing_server_env");
  return { base, key };
}

async function post(path: string, body?: unknown): Promise<void> {
  const { base, key } = api();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? "{}" : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    redirect(`/?notice=${encodeURIComponent(text.slice(0, 180))}`);
  }
}

export async function createDraft(formData: FormData): Promise<void> {
  await post("/api/drafts", {
    channelId: String(formData.get("channelId") ?? ""),
    kind: "text",
    text: String(formData.get("text") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("下書きを承認待ちにしました。まだ送信していません。"));
}

export async function approveDraft(formData: FormData): Promise<void> {
  await post(`/api/drafts/${String(formData.get("id") ?? "")}/approve`);
  redirect("/?notice=" + encodeURIComponent("承認しました。Telegram へは publisher が承認済みだけを送ります。"));
}

export async function rejectDraft(formData: FormData): Promise<void> {
  await post(`/api/drafts/${String(formData.get("id") ?? "")}/reject`);
  redirect("/?notice=" + encodeURIComponent("却下しました。"));
}

export async function runPublisher(formData: FormData): Promise<void> {
  void formData;
  await post("/api/publisher/run");
  redirect("/?notice=" + encodeURIComponent("publisher を実行しました。未承認の下書きとアカウント操作は送っていません。"));
}

export async function startUserLogin(formData: FormData): Promise<void> {
  await post("/api/user/login/start", { phone: String(formData.get("phone") ?? "") });
  redirect("/?notice=" + encodeURIComponent("ログインコードを送りました。セッションは保存していません。"));
}

export async function submitUserCode(formData: FormData): Promise<void> {
  await post("/api/user/login/code", { code: String(formData.get("code") ?? "") });
  redirect("/?notice=" + encodeURIComponent("コードを受け付けました。セッション文字列は表示しません。"));
}

export async function submitUserPassword(formData: FormData): Promise<void> {
  await post("/api/user/login/password", { password: String(formData.get("password") ?? "") });
  redirect("/?notice=" + encodeURIComponent("ログインを確定しました。パスワードは保存していません。"));
}

export async function forgetUserSession(formData: FormData): Promise<void> {
  void formData;
  await post("/api/user/session/forget");
  redirect("/?notice=" + encodeURIComponent("このプロセスのセッションを捨てました。Telegram 側はログアウトしていません。"));
}

export async function requestCreateChannel(formData: FormData): Promise<void> {
  await post("/api/account/actions", {
    action: "create_channel",
    title: String(formData.get("title") ?? ""),
    about: String(formData.get("about") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("チャンネル作成を承認待ちにしました。まだ作成していません。"));
}

export async function requestCreateSupergroup(formData: FormData): Promise<void> {
  await post("/api/account/actions", {
    action: "create_supergroup",
    title: String(formData.get("title") ?? ""),
    about: String(formData.get("about") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("スーパーグループ作成を承認待ちにしました。まだ作成していません。"));
}

export async function requestEditTitle(formData: FormData): Promise<void> {
  await post("/api/account/actions", {
    action: "edit_title",
    ownedChatId: String(formData.get("ownedChatId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("タイトル変更を承認待ちにしました。"));
}

export async function requestAddBotAdmin(formData: FormData): Promise<void> {
  await post("/api/account/actions", {
    action: "add_admin",
    ownedChatId: String(formData.get("ownedChatId") ?? ""),
    botId: String(formData.get("botId") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("ボットの管理者追加を承認待ちにしました。"));
}

export async function requestBotFatherCreate(formData: FormData): Promise<void> {
  await post("/api/account/actions", {
    action: "botfather_create_bot",
    displayName: String(formData.get("displayName") ?? ""),
    username: String(formData.get("username") ?? ""),
    tokenEnvName: String(formData.get("tokenEnvName") ?? ""),
  });
  redirect("/?notice=" + encodeURIComponent("BotFather での作成を承認待ちにしました。トークンはまだありません。"));
}

export async function approveAccountAction(formData: FormData): Promise<void> {
  await post(`/api/account/actions/${String(formData.get("id") ?? "")}/approve`);
  redirect("/?notice=" + encodeURIComponent("承認しました。GramJS へは publisher が承認済みだけを実行します。"));
}

export async function rejectAccountAction(formData: FormData): Promise<void> {
  await post(`/api/account/actions/${String(formData.get("id") ?? "")}/reject`);
  redirect("/?notice=" + encodeURIComponent("アカウント操作を却下しました。"));
}
