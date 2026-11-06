import { CrmRepo } from "@telegram-harness/db/crm";
import type { D1Like } from "@telegram-harness/db";
import { digest, equal, escapeHtml as e, issueSession, sign, tunnelUrl, validSession } from "./security.js";
import { login, page } from "./view.js";
export interface Env {
  DB: D1Like;
  ROUTING: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
  LOGIN_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> };
  LOGIN_HASH: string; SESSION_KEY: string; BRIDGE_KEY: string;
}
interface Snapshot {
  source: "live-mtproto"; checkedAt: string; readOnly: true; scope: string;
  account: { id: string; name: string; username: string | null };
  chats: Array<{ telegramId: string; title: string; username: string | null; kind: string; role: string }>;
}
const headers = { "cache-control": "no-store, private", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "strict-transport-security": "max-age=31536000" };
function html(value: string, status = 200, extra = {}) { return new Response(value, { status, headers: { ...headers, "content-type": "text/html;charset=utf-8", ...extra } }); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...headers, "content-type": "application/json" } }); }
const denied = () => json({ success: false, error: "read_only_demo" }, 403);
async function snapshot(env: Env): Promise<Snapshot> {
  const base = await env.ROUTING.get("bridge");
  if (!base || !tunnelUrl(base)) throw new Error("bridge_offline");
  const stamp = String(Date.now()), nonce = crypto.randomUUID();
  const signature = await sign(env.BRIDGE_KEY, `GET\n/snapshot\n${stamp}\n${nonce}`);
  const response = await fetch(`${base}/snapshot`, { headers: { "x-demo-time": stamp, "x-demo-nonce": nonce, "x-demo-signature": signature }, redirect: "manual", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`bridge_http_${response.status}`);
  const value = await response.json() as Snapshot;
  if (value.source !== "live-mtproto" || value.readOnly !== true || !Array.isArray(value.chats) || !Number.isFinite(Date.parse(value.checkedAt)) || Math.abs(Date.now() - Date.parse(value.checkedAt)) > 90000) throw new Error("stale_or_invalid_snapshot");
  return value;
}
async function readApi(path: string, env: Env): Promise<unknown> {
  const crm = new CrmRepo(env.DB);
  if (path === "/api/health") return { readOnly: true, telegram: "live-via-authenticated-bridge", crm: "isolated-empty-d1" };
  if (path === "/api/account") return snapshot(env);
  if (path === "/api/chats") { const s = await snapshot(env); return { source: s.source, checkedAt: s.checkedAt, scope: s.scope, chats: s.chats }; }
  if (path === "/api/crm/customers") return { source: "isolated-demo-d1", data: await crm.listCustomers() };
  if (path === "/api/crm/bookings") return { source: "isolated-demo-d1", data: await crm.listBookings(), slots: await crm.listSlots() };
  return undefined;
}
const tools = [
  { name: "demo_account_read", description: "Read live MTProto identity and owned/admin channel metadata; no messages", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "demo_customers_read", description: "Read isolated demo CRM; contains no Telegram imports", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
];
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/internal/bridge" && request.method === "POST") {
    if (!env.BRIDGE_KEY || !equal(request.headers.get("authorization") ?? "", `Bearer ${env.BRIDGE_KEY}`)) return json({ error: "Unauthorized" }, 401);
    const body = await request.text(); if (body.length > 256 || !tunnelUrl(body)) return json({ error: "invalid_origin" }, 400);
    await env.ROUTING.put("bridge", body, { expirationTtl: 900 }); return json({ success: true });
  }
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return denied();
  if (path === "/login" && request.method === "GET") return html(login());
  if (path === "/login" && request.method === "POST") {
    if (!env.LOGIN_HASH || !env.SESSION_KEY) return html(login("サインインの設定が未完了です。"), 503);
    if (!(await env.LOGIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })).success) return html(login("しばらく待ってから再試行してください。"), 429);
    const body = await request.text(); if (body.length > 1024) return html(login("入力を確認してください。"), 400);
    const code = new URLSearchParams(body).get("code") ?? "";
    if (!equal(await digest(code), env.LOGIN_HASH)) return html(login("ログインコードを確認してください。"), 401);
    return html("", 303, { location: "/", "set-cookie": `__Host-demo=${await issueSession(env.SESSION_KEY)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
  }
  const cookie = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith("__Host-demo="))?.slice(12) ?? "";
  if (!env.SESSION_KEY || !await validSession(env.SESSION_KEY, cookie)) {
    if (path.startsWith("/api/") || path.startsWith("/mcp") || path.startsWith("/internal/") || !["GET", "HEAD"].includes(request.method)) return json({ error: "Unauthorized" }, 401);
    return html(login(), 401);
  }
  if (path === "/logout" && request.method === "POST") return html("", 303, { location: "/login", "set-cookie": "__Host-demo=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  if (path === "/mcp" && request.method === "POST") {
    const body = await request.text(); if (body.length > 4096) return denied();
    const rpc = JSON.parse(body) as { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (rpc.jsonrpc !== "2.0") return json({ error: "invalid_jsonrpc" }, 400);
    let result: unknown;
    if (rpc.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "telegram-harness-readonly-demo", version: "1.0.0" } };
    else if (rpc.method === "notifications/initialized") return new Response(null, { status: 202, headers });
    else if (rpc.method === "tools/list") result = { tools };
    else if (rpc.method === "tools/call" && ["demo_account_read", "demo_customers_read"].includes(rpc.params?.name ?? "") && Object.keys(rpc.params?.arguments ?? {}).length === 0) result = { content: [{ type: "text", text: JSON.stringify(await readApi(rpc.params?.name === "demo_account_read" ? "/api/account" : "/api/crm/customers", env)) }] };
    else return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: "Method not allowed in read-only demo" } }, 403);
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  }
  if (request.method !== "GET") return denied();
  if (path.startsWith("/api/")) {
    const data = await readApi(path, env); return data === undefined ? denied() : json({ success: true, data });
  }
  let title = "読み取り専用デモ", body = "";
  if (path === "/") body = `<p class="notice">Telegram 実アカウントは読み取り専用。CRM は空の隔離データベースです。</p><div class="grid"><section class="card"><span class="badge">LIVE · MTProto</span><h2>アカウントとチャンネル</h2><p>既存セッションから、その場で本人情報と管理対象一覧を確認します。</p><a href="/account">接続状態を確認 →</a></section><section class="card"><span class="badge">ISOLATED · CRM</span><h2>顧客台帳・予約</h2><p>本番データの取り込みなし。空の台帳と予約枠を確認できます。</p><a href="/crm/customers">顧客台帳を開く →</a></section></div><section class="card"><h2>このデモの範囲</h2><ul><li>個人チャットの本文・履歴は表示・保存しません。</li><li>送信・投稿・招待・Bot設定・予約変更はすべて停止しています。</li><li>Mac の接続停止時は未接続と表示します。</li></ul></section>`;
  else if (path === "/account" || path === "/chats") {
    title = path === "/account" ? "アカウント接続" : "チャット・チャンネル";
    try {
      const s = await snapshot(env);
      body = `<section class="card"><span class="badge">実接続確認済み · MTProto</span><h2>${e(s.account.name)}</h2><p>${e(s.account.username ? "@" + s.account.username : "本人アカウント")} · ID ${e(s.account.id)}</p><p>確認時刻：${e(s.checkedAt)}<br>読み取り結果を最大30秒再利用します。</p><a href="${path}">状態を再確認</a></section><p class="notice">先頭100ダイアログ内の所有者・管理者のグループ／チャンネルのみ。個人チャット本文は表示・保存しません。履歴は同期しません。</p><section class="card"><h2>管理対象 ${s.chats.length}件</h2>${s.chats.length ? s.chats.map(c => `<article><h3>${e(c.title)}</h3><p>${e(c.kind)} · ${e(c.role)} ${e(c.username ? "· @"+c.username : "")}</p></article>`).join("") : "<p>この取得範囲に管理対象はありません。</p>"}</section>`;
    } catch (error) { const diagnostic = error instanceof Error && /^(bridge_|stale_)/.test(error.message) ? error.message : "bridge_transport_error"; body = `<section class="card" role="alert"><p>診断：${e(diagnostic)}</p><h2>現在は接続を確認できません</h2><p>Mac bridge の稼働・ネットワーク状態を確認してください。保存済み情報を実接続として表示することはありません。</p><a href="${path}">再確認</a></section>`; }
  } else if (path === "/crm/customers") {
    title = "顧客台帳"; const rows = await new CrmRepo(env.DB).listCustomers();
    body = `<p class="notice">隔離デモ用 D1 · 本番・Telegram 由来の顧客データは未取り込み。</p><section class="card"><h2>登録済み顧客 ${rows.length}件</h2>${rows.length ? `<ul>${rows.map(c => `<li>${e(c.displayName)} · ${e(c.source)}</li>`).join("")}</ul>` : "<p>顧客はまだ登録されていません。</p>"}<button disabled>顧客登録：読み取り専用</button></section>`;
  } else if (path === "/crm/bookings") {
    title = "予約管理"; const crm = new CrmRepo(env.DB); const [slots, bookings] = await Promise.all([crm.listSlots(), crm.listBookings()]);
    body = `<p class="notice">隔離デモ用 D1 · 実予約・通知・Telegram 連携送信なし。</p><section class="card"><h2>予約枠 ${slots.length}件</h2>${slots.length ? `<ul>${slots.map(s => `<li>${e(s.title)} · ${e(s.startsAt)}</li>`).join("")}</ul>` : "<p>予約枠はまだ登録されていません。</p>"}<button disabled>予約枠の作成：読み取り専用</button></section><section class="card"><h2>予約一覧 ${bookings.length}件</h2>${bookings.length ? `<ul>${bookings.map(b => `<li>${e(b.id)} · ${e(b.status)}</li>`).join("")}</ul>` : "<p>予約はまだ登録されていません。</p>"}<button disabled>予約・キャンセル：読み取り専用</button></section>`;
  } else return html(page("ページが見つかりません", `<a href="/">概要に戻る</a>`, true), 404);
  return html(page(title, body, true));
}
export default { async fetch(request: Request, env: Env): Promise<Response> {
  try { return await route(request, env); } catch { return json({ success: false, error: "demo_temporarily_unavailable" }, 503); }
} };
