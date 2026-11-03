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
  redirect("/?notice=" + encodeURIComponent("publisher を実行しました。未承認の下書きは送っていません。"));
}
