// Phase 1 membership: rule gate, Stars payments, automatic join/leave, join verification, external
// rails, and the rich-message pay button path — end to end through the Worker's own fetch/scheduled
// handlers and the real ChatSession Durable Object class. Telegram and Stripe are mock APIs: nothing
// here can reach the network, charge anyone or approve/kick a real person.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const SECRET = 'test-webhook-secret-value';
const ADMIN = 'test-admin-token-NOT-REAL';
const STRIPE_KEY = 'stripe-secret-NOT-REAL', STRIPE_WH = 'stripe-webhook-NOT-REAL';
const GROUP = -1000000000001, GROUP2 = -1000000000002, OTHER_GROUP = -1000000000009;
const BUYER = 70000101, STRANGER = 70000102, BUYER2 = 70000103, BUYER3 = 70000104;
const DAY = 86400000;

const {ChatSession} = await import('../src/chat.mjs');
const worker = (await import('../src/index.mjs')).default;
const {makeService} = await import('../src/membership/service.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const {provider: stars, eventsFromUpdate} = await import('../src/membership/providers/stars.mjs');
const {signInitData, QUESTIONS} = await import('../src/membership/verify.mjs');
const {hmacHex} = await import('../src/membership/providers/contract.mjs');
let richmsg = null;
try { richmsg = await import('../src/richmsg/compose.mjs'); } catch {}

// ---------- clock, mock APIs, log capture ----------
let clock = Date.UTC(2026, 10, 11, 0, 0, 0);
const realNow = Date.now;
Date.now = () => clock;
let api = [], stripeCalls = [], fail = {};
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    stripeCalls.push({url: u, init});
    if (u.endsWith('/checkout/sessions')) return Response.json({id: 'cs_test_mock1', url: 'https://checkout.stripe.invalid/c/cs_test_mock1'});
    return Response.json({id: 're_mock', status: 'succeeded'});
  }
  if (!u.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw Error('unexpected_host');
  const method = u.split('/').pop();
  const body = JSON.parse(init.body);
  api.push({method, body});
  if (fail[method]) { const code = fail[method]; delete fail[method]; return Response.json({ok: false, error_code: code, description: 'stub'}, {status: code}); }
  let result = true;
  if (method === 'createInvoiceLink') result = 'https://t.me/$TEST_INVOICE_LINK';
  else if (method === 'sendMessage' || method === 'sendInvoice') result = {message_id: 9000 + api.length, chat: {id: body.chat_id}};
  return Response.json({ok: true, result});
};

// ---------- Durable Object runtime stub (get/put/delete/list) ----------
function makeCtx(store, name) {
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async delete(k) { return store.delete(k); },
      async list({prefix = ''} = {}) { return new Map([...store.keys()].filter(k => k.startsWith(prefix)).sort().map(k => [k, structuredClone(store.get(k))])); },
    },
    blockConcurrencyWhile(fn) { const p = fn(); ctx._init = p; return p; },
    _init: Promise.resolve(), id: {name},
  };
  return ctx;
}
function makeNamespace(envRef) {
  const stores = new Map(), live = new Map();
  return {
    getByName(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      if (!live.has(name)) { const ctx = makeCtx(stores.get(name), name); live.set(name, {ctx, obj: new ChatSession(ctx, envRef.env)}); }
      const {ctx, obj} = live.get(name);
      return new Proxy({}, {get: (_, prop) => (...args) => ctx._init.then(() => obj[prop](...args))});
    },
    _store: name => stores.get(name),
    _names: () => [...stores.keys()],
  };
}
const ASSET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const envRef = {};
const env = {
  BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, ADMIN_TOKEN: ADMIN, MEMBERSHIP: '1', SEED_FILE_IDS: '{}', SEED_OPTINS: '{}',
  STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: STRIPE_WH,
  ASSETS: {async fetch(url) { const p = path.join(ASSET_DIR, new URL(String(url)).pathname.slice(1)); return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response('nf', {status: 404}); }},
};
envRef.env = env;
env.CHAT = makeNamespace(envRef);
const pending = [];
const ctx = {waitUntil: p => pending.push(p)};
const settle = async () => { while (pending.length) await pending.shift(); };

const ORIGIN = 'https://teleharness-bot.example.invalid';
let uid = 1000;
async function hook(update, e = env) {
  const r = await worker.fetch(new Request(`${ORIGIN}/webhook`, {method: 'POST', headers: {'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json'},
    body: JSON.stringify({update_id: ++uid, ...update})}), e, ctx);
  await settle();
  return r;
}
async function admin(op, body = {}, token = ADMIN) {
  const r = await worker.fetch(new Request(`${ORIGIN}/admin/membership/${op}`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env, ctx);
  return r.status === 200 ? (await r.json()).result : {httpStatus: r.status, ...(await r.json().catch(() => ({})))};
}
async function verifyApi(op, body) {
  const r = await worker.fetch(new Request(`${ORIGIN}/verify/${op}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), env, ctx);
  return r.json();
}
const cron = async () => { await worker.scheduled({cron: '* * * * *', scheduledTime: clock}, env, ctx); await settle(); };
const calls = m => api.filter(c => c.method === m);
const memberStore = () => env.CHAT._store('membership:main');
const ent = (u, p = 'vip') => memberStore().get(`ent:${u}:${p}`);
const answerFor = q => ({'3 + 4 は？': 1, '1週間は何日？': 1, 'りんごの色として正しいのは？': 0, '「おはよう」はいつのあいさつ？': 1})[q];

const results = [];
let pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; results.push(name); }
  catch (err) { console.log = realLog; console.error(`FAIL: ${name}\n`, err); process.exit(1); }
}

// =====================================================================================
// 1. Pre-approved rule gate (unit, in-memory store)
// =====================================================================================
await test('gate: a write with no rule waits for approval and reaches no API; owner approval runs it once', async () => {
  api = [];
  const svc = makeService({store: memoryStore(), env, now: () => clock});
  const out = await svc.gate.request({condition: 'paid_member_verified', method: 'approveChatJoinRequest', params: {chat_id: GROUP, user_id: BUYER}, chatId: GROUP});
  assert.equal(out.status, 'pending_approval');
  assert.equal(api.length, 0);
  assert.equal((await svc.gate.listApprovals()).length, 1);
  const done = await svc.gate.decide(out.approvalId, true);
  assert.equal(done.status, 'executed');
  assert.deepEqual(api.map(c => c.method), ['approveChatJoinRequest']);
  await assert.rejects(svc.gate.decide(out.approvalId, true), /already_decided/);
  const log = await svc.gate.auditLog();
  assert.deepEqual(log.map(l => l.kind), ['queued', 'executed']);
  assert.equal(log[1].via, `approval:${out.approvalId}`);
});

await test('gate: inside an enabled rule the write runs at once and is audited; disabling the rule puts it back behind approval', async () => {
  api = [];
  const svc = makeService({store: memoryStore(), env, now: () => clock});
  const rule = await svc.gate.addRule('join_approve_paid', {chats: [GROUP]});
  assert.equal((await svc.gate.listRules()).length, 1);
  const a = await svc.gate.request({condition: 'paid_member_verified', method: 'approveChatJoinRequest', params: {chat_id: GROUP, user_id: BUYER}, chatId: GROUP});
  assert.equal(a.status, 'executed'); assert.equal(a.ruleId, rule.id);
  // Same rule, other chat / other method / other condition: not covered.
  for (const req of [
    {condition: 'paid_member_verified', method: 'approveChatJoinRequest', chatId: OTHER_GROUP},
    {condition: 'paid_member_verified', method: 'banChatMember', chatId: GROUP},
    {condition: 'not_entitled', method: 'approveChatJoinRequest', chatId: GROUP},
    {condition: 'paid_member_verified', method: 'sendMessage', chatId: GROUP},
  ]) assert.equal((await svc.gate.request({...req, params: {chat_id: req.chatId, user_id: BUYER}})).status, 'pending_approval');
  await svc.gate.disableRule(rule.id);
  assert.equal((await svc.gate.request({condition: 'paid_member_verified', method: 'approveChatJoinRequest', params: {}, chatId: GROUP})).status, 'pending_approval');
  assert.equal(api.length, 1);
  const kinds = (await svc.gate.auditLog()).map(l => l.kind);
  assert.deepEqual(kinds, ['rule_added', 'executed', 'queued', 'queued', 'queued', 'queued', 'rule_disabled', 'queued']);
  await assert.rejects(svc.gate.addRule('anything_goes'), /unknown_preset/);
});

await test('gate: a method outside the membership allowlist is refused even when approved', async () => {
  api = [];
  const svc = makeService({store: memoryStore(), env, now: () => clock});
  const out = await svc.gate.request({condition: 'x', method: 'sendMessageToAll', params: {}});
  const done = await svc.gate.decide(out.approvalId, true);
  assert.equal(done.status, 'failed'); assert.match(done.error, /method_not_allowed/);
  assert.equal(api.length, 0);
});

// =====================================================================================
// 2. Stars provider (unit)
// =====================================================================================
await test('stars: one-off checkout is a sendInvoice in XTR with one price and an empty provider_token', async () => {
  const seen = [];
  const r = await stars.createCheckout({orderId: 'o1abc', amount: 500, currency: 'XTR', title: 'VIP 30日', chatId: BUYER, goodsKind: 'digital'},
    {call: async (m, p) => { seen.push({m, p}); return true; }});
  assert.equal(r.kind, 'invoice_message');
  assert.equal(seen[0].m, 'sendInvoice');
  assert.deepEqual({c: seen[0].p.currency, t: seen[0].p.provider_token, n: seen[0].p.prices.length, pl: seen[0].p.payload}, {c: 'XTR', t: '', n: 1, pl: 'o:o1abc'});
});

await test('stars: a subscription is a createInvoiceLink with subscription_period=2592000 and the price cap', async () => {
  const seen = [];
  const r = await stars.createCheckout({orderId: 'o2', amount: 300, currency: 'XTR', title: 'VIP 月額', recurring: {intervalDays: 30}, chatId: BUYER},
    {call: async (m, p) => { seen.push({m, p}); return 'https://t.me/$x'; }});
  assert.equal(r.kind, 'invoice_link'); assert.equal(seen[0].m, 'createInvoiceLink'); assert.equal(seen[0].p.subscription_period, 2592000);
  await assert.rejects(stars.createCheckout({orderId: 'o3', amount: 10001, currency: 'XTR', title: 'x', recurring: {intervalDays: 30}}, {call: async () => ''}), /subscription_price_too_high/);
  await assert.rejects(stars.createCheckout({orderId: 'o4', amount: 300, currency: 'JPY', title: 'x'}, {call: async () => ''}), /stars_requires_xtr/);
});

await test('stars: updates map to paid / renewed / refunded / failed / canceled; webhook proof is the secret_token', async () => {
  const base = {from: {id: BUYER}, chat: {id: BUYER, type: 'private'}, date: 1800000000};
  const sp = (extra) => ({currency: 'XTR', total_amount: 300, invoice_payload: 'o:o9', telegram_payment_charge_id: 'ch1', provider_payment_charge_id: '', ...extra});
  assert.equal(eventsFromUpdate({message: {...base, successful_payment: sp({is_recurring: true, is_first_recurring: true, subscription_expiration_date: 1802592000})}})[0].type, 'paid');
  assert.equal(eventsFromUpdate({message: {...base, successful_payment: sp({is_recurring: true, subscription_expiration_date: 1805184000})}})[0].type, 'renewed');
  assert.equal(eventsFromUpdate({message: {...base, refunded_payment: {currency: 'XTR', total_amount: 300, invoice_payload: 'o:o9', telegram_payment_charge_id: 'ch1'}}})[0].type, 'refunded');
  assert.equal(eventsFromUpdate({update_id: 5, subscription: {user: {id: BUYER}, invoice_payload: 'o:o9', state: 'failed'}})[0].type, 'failed');
  assert.equal(eventsFromUpdate({update_id: 6, subscription: {user: {id: BUYER}, invoice_payload: 'o:o9', state: 'canceled'}})[0].type, 'canceled');
  const req = s => new Request('https://x.invalid/', {method: 'POST', headers: {'x-telegram-bot-api-secret-token': s}, body: JSON.stringify({update_id: 1, message: {...base, successful_payment: sp({})}})});
  assert.equal((await stars.verifyWebhook(req(SECRET), {env}))[0].orderId, 'o9');
  await assert.rejects(stars.verifyWebhook(req('wrong'), {env}), /bad_signature/);
});

await test('stars: refund is refundStarPayment (full only); cancel is editUserStarSubscription(is_canceled)', async () => {
  const seen = [];
  const call = async (m, p) => { seen.push({m, p}); return true; };
  await stars.refund({paymentRef: 'ch1', telegramUserId: BUYER, fullAmount: 300}, {call});
  await assert.rejects(stars.refund({paymentRef: 'ch1', telegramUserId: BUYER, amount: 100, fullAmount: 300}, {call}), /partial_refund_not_supported/);
  await stars.cancelSubscription({subscriptionRef: 'ch1', telegramUserId: BUYER}, {call});
  assert.deepEqual(seen.map(s => s.m), ['refundStarPayment', 'editUserStarSubscription']);
  assert.equal(seen[1].p.is_canceled, true);
});

// =====================================================================================
// 3. End to end through the Worker: rules → plans → buy → join → verify → expiry → removal
// =====================================================================================
await test('admin API needs ADMIN_TOKEN; with MEMBERSHIP off none of the new routes exist', async () => {
  assert.equal((await admin('rules', {}, 'wrong')).httpStatus, 403);
  const off = {...env, MEMBERSHIP: '0'};
  const r = await worker.fetch(new Request(`${ORIGIN}/admin/membership/rules`, {method: 'POST', headers: {authorization: `Bearer ${ADMIN}`}}), off, ctx);
  assert.equal(r.status, 404);
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/verify`), off, ctx)).status, 404);
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 1}}, off);
  await worker.scheduled({}, off, ctx); await settle();
  assert.equal(api.length, 0);
  assert.ok(!env.CHAT._names().includes('membership:main'));
});

await test('setup: owner saves plans and enables rules through the admin API; providers list shows unset rails as disabled', async () => {
  assert.equal((await admin('plan_set', {plan: {id: 'vip', title: 'VIPサロン', goodsKind: 'digital', chats: [GROUP, GROUP2],
    links: {[GROUP]: 'https://t.me/+TESTLINK_A', [GROUP2]: 'https://t.me/+TESTLINK_B'},
    skus: [{id: 'vip30', title: '30日', amount: 500, currency: 'XTR', days: 30}, {id: 'vipsub', title: '月額', amount: 300, currency: 'XTR', days: 30, recurring: true}]}})).id, 'vip');
  assert.equal((await admin('plan_set', {plan: {id: 'seat', title: '対面講座の座席予約', goodsKind: 'physical_service', chats: [],
    skus: [{id: 'seat1', title: '1回', amount: 3000, currency: 'JPY', days: null, providers: ['stripe']}]}})).id, 'seat');
  assert.equal((await admin('plan_set', {plan: {id: 'bad', title: 'x', goodsKind: 'digital', chats: [], skus: [{id: 'b', amount: 1, currency: 'XTR', days: 7, recurring: true}]}})).error, 'stars_subscription_is_30_days_xtr');
  for (const preset of ['checkout', 'join_verify', 'join_approve_paid', 'join_decline', 'expire_remove', 'member_notice']) {
    assert.equal((await admin('rule_add', {preset})).enabled, true);
  }
  assert.equal((await admin('rules')).length, 6);
  const prov = await admin('providers');
  assert.deepEqual(prov.map(p => [p.id, p.enabled]), [['telegram_stars', true], ['stripe', true], ['komoju', false], ['bank_gmo', false]]);
  assert.match(prov.find(p => p.id === 'komoju').reason, /無効/);
});

let orderId;
await test('buy: /plans → pay button → sendInvoice; pre_checkout answered ok; successful_payment grants 30 days on both groups', async () => {
  api = [];
  await hook({message: {message_id: 1, from: {id: BUYER}, chat: {id: BUYER, type: 'private'}, date: 1, text: '/plans'}});
  const menu = calls('sendMessage')[0].body.reply_markup.inline_keyboard.flat();
  const btn = menu.find(b => b.callback_data === 'pay/vip30/telegram_stars');
  assert.ok(btn && /⭐500/.test(btn.text));
  await hook({callback_query: {id: 'cq1', from: {id: BUYER}, message: {message_id: 2, chat: {id: BUYER, type: 'private'}}, data: btn.callback_data}});
  const inv = calls('sendInvoice')[0];
  assert.ok(inv, 'invoice sent'); assert.equal(inv.body.currency, 'XTR'); assert.equal(inv.body.prices[0].amount, 500);
  orderId = inv.body.payload.slice(2);
  // A tampered amount is refused, the right one accepted.
  await hook({pre_checkout_query: {id: 'pcq0', from: {id: BUYER}, currency: 'XTR', total_amount: 1, invoice_payload: inv.body.payload}});
  await hook({pre_checkout_query: {id: 'pcq1', from: {id: STRANGER}, currency: 'XTR', total_amount: 500, invoice_payload: inv.body.payload}});
  await hook({pre_checkout_query: {id: 'pcq2', from: {id: BUYER}, currency: 'XTR', total_amount: 500, invoice_payload: inv.body.payload}});
  assert.deepEqual(calls('answerPreCheckoutQuery').map(c => c.body.ok), [false, false, true]);
  assert.equal(ent(BUYER), undefined, 'nothing is granted before successful_payment');
  await hook({message: {message_id: 3, from: {id: BUYER}, chat: {id: BUYER, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: inv.body.payload, telegram_payment_charge_id: 'stxCHARGE1', provider_payment_charge_id: ''}}});
  const e = ent(BUYER);
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, clock + 30 * DAY); assert.deepEqual(e.chats, [GROUP, GROUP2]);
  const notice = calls('sendMessage').at(-1).body;
  assert.equal(notice.chat_id, BUYER); assert.equal(notice.reply_markup.inline_keyboard.length, 2);
  // A redelivered payment does not grant twice.
  const before = JSON.stringify(ent(BUYER));
  await hook({message: {message_id: 3, from: {id: BUYER}, chat: {id: BUYER, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: inv.body.payload, telegram_payment_charge_id: 'stxCHARGE1', provider_payment_charge_id: ''}}});
  assert.equal(JSON.stringify(ent(BUYER)), before);
});

let question;
await test('join (DM fallback): a paid member gets the button, then a question; the right answer approves', async () => {
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP, type: 'supergroup', title: 'VIP本編'}, from: {id: BUYER}, user_chat_id: BUYER, date: 1}});
  const dm = calls('sendMessage')[0].body;
  assert.equal(dm.chat_id, BUYER); assert.equal(dm.reply_markup.inline_keyboard[0][0].callback_data, `jv/${GROUP}/b`);
  assert.equal(calls('approveChatJoinRequest').length, 0, 'not approved before verification');
  await hook({callback_query: {id: 'v1', from: {id: BUYER}, message: {message_id: 7, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP}/b`}});
  const q = calls('sendMessage')[1].body;
  question = q.text.replace('質問: ', '');
  assert.ok(QUESTIONS.some(x => x.q === question));
  assert.ok(!JSON.stringify(q).includes('"answer'), 'no answer leaks to the client');
  await hook({callback_query: {id: 'v2', from: {id: BUYER}, message: {message_id: 8, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP}/q/${answerFor(question)}`}});
  assert.deepEqual(calls('approveChatJoinRequest').map(c => c.body), [{chat_id: GROUP, user_id: BUYER}]);
  assert.equal(memberStore().get(`jr:${GROUP}:${BUYER}`).state, 'approved');
});

await test('join: someone who has not paid is declined at once, with no DM; an unmanaged group is left alone', async () => {
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP, type: 'supergroup'}, from: {id: STRANGER}, user_chat_id: STRANGER, date: 1}});
  assert.deepEqual(api.map(c => c.method), ['declineChatJoinRequest']);
  api = [];
  await hook({chat_join_request: {chat: {id: OTHER_GROUP, type: 'supergroup'}, from: {id: STRANGER}, user_chat_id: STRANGER, date: 1}});
  assert.equal(api.length, 0);
});

await test('verify (DM): a wrong answer declines', async () => {
  // BUYER on the second group this time.
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 1}});
  await hook({callback_query: {id: 'w1', from: {id: BUYER}, message: {message_id: 9, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/b`}});
  const q = calls('sendMessage')[1].body.text.replace('質問: ', '');
  const wrong = (answerFor(q) + 1) % 3;
  await hook({callback_query: {id: 'w2', from: {id: BUYER}, message: {message_id: 10, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/q/${wrong}`}});
  assert.deepEqual(calls('declineChatJoinRequest').map(c => c.body), [{chat_id: GROUP2, user_id: BUYER}]);
  assert.equal(calls('approveChatJoinRequest').length, 0);
  // A late press on the closed check changes nothing.
  await hook({callback_query: {id: 'w3', from: {id: BUYER}, message: {message_id: 10, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/q/${answerFor(q)}`}});
  assert.equal(calls('approveChatJoinRequest').length, 0);
});

await test('verify (DM): no answer within 3 minutes → the cron declines it; a press after the deadline cannot approve', async () => {
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 2}});
  await hook({callback_query: {id: 't1', from: {id: BUYER}, message: {message_id: 11, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/b`}});
  clock += 181000;
  await cron();
  assert.deepEqual(calls('declineChatJoinRequest').map(c => c.body), [{chat_id: GROUP2, user_id: BUYER}]);
  assert.equal(memberStore().get(`jr:${GROUP2}:${BUYER}`).decision.condition, 'verification_timeout');
  await hook({callback_query: {id: 't2', from: {id: BUYER}, message: {message_id: 12, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/q/0`}});
  assert.equal(calls('approveChatJoinRequest').length, 0);
});

await test('verify (guard bot, 10.1): query_id → Mini App; signed initData + right answer → answerChatJoinRequestQuery(approve)', async () => {
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 3, query_id: 'jrq-ok-1'}});
  const wa = calls('sendChatJoinRequestWebApp')[0].body;
  assert.deepEqual(wa, {chat_join_request_query_id: 'jrq-ok-1', web_app_url: `${ORIGIN}/verify`});
  assert.equal(calls('sendMessage').length, 0, 'no DM when the Mini App path works');
  const page = await worker.fetch(new Request(`${ORIGIN}/verify`), env, ctx);
  assert.equal(page.status, 200); assert.match(await page.text(), /ロボットではありません/);
  const initData = await signInitData({auth_date: String(Math.floor(clock / 1000)), user: JSON.stringify({id: BUYER, first_name: 'T'}), chat_join_request_query_id: 'jrq-ok-1'}, TOKEN);
  const forged = await signInitData({auth_date: String(Math.floor(clock / 1000)), user: JSON.stringify({id: STRANGER, first_name: 'X'}), chat_join_request_query_id: 'jrq-ok-1'}, '111:OTHER-TOKEN-NOT-REAL');
  assert.deepEqual(await verifyApi('start', {initData: forged}), {ok: false, error: 'unauthorized'});
  const start = await verifyApi('start', {initData});
  assert.equal(start.ok, true); assert.equal(start.choices.length, 3); assert.ok(!('answer' in start));
  const done = await verifyApi('answer', {initData, choice: answerFor(start.q)});
  assert.deepEqual(done, {ok: true, approved: true});
  assert.deepEqual(calls('answerChatJoinRequestQuery').map(c => c.body), [{chat_join_request_query_id: 'jrq-ok-1', result: 'approve'}]);
});

await test('verify (guard bot): wrong answer → decline; an unpaid query is declined without the Mini App', async () => {
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 4, query_id: 'jrq-ng-1'}});
  const initData = await signInitData({auth_date: String(Math.floor(clock / 1000)), user: JSON.stringify({id: BUYER}), chat_join_request_query_id: 'jrq-ng-1'}, TOKEN);
  const start = await verifyApi('start', {initData});
  assert.deepEqual(await verifyApi('answer', {initData, choice: (answerFor(start.q) + 2) % 3}), {ok: true, approved: false});
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: STRANGER}, user_chat_id: STRANGER, date: 4, query_id: 'jrq-ng-2'}});
  assert.deepEqual(calls('answerChatJoinRequestQuery').map(c => c.body.result), ['decline', 'decline']);
  assert.equal(calls('sendChatJoinRequestWebApp').length, 1);
});

await test('verify: when the Mini App cannot be shown (10.1 unavailable), it falls back to the DM check', async () => {
  api = [];
  fail.sendChatJoinRequestWebApp = 400;
  await hook({chat_join_request: {chat: {id: GROUP2, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 5, query_id: 'jrq-fb-1'}});
  assert.equal(calls('sendMessage')[0].body.reply_markup.inline_keyboard[0][0].callback_data, `jv/${GROUP2}/b`);
  await hook({callback_query: {id: 'f1', from: {id: BUYER}, message: {message_id: 13, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/b`}});
  const q = calls('sendMessage')[1].body.text.replace('質問: ', '');
  await hook({callback_query: {id: 'f2', from: {id: BUYER}, message: {message_id: 14, chat: {id: BUYER, type: 'private'}}, data: `jv/${GROUP2}/q/${answerFor(q)}`}});
  // The query still gets its answer, through the method that matches it.
  assert.deepEqual(calls('answerChatJoinRequestQuery').map(c => c.body), [{chat_join_request_query_id: 'jrq-fb-1', result: 'approve'}]);
});

await test('expiry: the cron removes an expired member from every group with ban→unban, once', async () => {
  api = [];
  clock = ent(BUYER).expiresAt - 1000;
  await cron();
  assert.equal(calls('banChatMember').length, 0, 'not before the term ends');
  clock += 2000;
  await cron();
  assert.deepEqual(calls('banChatMember').map(c => c.body.chat_id), [GROUP, GROUP2]);
  assert.deepEqual(calls('unbanChatMember').map(c => [c.body.chat_id, c.body.only_if_banned]), [[GROUP, true], [GROUP2, true]]);
  assert.equal(ent(BUYER).state, 'expired');
  await cron();
  assert.equal(calls('banChatMember').length, 2, 'no second removal');
  // And now the join request is declined.
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP, type: 'supergroup'}, from: {id: BUYER}, user_chat_id: BUYER, date: 6}});
  assert.deepEqual(api.map(c => c.method), ['declineChatJoinRequest']);
});

await test('removal that fails in Telegram is retried by the next cron, and the expiry itself is not undone', async () => {
  // A second buyer, granted through a direct event, then expired with a failing first ban.
  const svc = env.CHAT.getByName('membership:main');
  api = [];
  await hook({callback_query: {id: 'cq9', from: {id: BUYER2}, message: {message_id: 2, chat: {id: BUYER2, type: 'private'}}, data: 'pay/vip30/telegram_stars'}});
  const payload = calls('sendInvoice')[0].body.payload;
  await hook({message: {message_id: 3, from: {id: BUYER2}, chat: {id: BUYER2, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: payload, telegram_payment_charge_id: 'stxCHARGE2', provider_payment_charge_id: ''}}});
  clock = ent(BUYER2).expiresAt + 1;
  api = [];
  fail.banChatMember = 500;
  await cron();
  assert.equal(ent(BUYER2).state, 'expired');
  assert.deepEqual(ent(BUYER2).removal.chats, [GROUP]);
  await cron();
  assert.deepEqual(ent(BUYER2).removal.chats, []);
  assert.equal(calls('unbanChatMember').length, 2);
  void svc;
});

await test('subscription: renewal extends to subscription_expiration_date; failed → grace; canceled keeps the paid period; refund revokes and removes', async () => {
  api = [];
  await hook({callback_query: {id: 'cs1', from: {id: BUYER3}, message: {message_id: 2, chat: {id: BUYER3, type: 'private'}}, data: 'pay/vipsub/telegram_stars'}});
  const link = calls('createInvoiceLink')[0].body;
  assert.equal(link.subscription_period, 2592000);
  assert.equal(calls('sendMessage')[0].body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/$TEST_INVOICE_LINK');
  const t0 = Math.floor(clock / 1000);
  const pay = (charge, extra, date) => hook({message: {message_id: 3, from: {id: BUYER3}, chat: {id: BUYER3, type: 'private'}, date,
    successful_payment: {currency: 'XTR', total_amount: 300, invoice_payload: link.payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '', ...extra}}});
  await pay('stxSUB1', {is_recurring: true, is_first_recurring: true, subscription_expiration_date: t0 + 2592000}, t0);
  assert.equal(ent(BUYER3).expiresAt, (t0 + 2592000) * 1000); assert.equal(ent(BUYER3).autoRenew, true);
  await pay('stxSUB2', {is_recurring: true, subscription_expiration_date: t0 + 2 * 2592000}, t0 + 2592000);
  assert.equal(ent(BUYER3).expiresAt, (t0 + 2 * 2592000) * 1000);
  await hook({subscription: {user: {id: BUYER3}, invoice_payload: link.payload, state: 'failed'}});
  assert.equal(ent(BUYER3).state, 'grace');
  await hook({subscription: {user: {id: BUYER3}, invoice_payload: link.payload, state: 'canceled'}});
  assert.equal(ent(BUYER3).autoRenew, false); assert.equal(ent(BUYER3).state, 'grace');
  // Owner refund: no preset covers it, so it waits for approval; approving it calls refundStarPayment.
  api = [];
  const orderOf = link.payload.slice(2);
  const r = await admin('refund', {orderId: orderOf});
  assert.equal(r.status, 'pending_approval'); assert.equal(api.length, 0);
  const done = await admin('approve', {id: r.approvalId});
  assert.equal(done.status, 'executed');
  assert.deepEqual(calls('refundStarPayment').map(c => c.body), [{user_id: BUYER3, telegram_payment_charge_id: 'stxSUB1'}]);
  assert.equal(ent(BUYER3).state, 'grace', 'nothing is revoked until Telegram confirms the refund');
  await hook({message: {message_id: 4, from: {id: BUYER3}, chat: {id: BUYER3, type: 'private'}, date: t0 + 2592100,
    refunded_payment: {currency: 'XTR', total_amount: 300, invoice_payload: link.payload, telegram_payment_charge_id: 'stxSUB1'}}});
  // Only the first charge was refunded: its 30 days are taken back, the renewal's period stays.
  assert.equal(ent(BUYER3).state, 'grace');
  assert.equal(calls('banChatMember').length, 0);
  await hook({message: {message_id: 5, from: {id: BUYER3}, chat: {id: BUYER3, type: 'private'}, date: t0 + 2592200,
    refunded_payment: {currency: 'XTR', total_amount: 300, invoice_payload: link.payload, telegram_payment_charge_id: 'stxSUB2'}}});
  assert.equal(ent(BUYER3).state, 'revoked');
  assert.deepEqual(calls('banChatMember').map(c => c.body.user_id), [BUYER3, BUYER3]);
  assert.equal(calls('unbanChatMember').length, 2);
});

await test('cancel: owner cancel of a Stars subscription → editUserStarSubscription(is_canceled=true) after approval', async () => {
  api = [];
  clock += DAY;
  await hook({callback_query: {id: 'cs2', from: {id: BUYER}, message: {message_id: 2, chat: {id: BUYER, type: 'private'}}, data: 'pay/vipsub/telegram_stars'}});
  const payload = calls('createInvoiceLink')[0].body.payload;
  const t0 = Math.floor(clock / 1000);
  await hook({message: {message_id: 5, from: {id: BUYER}, chat: {id: BUYER, type: 'private'}, date: t0,
    successful_payment: {currency: 'XTR', total_amount: 300, invoice_payload: payload, telegram_payment_charge_id: 'stxSUB9', provider_payment_charge_id: '', is_recurring: true, is_first_recurring: true, subscription_expiration_date: t0 + 2592000}}});
  const r = await admin('cancel', {orderId: payload.slice(2)});
  assert.equal(r.status, 'pending_approval');
  await admin('approve', {id: r.approvalId});
  assert.deepEqual(calls('editUserStarSubscription').map(c => c.body), [{user_id: BUYER, telegram_payment_charge_id: 'stxSUB9', is_canceled: true}]);
  // Stays a member until the paid period ends, then the cron removes them.
  assert.equal(ent(BUYER).state, 'active');
  clock = (t0 + 2592000) * 1000 + 1;
  api = [];
  await cron();
  assert.equal(ent(BUYER).state, 'expired');
  assert.equal(calls('banChatMember').length, 2);
});

await test('without rules nothing is automatic: a join request and a removal both wait in the approval queue', async () => {
  const rules = await admin('rules');
  for (const r of rules.filter(r => r.enabled)) await admin('rule_disable', {id: r.id});
  assert.equal((await admin('rules')).filter(r => r.enabled).length, 0);
  api = [];
  await hook({chat_join_request: {chat: {id: GROUP, type: 'supergroup'}, from: {id: STRANGER}, user_chat_id: STRANGER, date: 7}});
  await hook({pre_checkout_query: {id: 'pcq9', from: {id: STRANGER}, currency: 'XTR', total_amount: 500, invoice_payload: 'o:nope'}});
  assert.equal(api.length, 0);
  const q = await admin('approvals');
  assert.ok(q.some(a => a.method === 'declineChatJoinRequest') && q.some(a => a.method === 'answerPreCheckoutQuery'));
  for (const r of rules) await admin('rule_add', {preset: r.preset});
});

// =====================================================================================
// 6 + 7. Rich-message pay button → external checkout → webhook → membership; §6.2 guard
// =====================================================================================
await test('pay button on a physical-service plan → Stripe checkout URL → signed webhook → paid → granted', async () => {
  api = []; stripeCalls = [];
  let data = 'pay/seat1/stripe';
  if (richmsg?.compile) {
    const draft = {title: 't', media: {kind: 'none', url: ''}, blocks: [{kind: 'text', text: '座席予約'}],
      buttons: [[{kind: 'pay', label: '💳 ¥3,000 を支払う', skuId: 'seat1', provider: 'stripe'}]], options: {}};
    const catalog = {skus: {seat1: {title: '1回', amount: 3000, currency: 'JPY', goodsKind: 'physical_service'}}, providers: [{id: 'stripe', configured: true}, {id: 'telegram_stars', configured: true}]};
    const c = richmsg.compile(draft, {chatId: BUYER2, catalog});
    assert.deepEqual(c.errors ?? [], []);
    data = JSON.stringify(c).match(/pay\/seat1\/stripe/)?.[0];
    assert.equal(data, 'pay/seat1/stripe');
  }
  await hook({callback_query: {id: 'p1', from: {id: BUYER2}, message: {message_id: 2, chat: {id: BUYER2, type: 'private'}}, data}});
  assert.equal(stripeCalls.length, 1);
  assert.match(String(stripeCalls[0].init.body), /client_reference_id=o/);
  const msg = calls('sendMessage')[0].body;
  assert.equal(msg.reply_markup.inline_keyboard[0][0].url, 'https://checkout.stripe.invalid/c/cs_test_mock1');
  const order = [...memberStore().entries()].find(([k, v]) => k.startsWith('order:') && v.provider === 'stripe')[1];
  const raw = JSON.stringify({id: 'evt_mock_1', type: 'checkout.session.completed', created: Math.floor(clock / 1000),
    data: {object: {id: 'cs_test_mock1', client_reference_id: order.id, payment_status: 'paid', amount_total: 3000, currency: 'jpy', payment_intent: 'pi_mock',
      metadata: {order_id: order.id, telegram_user_id: String(BUYER2), tenant_id: 'main'}}}});
  const t = Math.floor(clock / 1000);
  const bad = await worker.fetch(new Request(`${ORIGIN}/pay/stripe`, {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${'0'.repeat(64)}`}, body: raw}), env, ctx);
  assert.equal(bad.status, 400);
  assert.equal(ent(BUYER2, 'seat'), undefined);
  const sig = await hmacHex(STRIPE_WH, `${t}.${raw}`);
  const ok = await worker.fetch(new Request(`${ORIGIN}/pay/stripe`, {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${sig}`}, body: raw}), env, ctx);
  assert.equal(ok.status, 200);
  assert.equal(ent(BUYER2, 'seat').state, 'active'); assert.equal(ent(BUYER2, 'seat').expiresAt, null);
});

await test('§6.2 guard: a digital plan cannot be bought through Stripe, and a physical one not through Stars; KOMOJU unset is refused', async () => {
  api = []; stripeCalls = [];
  await hook({callback_query: {id: 'g1', from: {id: BUYER2}, message: {message_id: 2, chat: {id: BUYER2, type: 'private'}}, data: 'pay/vip30/stripe'}});
  await hook({callback_query: {id: 'g2', from: {id: BUYER2}, message: {message_id: 2, chat: {id: BUYER2, type: 'private'}}, data: 'pay/seat1/telegram_stars'}});
  await hook({callback_query: {id: 'g3', from: {id: BUYER2}, message: {message_id: 2, chat: {id: BUYER2, type: 'private'}}, data: 'pay/seat1/komoju'}});
  assert.equal(stripeCalls.length, 0);
  assert.equal(calls('sendInvoice').length + calls('createInvoiceLink').length, 0);
  assert.deepEqual(calls('answerCallbackQuery').map(c => c.body.text), ['この支払い方法は使えません', 'この支払い方法は使えません', 'この支払い方法は使えません']);
  const refused = (await admin('audit', {limit: 1000})).filter(a => a.kind === 'checkout_refused').map(a => a.error);
  assert.ok(refused.includes('digital_goods_require_stars') && refused.includes('stars_only_for_digital') && refused.includes('provider_not_configured'));
});

await test('out-of-order: a refund that arrives before the payment means the payment never grants', async () => {
  api = [];
  clock += DAY;
  await hook({callback_query: {id: 'oo1', from: {id: STRANGER}, message: {message_id: 2, chat: {id: STRANGER, type: 'private'}}, data: 'pay/vip30/telegram_stars'}});
  const payload = calls('sendInvoice')[0].body.payload;
  const d = Math.floor(clock / 1000);
  await hook({message: {message_id: 6, from: {id: STRANGER}, chat: {id: STRANGER, type: 'private'}, date: d, refunded_payment: {currency: 'XTR', total_amount: 500, invoice_payload: payload, telegram_payment_charge_id: 'stxOO'}}});
  await hook({message: {message_id: 7, from: {id: STRANGER}, chat: {id: STRANGER, type: 'private'}, date: d, successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: payload, telegram_payment_charge_id: 'stxOO', provider_payment_charge_id: ''}}});
  assert.equal(ent(STRANGER), undefined);
});

await test('rich-message template with a Stars pay button → invoice → successful_payment → member granted', async () => {
  const {TEMPLATES, TEMPLATE_PAY_SKU} = await import('../src/richmsg/templates.mjs');
  const {renderForSend} = await import('../src/richmsg/compose.mjs');
  await admin('plan_set', {plan: {id: 'tpl', title: '月額会員', goodsKind: 'digital', chats: [GROUP],
    skus: [{id: TEMPLATE_PAY_SKU, title: '30日', amount: 250, currency: 'XTR', days: 30}]}});
  const tpl = TEMPLATES.find(t => JSON.stringify(t.buttons).includes('"pay"'));
  const catalog = {skus: {[TEMPLATE_PAY_SKU]: {title: '30日', amount: 250, currency: 'XTR', goodsKind: 'digital'}}, providers: [{id: 'telegram_stars', configured: true}]};
  const out = renderForSend(tpl, {chatId: BUYER3, catalog});
  assert.equal(out.method, 'sendAnimation');
  const data = out.params.reply_markup.inline_keyboard.flat().find(b => String(b.callback_data).startsWith('pay/')).callback_data;
  assert.equal(data, `pay/${TEMPLATE_PAY_SKU}/telegram_stars`);
  api = [];
  await hook({callback_query: {id: 'tp1', from: {id: BUYER3}, message: {message_id: 2, chat: {id: BUYER3, type: 'private'}}, data}});
  const inv = calls('sendInvoice')[0].body;
  assert.equal(inv.prices[0].amount, 250);
  await hook({pre_checkout_query: {id: 'tpq', from: {id: BUYER3}, currency: 'XTR', total_amount: 250, invoice_payload: inv.payload}});
  assert.equal(calls('answerPreCheckoutQuery')[0].body.ok, true);
  await hook({message: {message_id: 8, from: {id: BUYER3}, chat: {id: BUYER3, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 250, invoice_payload: inv.payload, telegram_payment_charge_id: 'stxTPL', provider_payment_charge_id: ''}}});
  assert.equal(ent(BUYER3, 'tpl').state, 'active');
});

await test('every automatic and queued write is in the audit log; nothing logged carries a token, a secret or a raw id', async () => {
  const log = await admin('audit', {limit: 1000});
  const kinds = new Set(log.map(l => l.kind));
  for (const k of ['rule_added', 'rule_disabled', 'executed', 'queued', 'entitlement_granted', 'entitlement_ended', 'payment_event', 'cron']) assert.ok(kinds.has(k), k);
  assert.ok(log.filter(l => l.kind === 'executed').every(l => l.via?.startsWith('rule:') || l.via?.startsWith('approval:')));
  for (const line of logs) for (const s of [TOKEN, SECRET, ADMIN, STRIPE_KEY, STRIPE_WH, String(BUYER), String(GROUP)]) assert.ok(!line.includes(s), 'leak in log');
});

Date.now = realNow;
console.log = realLog;
console.log(JSON.stringify({suite: 'membership', passed: true, tests: pass, results}, null, 1));
