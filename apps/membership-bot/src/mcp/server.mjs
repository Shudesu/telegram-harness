// Telegram Harness MCP — remote MCP endpoint (Streamable HTTP, JSON responses, stateless).
//
//   POST /mcp   Authorization: Bearer <MCP_API_KEY>
//
// Same shape as the sister harnesses' MCP servers (LINE / X / IG Harness: one API key, snake_case
// tools named list_* / get_* / account_summary), served from the Worker itself so The Harness Cloud or
// any MCP client can reach it over HTTPS without a local process.
//
// Safety contract:
//  * MCP_API_KEY is its own secret. It is NOT the admin token: an MCP client cannot reach
//    /admin/membership/* (approve, reject, rule_add, plan_set, refund execution …).
//  * Read tools answer at once and carry no Telegram user/chat id.
//  * Every tool that would send, broadcast, refund, cancel, kick, change a rule, a plan or PAY_LIVE is
//    a request_* tool that only queues (see ops.mjs). There is no approve tool.
import {safeEqual} from '../membership/providers/contract.mjs';
import {membershipOn} from '../membership/http.mjs';
import {GENERATION, SCHEMAS, BOT} from '../schema.mjs';
import {KINDS, GALLERY, TOUR, FAQ, BOOK_STEPS, slotsOf} from '../studio/widgets.mjs';
import {TEMPLATES, templateById} from '../richmsg/templates.mjs';
import {termsText} from '../studio/legal.mjs';
import {APP_PLANS, SALON, skuOf} from '../studio/plans.mjs';
import {managedConfigured, NOT_ENABLED_TEXT} from '../managed.mjs';
import {payLive} from '../studio/app.mjs';

export const MCP_VERSION = '1.1.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024;
const READ_METHODS = new Set(['getMe', 'getWebhookInfo', 'getMyCommands']); // the only Bot API calls MCP makes

const membershipObject = env => env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`);
async function member(env, op, args = {}) {
  if (!membershipOn(env)) throw Error('membership_off (MEMBERSHIP != 1)');
  return membershipObject(env).membership('mcp', op, args);
}

async function botRead(env, method, params = {}, fetchImpl = fetch) {
  if (!READ_METHODS.has(method)) throw Error('method_not_allowed');
  if (!env.BOT_TOKEN) throw Error('bot_token_missing');
  const r = await fetchImpl(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(params), signal: AbortSignal.timeout(8000)});
  const p = await r.json().catch(() => null);
  if (!p?.ok) throw Error(`bot_api_error ${Number(p?.error_code) || r.status}`);
  return p.result;
}

// ---------------------------------------------------------------- schema helpers
const S = {
  str: (description, extra = {}) => ({type: 'string', description, ...extra}),
  int: (description, extra = {}) => ({type: 'integer', description, ...extra}),
  bool: description => ({type: 'boolean', description}),
};
const obj = (properties = {}, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const LIMIT = S.int('最大件数', {minimum: 1, maximum: 500});
const NOTE = S.str('オーナーへの補足（任意・500文字まで）', {maxLength: 500});
const READ = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const QUEUE = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const QUEUED_NOTE = '実行はしない。承認待ちに積むだけで、オーナーが管理APIで承認して初めて実行される。';

// ---------------------------------------------------------------- tools
const TOOLS = [
  // ----- 状態・統計
  {name: 'account_summary', title: 'アカウント概要', annotations: READ, inputSchema: obj(),
    description: 'Telegram Harness（@teleharness_bot）の概要: 稼働バージョン、会員機能/本番決済(PAY_LIVE)の状態、プラン数、有効ルール、承認待ち件数、注文数と支払い済みStars合計、有効会員数、問い合わせ件数。',
    run: async (env) => ({bot: 'teleharness_bot', botId: BOT, generation: GENERATION, mcpVersion: MCP_VERSION,
      membership: membershipOn(env), payLive: payLive(env), managedBotsConfigured: managedConfigured(env), tokenConfigured: Boolean(env.BOT_TOKEN),
      ...(membershipOn(env) ? await member(env, 'summary') : {})})},
  {name: 'get_bot_status', title: 'Bot接続状態', annotations: {...READ, openWorldHint: true}, inputSchema: obj(),
    description: 'Telegram Bot API に読み取り専用で問い合わせ（getMe・getWebhookInfo）、Botの識別とWebhookの未処理件数・直近エラー有無・受信update種別を返す。URLや秘密値は返さない。',
    run: async (env, a, deps) => {
      const [me, wh] = await Promise.all([botRead(env, 'getMe', {}, deps.fetch), botRead(env, 'getWebhookInfo', {}, deps.fetch)]);
      return {username: me?.username ?? null, isExpectedBot: me?.id === BOT, canJoinGroups: me?.can_join_groups ?? null,
        webhook: {configured: Boolean(wh?.url), pendingUpdateCount: wh?.pending_update_count ?? null,
          lastErrorAt: wh?.last_error_date ? new Date(wh.last_error_date * 1000).toISOString() : null,
          lastErrorMessage: wh?.last_error_message ?? null, maxConnections: wh?.max_connections ?? null, allowedUpdates: wh?.allowed_updates ?? []}};
    }},
  {name: 'list_commands', title: 'コマンド一覧', annotations: {...READ, openWorldHint: true},
    inputSchema: obj({language: S.str('言語（"" = 既定, "en"）', {enum: ['', 'en']})}),
    description: 'Botのコマンドメニュー（getMyCommands）を読み取る。',
    run: async (env, a, deps) => botRead(env, 'getMyCommands', a.language ? {language_code: a.language} : {}, deps.fetch)},

  // ----- 会員・プラン・決済
  {name: 'list_plans', title: '会員プラン一覧', annotations: READ, inputSchema: obj(),
    description: '登録済みの会員プラン（SKU・Stars価格・期間・自動更新・掲載状態）。会員グループのIDは件数だけ返す。Mini App 側の表示プラン定義（サロン名・特典）も含む。',
    run: async (env) => ({salon: SALON, registered: membershipOn(env) ? await member(env, 'plans') : [],
      miniApp: APP_PLANS.map(p => ({id: p.id, sku: skuOf(p.id), name: p.name, stars: p.stars, recurring: p.recurring, tag: p.tag || null, description: p.desc, features: p.f})),
      checkout: payLive(env) ? 'live: 購入者本人が Mini App（💳 決済・会員）/ /plans から Stars 請求書を開く' : 'test: 請求書は作られない'})},
  {name: 'list_orders', title: '注文一覧', annotations: READ, inputSchema: obj({limit: LIMIT}),
    description: '注文（新しい順）: 注文ID・プラン・SKU・決済手段・金額・状態・支払/返金日時。購入者のIDは返さない。',
    run: (env, a) => member(env, 'orders', {limit: a.limit})},
  {name: 'list_payment_providers', title: '決済手段', annotations: READ, inputSchema: obj(),
    description: '決済手段（Telegram Stars / Stripe / KOMOJU / 銀行振込）ごとの設定済み・有効状態。',
    run: (env) => member(env, 'providers')},
  {name: 'get_terms', title: '規約・特商法', annotations: READ, inputSchema: obj(),
    description: '/terms で表示している利用規約の要約と特定商取引法に基づく表記。',
    run: async () => ({text: termsText()})},

  // ----- 問い合わせ・承認・ルール・監査
  {name: 'list_tickets', title: '/paysupport 問い合わせ', annotations: READ, inputSchema: obj({limit: LIMIT}),
    description: '/paysupport の問い合わせチケット（受付番号・日時・本文・関連注文・状態）。送信者のIDは返さない。返信は request_ticket_reply。',
    run: (env, a) => member(env, 'tickets', {limit: a.limit})},
  {name: 'list_rule_presets', title: '自動化ルールの種類', annotations: READ, inputSchema: obj(),
    description: '事前承認ルールのプリセット（固定。条件と実行できるBot APIメソッド）。',
    run: (env) => member(env, 'presets')},
  {name: 'list_rules', title: '自動化ルール', annotations: READ, inputSchema: obj(),
    description: 'オーナーが登録した事前承認ルールと有効/無効。対象グループは件数だけ返す。',
    run: (env) => member(env, 'rules')},
  {name: 'list_approvals', title: '承認待ち', annotations: READ,
    inputSchema: obj({state: S.str('状態', {enum: ['pending', 'approved', 'rejected', 'all']}), limit: LIMIT}),
    description: '承認キュー（送信・退出・返金などのBot API操作）。宛先は user/group の種別だけ、本文は先頭300文字。承認/却下はオーナーが管理APIで行う（MCPには承認ツールが無い）。',
    run: (env, a) => member(env, 'approvals', a)},
  {name: 'list_owner_requests', title: 'オーナー依頼', annotations: READ,
    inputSchema: obj({state: S.str('状態', {enum: ['pending', 'done', 'rejected', 'all']}), limit: LIMIT}),
    description: 'request_* ツールで積まれた、オーナーの手作業が必要な依頼（一斉配信・ルール変更・プラン変更・PAY_LIVE変更・解約・Stars以外の返金）。',
    run: (env, a) => member(env, 'owner_requests', a)},
  {name: 'get_audit_log', title: '監査ログ', annotations: READ, inputSchema: obj({limit: S.int('最大件数', {minimum: 1, maximum: 1000})}),
    description: '会員機能の監査ログ（新しい順）: ルール追加/無効化、承認待ち登録、実行結果、注文・返金・チケット・MCP依頼。人のIDは返さない。',
    run: (env, a) => member(env, 'audit', {limit: a.limit})},

  // ----- 予約・ウィジェット・ガイド・リッチ・自動応答・Bot作成
  {name: 'list_booking_catalog', title: '予約カタログ', annotations: READ, inputSchema: obj(),
    description: 'チャット内予約（デモ）の業態・メニュー（所要分・税込円）・架空スタッフ・予約ステップ。予約は実在しないダミー。',
    run: async () => ({demo: true, steps: BOOK_STEPS, industries: SCHEMAS.map((s, i) => ({id: s.id, label: s.label,
      services: s.services.map(x => ({name: x.name, minutes: x.minutes, yen: x.yen})), staff: s.staff.map(p => p.name), slots: slotsOf(i)}))})},
  {name: 'list_widgets', title: 'ウィジェット一覧', annotations: READ, inputSchema: obj(),
    description: 'Bot API 10.4 HTMLウィジェット13種（予約・ガイド・一覧・カレンダー・メニュー・スタッフ・会員証・プラン比較・投票・スタンプ・管理・FAQ・カウントダウン）と表示名。利用者は /widgets から開く。',
    run: async () => {
      const label = Object.fromEntries(GALLERY.map(([code, icon, name, sub]) => [code, {icon, name, sub}]));
      label.ga = {icon: '✨', name: 'ウィジェット一覧', sub: '一覧'};
      return Object.entries(KINDS).map(([code, k]) => ({code, ...(label[code] ?? {}), caption: k.caption}));
    }},
  {name: 'list_guide_steps', title: '/start ガイド', annotations: READ, inputSchema: obj(),
    description: '/start のはじめてガイド（6ステップ）の各ステップの見出し・説明・押す場所。',
    run: async () => TOUR.map((s, i) => ({step: i + 1, icon: s.e, title: s.t, description: s.d, hint: s.h, cta: s.k}))},
  {name: 'list_rich_templates', title: 'リッチメッセージテンプレ', annotations: READ,
    inputSchema: obj({templateId: S.str('指定するとそのテンプレの全ブロック・ボタンを返す')}),
    description: 'リッチメッセージ（動画ヘッダー・装飾テキスト・ボタン）のテンプレ一覧、または1件の中身。送信はしない。',
    run: async (env, a) => {
      if (a.templateId) { const t = templateById(a.templateId); if (!t) throw Error('unknown_template'); return t; }
      return TEMPLATES.map(t => ({templateId: t.templateId, title: t.title, media: t.media?.kind ?? 'none', blocks: t.blocks?.length ?? 0, buttonRows: t.buttons?.length ?? 0}));
    }},
  {name: 'list_auto_replies', title: '自動応答', annotations: READ, inputSchema: obj(),
    description: 'FAQ自動応答（チャットで「料金は？」等に自動返答する内容）の一覧。',
    run: async () => FAQ.map(([q, a]) => ({question: q, answer: a}))},
  {name: 'get_managed_bots_status', title: 'Bot作成（Managed Bots）', annotations: READ, inputSchema: obj(),
    description: '/newbot（Managed Bots, Bot API 9.6）が使える状態か。作成されたBotのトークンは扱わない。',
    run: async (env) => ({configured: managedConfigured(env), command: '/newbot', note: managedConfigured(env) ? 'Worker 側の鍵は設定済み。BotFather 側で「他のBotの管理」が有効なら作成ボタンが出る。' : NOT_ENABLED_TEXT})},

  // Catalogue workflows need an explicit owner request too. None of these has an executor.
  {name: 'request_booking', title: 'デモ予約の操作を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('対象チャットID'), action: S.str('操作', {enum: ['start', 'lookup', 'cancel']}), note: NOTE}, ['chatId', 'action']),
    description: 'デモ予約カードの開始・照会・取消をオーナー依頼に記録する。予約やチャットの状態は変更しない。', run: (env, a) => member(env, 'q_booking', a)},
  {name: 'request_widget', title: 'ウィジェット表示を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('宛先チャットID'), kind: S.str('ウィジェット種別', {enum: Object.keys(KINDS)}), note: NOTE}, ['chatId', 'kind']),
    description: '13種のウィジェット表示をオーナー依頼に記録する。sendMessage等は呼ばない。', run: (env, a) => member(env, 'q_widget', a)},
  {name: 'request_guide', title: 'ガイド表示を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('宛先チャットID'), step: S.int('ガイドのステップ', {minimum: 1, maximum: TOUR.length}), note: NOTE}, ['chatId', 'step']),
    description: '/start ガイドの指定ステップ表示をオーナー依頼に記録する。送信・進行状態の更新はしない。', run: (env, a) => member(env, 'q_guide', a)},
  {name: 'request_rich_message', title: 'リッチテンプレ送信を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('宛先チャットID'), templateId: S.str('テンプレID', {enum: TEMPLATES.map(t => t.templateId)}), note: NOTE}, ['chatId', 'templateId']),
    description: 'テンプレの内容を固定してオーナー依頼に記録する。送信しない。送信前にオーナーが内容を確認する。', run: (env, a) => member(env, 'q_rich_message', a)},
  {name: 'request_auto_reply_change', title: '自動応答の変更を依頼', annotations: QUEUE,
    inputSchema: obj({question: S.str('質問', {minLength: 1, maxLength: 200}), answer: S.str('回答', {minLength: 1, maxLength: 2000}), note: NOTE}, ['question', 'answer']),
    description: 'FAQ自動応答の追加・変更をオーナー依頼に記録する。現在の応答は変更しない。反映は別途コード修正が必要。', run: (env, a) => member(env, 'q_auto_reply_change', a)},
  {name: 'request_managed_bot_creation', title: 'Managed Bot作成を依頼', annotations: QUEUE,
    inputSchema: obj({industryId: S.str('業態ID', {enum: SCHEMAS.map(s => s.id)}), note: NOTE}, ['industryId']),
    description: 'Managed Bot作成の希望をオーナー依頼に記録する。Bot作成・トークン取得・webhook設定は行わない。作成時は本人の /newbot 操作が必要。', run: (env, a) => member(env, 'q_managed_bot_creation', a)},
  {name: 'request_invoice_link', title: 'Stars請求リンクを依頼', annotations: QUEUE,
    inputSchema: obj({skuId: S.str('登録済みStars SKU ID'), note: NOTE}, ['skuId']),
    description: 'Stars請求リンクの希望をオーナー依頼に記録する。注文や請求リンクは作成せず、購入者本人のMini App確認を必須とする。', run: (env, a) => member(env, 'q_invoice_link', a)},
  {name: 'request_approval', title: '承認の判断をオーナーに依頼', annotations: QUEUE,
    inputSchema: obj({approvalId: S.str('承認待ちID'), note: NOTE}, ['approvalId']),
    description: '既存の承認待ちをオーナーに確認してもらう依頼を記録する。承認・却下・実行はしない。', run: (env, a) => member(env, 'q_approval', a)},

  // ----- 承認待ちに積むだけ（危険操作）
  {name: 'request_send_message', title: 'メッセージ送信を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('宛先のチャットID（個人=正, グループ=負）'), text: S.str('本文（1〜4096文字）', {minLength: 1, maxLength: 4096})}, ['chatId', 'text']),
    description: `1件のテキスト送信を承認キューに積む。${QUEUED_NOTE}`, run: (env, a) => member(env, 'q_send_message', a)},
  {name: 'request_broadcast', title: '一斉配信を依頼', annotations: QUEUE,
    inputSchema: obj({audience: S.str('対象', {enum: ['active_members', 'all_buyers']}), text: S.str('本文（1〜4096文字）', {minLength: 1, maxLength: 4096}), note: NOTE}, ['audience', 'text']),
    description: '一斉配信をオーナー依頼として記録する。配信は行わない（自動で一斉配信する経路はこのBotに無い）。', run: (env, a) => member(env, 'q_broadcast', a)},
  {name: 'request_ticket_reply', title: '問い合わせ返信を依頼', annotations: QUEUE,
    inputSchema: obj({ticketId: S.str('受付番号（例 T1）'), text: S.str('返信本文（1〜3500文字）', {minLength: 1, maxLength: 3500})}, ['ticketId', 'text']),
    description: `/paysupport チケットへの返信を承認キューに積む。${QUEUED_NOTE}`, run: (env, a) => member(env, 'q_ticket_reply', a)},
  {name: 'request_refund', title: '返金を依頼', annotations: QUEUE,
    inputSchema: obj({orderId: S.str('注文ID'), note: NOTE}, ['orderId']),
    description: `支払い済み注文の全額返金を依頼する。Starsは refundStarPayment を承認キューへ、それ以外はオーナー依頼へ。${QUEUED_NOTE}`, run: (env, a) => member(env, 'q_refund', a)},
  {name: 'request_subscription_cancel', title: '自動更新の解約を依頼', annotations: QUEUE,
    inputSchema: obj({orderId: S.str('注文ID'), atPeriodEnd: S.bool('true=期間末で終了（既定）/ false=即時'), note: NOTE}, ['orderId']),
    description: 'サブスク注文の解約をオーナー依頼として記録する。解約は行わない。', run: (env, a) => member(env, 'q_subscription_cancel', a)},
  {name: 'request_kick', title: 'グループからの退出を依頼', annotations: QUEUE,
    inputSchema: obj({chatId: S.int('グループID（負の数）'), userId: S.int('対象ユーザーID'), }, ['chatId', 'userId']),
    description: `会員グループからの退出（60秒BAN）を承認キューに積む。${QUEUED_NOTE}`, run: (env, a) => member(env, 'q_kick', a)},
  {name: 'request_rule_change', title: '自動化ルールの変更を依頼', annotations: QUEUE,
    inputSchema: obj({action: S.str('enable | disable', {enum: ['enable', 'disable']}), preset: S.str('有効化するプリセットID（enable）'),
      chats: {type: 'array', items: {type: 'integer'}, description: '対象グループIDに限定する場合（enable・任意）'}, ruleId: S.str('無効化するルールID（disable）'), note: NOTE}, ['action']),
    description: 'ルールの有効化/無効化をオーナー依頼として記録する。ルールは変更しない。', run: (env, a) => member(env, 'q_rule_change', a)},
  {name: 'request_plan_change', title: 'プランの追加・変更を依頼', annotations: QUEUE,
    inputSchema: obj({plan: {type: 'object', description: 'プラン定義（id, title, goodsKind, chats, skus[]…。/admin/membership/plan_set と同じ形）'}, note: NOTE}, ['plan']),
    description: 'プラン・価格の追加/変更をオーナー依頼として記録する。プランは変更しない。', run: (env, a) => member(env, 'q_plan_change', a)},
  {name: 'request_pay_live_change', title: '本番決済(PAY_LIVE)の切替を依頼', annotations: QUEUE,
    inputSchema: obj({enabled: S.bool('true=本番請求 / false=TEST'), note: NOTE}, ['enabled']),
    description: 'PAY_LIVE の切替をオーナー依頼として記録する。設定は変更しない（Worker の再デプロイが必要な操作）。', run: (env, a) => member(env, 'q_pay_live', a)},
];
export const TOOL_NAMES = TOOLS.map(t => t.name);
export const QUEUE_TOOLS = TOOLS.filter(t => !t.annotations.readOnlyHint).map(t => t.name);

// ---------------------------------------------------------------- argument check (the declared schema, nothing more)
function checkArgs(schema, args) {
  function check(p, v, path) {
    const ok = p.type === 'integer' ? Number.isSafeInteger(v) : p.type === 'string' ? typeof v === 'string'
      : p.type === 'boolean' ? typeof v === 'boolean' : p.type === 'array' ? Array.isArray(v)
      : p.type === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : true;
    if (!ok) throw Error(`bad argument type: ${path}`);
    if (p.enum && !p.enum.includes(v)) throw Error(`bad argument value: ${path}`);
    if (p.type === 'integer' && ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum))) throw Error(`out of range: ${path}`);
    if (p.type === 'string' && ((p.minLength !== undefined && v.length < p.minLength) || (p.maxLength !== undefined && v.length > p.maxLength))) throw Error(`bad argument length: ${path}`);
    if (p.type === 'array' && p.items) for (const x of v) check(p.items, x, path);
    if (p.type === 'object' && p.properties) {
      for (const k of Object.keys(v)) if (p.additionalProperties === false && !Object.hasOwn(p.properties, k)) throw Error(`unknown argument: ${k}`);
      for (const k of p.required ?? []) if (v[k] === undefined) throw Error(`missing argument: ${k}`);
      for (const [k, x] of Object.entries(v)) if (Object.hasOwn(p.properties, k)) check(p.properties[k], x, k);
    }
  }
  args = args === undefined ? {} : args;
  check(schema, args, 'arguments');
  return args;
}

// ---------------------------------------------------------------- JSON-RPC
const rpcResult = (id, result) => ({jsonrpc: '2.0', id, result});
const rpcError = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});
const INSTRUCTIONS = 'Telegram Harness（@teleharness_bot）の運用MCP。list_*/get_*/account_summary は読み取りのみで即時に返る。request_* は送信・一斉配信・返金・解約・キック・ルール/プラン/PAY_LIVE変更を「承認待ち／オーナー依頼」に積むだけで実行しない。承認はオーナーが管理APIで行う。結果にTelegramのユーザーID・チャットIDは含めない。';

export async function handleRpc(msg, env, deps = {}) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid Request');
  const isNotification = !Object.hasOwn(msg, 'id');
  if (isNotification) return null;
  const {id, method, params = {}} = msg;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return rpcResult(id, {protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'telegram-harness', title: 'Telegram Harness', version: MCP_VERSION}, instructions: INSTRUCTIONS});
    }
    case 'ping': return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {tools: TOOLS.map(({name, title, description, inputSchema, annotations}) => ({name, title, description, inputSchema, annotations: {title, ...annotations}}))});
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params?.name).slice(0, 64)}`);
      let args;
      try { args = checkArgs(tool.inputSchema, params.arguments); }
      catch (err) { return rpcError(id, -32602, String(err.message)); }
      try {
        const out = await tool.run(env, args, {fetch: deps.fetch ?? fetch});
        const structured = Array.isArray(out) ? {items: out} : out;
        return rpcResult(id, {content: [{type: 'text', text: JSON.stringify(out, null, 1)}], structuredContent: structured, isError: false});
      } catch (err) {
        // Tool failures are results (the client shows them to the model), never thrown 500s.
        return rpcResult(id, {content: [{type: 'text', text: `error: ${String(err?.message ?? err).slice(0, 300)}`}], isError: true});
      }
    }
    default: return rpcError(id, -32601, 'Method not found');
  }
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...headers}});

// null when the request is not for /mcp.
export async function mcpFetch(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/mcp') return null;
  const auth = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return json({error: 'unauthorized'}, 401, {'www-authenticate': 'Bearer realm="telegram-harness-mcp"'});
  if (!env.MCP_API_KEY || env.MCP_API_KEY.length < 32 || !safeEqual(m[1], env.MCP_API_KEY)) return json({error: 'forbidden'}, 403);
  // A browser page must not drive this endpoint with a leaked key (DNS-rebinding guard of the MCP spec).
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({error: 'forbidden_origin'}, 403);
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: {allow: 'POST'}});
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(rpcError(null, -32600, 'Request too large'), 413);
  let msg;
  try { msg = JSON.parse(raw); } catch { return json(rpcError(null, -32700, 'Parse error'), 400); }
  if (Array.isArray(msg)) return json(rpcError(null, -32600, 'Batch requests are not supported'), 400);
  const out = await handleRpc(msg, env, deps);
  if (out === null) return new Response(null, {status: 202});
  return json(out);
}
