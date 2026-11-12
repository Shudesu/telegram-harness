// t78u: /start guided tour, all-in-widget booking, widget gallery (Bot API 10.4), Mini App payment.
// Telegram and the Durable Object runtime are stubs: no network, no real token, no real chat id.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(HERE, '../assets');
const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const SECRET = 'test-webhook-secret-value';
const MKEY = 'ab'.repeat(32);
const MANAGED_TOKEN = '7000000001:MANAGED-TOKEN-NOT-REAL';
const CHAT = 70000001, MBOT = 7000000001;

const {ChatSession} = await import('../src/chat.mjs');
const worker = (await import('../src/index.mjs')).default;
const {BOT} = await import('../src/schema.mjs');
const W = await import('../src/widget.mjs');
const M = await import('../src/managed.mjs');
const X = await import('../src/extras.mjs');

let api = [], fail = {}, canManage = true, msgSeq = 5000; // message ids are unique per chat, as in Telegram
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const managed = u.startsWith(`https://api.telegram.org/bot${MANAGED_TOKEN}/`);
  if (!managed && !u.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw Error('unexpected_host');
  const method = u.split('/').pop();
  const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
  api.push({method, body, managed});
  if (fail[method]) { const code = fail[method]; delete fail[method]; return Response.json({ok: false, error_code: code, description: 'stub'}, {status: code}); }
  let result = true;
  if (method === 'getMe') result = {id: BOT, is_bot: true, username: 'teleharness_bot', can_manage_bots: canManage};
  else if (method === 'getManagedBotToken') result = MANAGED_TOKEN;
  else if (method === 'createInvoiceLink') result = 'https://t.me/$TEST-INVOICE-LINK';
  else if (/^send/.test(method)) result = {chat: {id: Number(body.chat_id)}, message_id: ++msgSeq, ...(method === 'sendWidget' ? {widget: {html: body.html}} : {})};
  return Response.json({ok: true, result});
};

function makeCtx(store, name) {
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async delete(k) { return store.delete(k); },
      async list({prefix = ''} = {}) { return new Map([...store].filter(([k]) => k.startsWith(prefix)).sort().map(([k, v]) => [k, structuredClone(v)])); },
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
    _store(name) { return stores.get(name); },
    _journal(name) { return stores.get(name)?.get('journal'); },
  };
}
const envRef = {};
const env = {
  BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, MANAGED_BOT_KEY: MKEY, SEED_FILE_IDS: '{}', SEED_OPTINS: '{}',
  ASSETS: {async fetch(url) { const p = path.join(ASSET_DIR, new URL(String(url)).pathname.slice(1)); return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response('nf', {status: 404}); }},
};
envRef.env = env;
env.CHAT = makeNamespace(envRef);

const pending = [];
const ctx = {waitUntil: p => pending.push(p)};
const settle = async () => { while (pending.length) await pending.shift(); };
const post = (pathname, body, secret = SECRET) => worker.fetch(new Request('https://w.invalid' + pathname, {
  method: 'POST', headers: {'content-type': 'application/json', ...(secret === null ? {} : {'x-telegram-bot-api-secret-token': secret})}, body: JSON.stringify(body),
}), env, ctx);
let id = 20000;
const secs = () => Math.floor(Date.now() / 1000);
const msg = (text, chat = CHAT, extra = {}) => ({update_id: ++id, message: {message_id: id, date: secs(), chat: {id: chat, type: 'private'}, from: {id: chat, is_bot: false}, ...(text === null ? {} : {text}), ...extra}});
const press = (data, chat = CHAT) => ({update_id: ++id, callback_query: {id: 'cb' + id, data, from: {id: chat, is_bot: false}, message: {message_id: id, date: secs(), chat: {id: chat, type: 'private'}, from: {id: BOT}}}});
const wq = (data, messageId, chat = CHAT) => ({update_id: ++id, widget_query: {id: 'wq' + id, from: {id: chat, is_bot: false}, chat: {id: chat, type: 'private'}, message_id: messageId, chat_instance: '1', type: {type: 'data'}, data}});
const feed = async u => { api = []; const r = await post('/webhook', u); await settle(); return r; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const journal = (chat = CHAT) => env.CHAT._journal(`chat:${chat}`);

let pass = 0; const results = [];
async function test(name, fn) { await fn(); pass++; results.push(name); }

const S = await import('../src/studio/widgets.mjs');
const F = await import('../src/studio/flow.mjs');
// Time is advanced instead of slept: the 1.5 s per-chat send gap and the engine caps read Date.now.
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
const skip = (ms = 1600) => { skew += ms; };
const zlen = html => Number(execFileSync('python3', ['-I', '-c', 'import sys,zlib;print(len(zlib.compress(sys.stdin.buffer.read(),9)))'], {input: html}).toString());
const byKind = (k, chat = CHAT) => Number(Object.entries(journal(chat)?.t63u?.widgets ?? {}).filter(([, w]) => w.kind === k).sort((a, b) => b[1].at - a[1].at || b[0] - a[0])[0]?.[0]);
const methods = () => api.map(x => x.method);
const dataOf = call => JSON.parse(call.body.chat_data || 'null');

await test('every widget kind fits the Bot API limits and the widget profile', async () => {
  const sizes = [];
  for (const k of Object.keys(S.KINDS)) {
    const html = S.html(k, null, Date.parse('2026-11-11T03:00:00Z'));
    const raw = Buffer.byteLength(html), z = zlen(html);
    assert.ok(raw <= 32768 && z <= 4096, `${k} raw=${raw} z=${z}`);
    assert.ok(!html.includes('\u0000'), k);
    assert.ok(!/<(input|select|textarea|iframe|link|meta|video|audio|img)\b|src=|https?:\/\/|\dvh\b|overflow:\s*(auto|scroll)|position:\s*sticky|@import|@font-face|alert\(|confirm\(|prompt\(/.test(html), k);
    // Theme: Telegram palette first, light-dark() fallback for both schemes.
    assert.ok(html.includes('var(--tg-theme-bg-color') && html.includes('light-dark(') && html.includes('color-scheme:light dark'), k);
    assert.ok(html.includes("onEvent('chatDataChanged'") && html.includes('window.TelegramWidget'), k);
    sizes.push(`${k}=${z}`);
  }
  assert.ok(Object.keys(S.KINDS).length >= 13 && S.GALLERY.length >= 12);
  results.push('zlib9 ' + sizes.join(' '));
});

await test('every widget script parses as JavaScript', async () => {
  for (const k of Object.keys(S.KINDS)) {
    const js = /<script>([\s\S]*)<\/script>/.exec(S.html(k))[1];
    assert.doesNotThrow(() => new Function(js), k);
  }
});

await test('chat_data stays within 1024 bytes for the largest states', async () => {
  const big = [{r: 'TEST-B-ABCDEF', i: 8, v: 1, p: 1, d: 2, t: 5, st: 'cx'}, {s: 5, x: 63, d: 1}, {c: [999, 999, 999, 999], m: 3}, {n: 10, cp: 'TEST-C-ABCDEF'},
    {no: 'TH-ABCD-EF01', pl: 'スタンダード', until: '2026/12/11', pt: 120}, {at: 1800000000000, lb: 'キャバクラ・11/14(土) 22:30'}];
  for (const d of big) assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 1024);
});

let tourMsg;
await test('/start: welcome + 2x3 keyboard, then the tour widget at 1/6 with its annotation and buttons', async () => {
  await feed(msg('/start'));
  assert.deepEqual(methods(), ['sendMessage', 'sendWidget']);
  assert.equal(api[0].body.parse_mode, 'HTML');
  assert.ok(api[0].body.text.includes('ようこそ'));
  const w = api[1].body;
  assert.ok(w.caption.includes('1/6') && w.caption.includes('👉'));
  assert.deepEqual(JSON.parse(w.chat_data), {s: 0, x: 0, d: 0});
  assert.deepEqual(w.reply_markup.inline_keyboard.flat().map(b => b.callback_data), ['tu:p', 'tu:g', 'tu:n', 'tu:k', 'tu:0']);
  tourMsg = byKind('tu');
  assert.ok(journal().optins[`${CHAT}:${CHAT}`]);
});

await test('tour: 次へ walks 1/6 → 6/6 → done, each step edits the widget data and the caption (no new message)', async () => {
  for (let k = 1; k < S.TOUR.length; k++) {
    await feed(wq('n', tourMsg));
    assert.deepEqual(methods(), ['editMessageWidgetData', 'editMessageCaption', 'answerWidgetQuery']);
    assert.equal(dataOf(api[0]).s, k);
    assert.ok(api[1].body.caption.includes(`${k + 1}/6`) && api[1].body.caption.includes(S.TOUR[k].t));
  }
  await feed(wq('n', tourMsg));
  assert.equal(dataOf(api[0]).d, 1);
  assert.ok(api[1].body.caption.includes('ガイド完了'));
});

await test('tour: 最初から resets, 戻る never goes below 1/6, スキップ finishes', async () => {
  await feed(wq('0', tourMsg)); assert.deepEqual(dataOf(api[0]), {s: 0, x: 0, d: 0});
  await feed(wq('p', tourMsg)); assert.equal(dataOf(api[0]).s, 0);
  await feed(wq('n', tourMsg)); await feed(wq('n', tourMsg)); assert.equal(dataOf(api[0]).s, 2);
  await feed(wq('p', tourMsg)); assert.equal(dataOf(api[0]).s, 1);
  await feed(wq('k', tourMsg)); assert.equal(dataOf(api[0]).d, 1);
  await feed(wq('0', tourMsg)); assert.equal(dataOf(api[0]).d, 0);
});

await test('tour: the inline buttons (for clients without widgets) drive the same state', async () => {
  const pressOn = (data, mid) => { const u = press(data); u.callback_query.message.message_id = mid; return u; };
  await feed(pressOn('tu:n', tourMsg));
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageWidgetData', 'editMessageCaption']);
  assert.equal(dataOf(api[1]).s, 1);
  await feed(pressOn('tu:p', tourMsg)); assert.equal(dataOf(api[1]).s, 0);
});

await test('tour: 体験 on every step performs that feature and ticks the step', async () => {
  const expect = [['bk'], ['pl'], ['legacy'], ['fq'], ['newbot'], ['da']];
  for (let k = 0; k < S.TOUR.length; k++) {
    skip();
    await feed(wq('g', tourMsg));
    const sent = api.filter(x => x.method === 'sendWidget');
    if (['bk', 'pl', 'fq', 'da'].includes(expect[k][0])) {
      assert.equal(sent.length, 1, `step ${k}`);
      assert.equal(journal().t63u.widgets[byKind(expect[k][0])].kind, expect[k][0]);
    } else if (expect[k][0] === 'legacy') {
      assert.ok(api.some(x => x.method === 'sendAnimation' || x.method === 'sendMessage'), 'the engine compose page');
    } else {
      assert.ok(api.some(x => x.method === 'getMe' || x.method === 'sendMessage'), 'newbot prompt');
    }
    assert.ok(journal().studio.tour.x & (1 << k));
    await feed(wq('n', tourMsg));
  }
  assert.equal(journal().studio.tour.d, 1);
  assert.equal(journal().studio.tour.x, 63);
});

await test('/start in the middle of the tour resumes at the saved step', async () => {
  await feed(wq('0', tourMsg)); await feed(wq('n', tourMsg)); await feed(wq('n', tourMsg));
  skip();
  await feed(msg('/start'));
  assert.deepEqual(methods(), ['sendMessage', 'sendWidget']);
  assert.ok(api[1].body.caption.includes('前回の続き（3/6）'));
  assert.equal(JSON.parse(api[1].body.chat_data).s, 2);
  tourMsg = byKind('tu');
});

let bk;
await test('booking: the whole flow stays in one card — confirm, lookup, cancel, new — via editMessageWidgetData only', async () => {
  skip();
  await feed(msg('📅 予約'));
  assert.deepEqual(methods(), ['sendWidget']);
  bk = byKind('bk');
  const html = api[0].body.html;
  for (const step of S.BOOK_STEPS) assert.ok(html.includes(step), step);
  await feed(wq('b40121', bk));     // キャバクラ, service 0, staff 1, day 2, slot 1
  assert.deepEqual(methods(), ['editMessageWidgetData', 'answerWidgetQuery']);
  const st = dataOf(api[0]);
  assert.deepEqual([st.i, st.v, st.p, st.d, st.t, st.st], [4, 0, 1, 2, 1, 'ok']);
  assert.equal(journal().studio.booking.r, st.r);
  await feed(wq('l', bk));
  assert.deepEqual(methods(), ['answerWidgetQuery']);
  assert.match(JSON.parse(api[0].body.data).l, /^有効/);
  await feed(wq('x', bk));
  assert.equal(dataOf(api[0]).st, 'cx');
  await feed(wq('l', bk)); assert.match(JSON.parse(api[0].body.data).l, /^取消済み/);
  await feed(wq('x', bk)); assert.ok(JSON.parse(api[0].body.data).e, 'cannot cancel twice');
  await feed(wq('r', bk)); assert.equal(api[0].body.chat_data, '');
  await feed(wq('b10000', bk)); assert.equal(dataOf(api[0]).i, 1);
  assert.ok(api.every(x => !x.method.startsWith('send')), 'no new message during the flow');
});

await test('booking: invalid choices are refused (staff/service that does not exist, bad shape)', async () => {
  await feed(wq('r', bk));
  for (const d of ['b50100', 'b0x000', 'b000099', 'b00030', 'zz']) {  // host club has one staff; d=3 out of range
    await feed(wq(d, bk));
    assert.deepEqual(methods(), ['answerWidgetQuery'], d);
    assert.ok(JSON.parse(api[0].body.data).e, d);
  }
});

await test('booking: a client without widgets falls back to the button version (engine)', async () => {
  skip(); fail.sendWidget = 400;
  await feed(msg('/book'));
  assert.equal(api[0].method, 'sendWidget');
  assert.ok(api.slice(1).some(x => ['sendMessage', 'sendAnimation'].includes(x.method)));
  skip();
  await feed(press('wfb'));
  assert.equal(api[0].method, 'answerCallbackQuery');
});

await test('tour: without widget support it arrives as text and steps edit that text', async () => {
  skip(); fail.sendWidget = 400;
  await feed(msg('/tour'));
  assert.deepEqual(methods(), ['sendWidget', 'sendMessage']);
  const mid = byKind('tu');
  assert.ok(journal().t63u.widgets[mid].fb);
  const u = press('tu:n'); u.callback_query.message.message_id = mid;
  await feed(u);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

await test('/widgets: gallery of 12; each tile (widget request and inline button) delivers its widget', async () => {
  skip();
  await feed(msg('/widgets'));
  assert.deepEqual(methods(), ['sendWidget']);
  assert.equal(api[0].body.reply_markup.inline_keyboard.flat().length, S.GALLERY.length);
  const ga = byKind('ga');
  for (let k = 0; k < S.GALLERY.length; k++) {
    skip();
    await feed(wq(`o${k}`, ga));
    assert.deepEqual(methods(), ['sendWidget', 'answerWidgetQuery'], `tile ${k}`);
    assert.equal(journal().t63u.widgets[byKind(S.GALLERY[k][0])].kind, S.GALLERY[k][0]);
  }
  skip();
  const u = press('ga:6'); u.callback_query.message.message_id = ga;
  await feed(u);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendWidget']);
  await feed(wq('o1', ga));  // too soon after the last send
  assert.ok(JSON.parse(api[0].body.data).e);
});

await test('plans (Stars test only), poll and stamp card keep their state in chat_data', async () => {
  await feed(wq('y1', byKind('pl')));
  assert.equal(dataOf(api[0]).p, 1); assert.match(dataOf(api[0]).r, /^TEST-S-/);
  assert.equal(journal().studio.member.pl, 'スタンダード');
  assert.ok(!api.some(x => /Invoice|Star/.test(x.method)), 'no invoice, no charge');
  await feed(wq('y9', byKind('pl'))); assert.equal(api[0].body.chat_data, '');
  await feed(wq('v2', byKind('vo')));
  assert.deepEqual(dataOf(api[0]), {c: [12, 9, 16, 6], m: 2});
  const sc = byKind('sc');
  for (let k = 1; k <= 5; k++) await feed(wq('s', sc));
  assert.equal(dataOf(api[0]).n, 5); assert.match(dataOf(api[0]).cp, /^TEST-C-/);
  await feed(wq('s0', sc)); assert.deepEqual(dataOf(api[0]), {n: 0});
  // The member card and countdown start from the bot's state.
  skip(); await feed(wq('o4', byKind('ga')));
  assert.equal(JSON.parse(api[0].body.chat_data).pl, 'スタンダード');
  skip(); await feed(wq('o10', byKind('ga')));
  assert.ok(JSON.parse(api[0].body.chat_data).at > Date.now());
});

await test('typed FAQ is auto-answered; 💳 opens the payment card with the Mini App button; 🎨 リッチ opens the composer', async () => {
  skip(); await feed(msg('料金は？'));
  assert.deepEqual(methods(), ['sendMessage']); assert.ok(api[0].body.text.includes('実請求はありません'));
  skip(); await feed(msg('💳 会員・決済'));
  const rows = api[0].body.reply_markup.inline_keyboard;
  assert.equal(rows[0][0].web_app.url, 'https://w.invalid/app/');
  assert.ok(api[0].body.text.includes('実請求はありません'));
  skip(); await feed(msg('🎨 リッチ'));
  assert.ok(api.length >= 1 && api.every(x => ['sendMessage', 'sendAnimation'].includes(x.method)));
});

await test('someone who never opted in: nothing but the mandatory widget answer', async () => {
  for (const u of [msg('/widgets', 555000333), msg('📅 予約', 555000333), msg('料金は？', 555000333), press('tu:n', 555000333), wq('n', tourMsg, 555000333)]) {
    await feed(u);
    assert.ok(api.every(x => x.method === 'answerWidgetQuery'), JSON.stringify(methods()));
  }
});

await test('a redelivered widget query does not act twice', async () => {
  const u = wq('v1', byKind('vo'));
  await feed(u); assert.equal(api.length, 2);
  await post('/webhook', u); api = []; await settle(); await post('/webhook', u); await settle();
  assert.equal(api.length, 0);
});

const {createHmac} = await import('node:crypto');
const A = await import('../src/studio/app.mjs');
function initData(user = {id: CHAT, first_name: 'Shu'}, auth = Math.floor(Date.now() / 1000), token = TOKEN) {
  const p = new URLSearchParams({auth_date: String(auth), query_id: 'AAH-test', user: JSON.stringify(user)});
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
const appPost = async (p, body) => { const r = await worker.fetch(new Request('https://w.invalid/app/api/' + p, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), env, ctx); return {status: r.status, body: await r.json()}; };

await test('Mini App: GET /app/ serves the page with a strict CSP, the Telegram SDK and Main/Secondary buttons', async () => {
  const r = await worker.fetch(new Request('https://w.invalid/app/'), env, ctx);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*connect-src 'self'/);
  const h = await r.text();
  assert.ok(h.includes('https://telegram.org/js/telegram-web-app.js') && h.includes('MainButton') && h.includes('SecondaryButton') && h.includes('openInvoice') && h.includes('HapticFeedback'));
  assert.ok(h.includes('準備中') && h.includes('--tg-theme-bg-color') && h.includes('light-dark('));
});

await test('Mini App: initData is verified (bad hash, other token, stale auth_date → 401)', async () => {
  assert.equal((await appPost('state', {})).status, 401);
  const good = initData();
  assert.equal((await appPost('state', {initData: good.replace(/hash=[0-9a-f]{4}/, 'hash=0000')})).status, 401);
  assert.equal((await appPost('state', {initData: initData(undefined, undefined, '1:OTHER')})).status, 401);
  assert.equal((await appPost('state', {initData: initData(undefined, Math.floor(Date.now() / 1000) - 90000)})).status, 401);
  assert.equal(A.verifyInitData(good, TOKEN).id, CHAT);
});

await test('Mini App payment flow (TEST): plans → checkout (no invoice at Telegram) → complete → member card', async () => {
  api = [];
  const st = await appPost('state', {initData: initData({id: 70000009, first_name: 'T'})});
  assert.equal(st.status, 200);
  assert.equal(st.body.plans.length, 3); assert.equal(st.body.live, false); assert.equal(st.body.member, null);
  assert.deepEqual(st.body.providers.map(p => [p.id, p.ready]), [['stripe', false], ['komoju', false], ['bank_gmo', false]]);
  const co = await appPost('checkout', {initData: initData({id: 70000009}), plan: 'standard'});
  assert.equal(co.body.mode, 'demo'); assert.equal(co.body.invoice.stars, 500); assert.match(co.body.invoice.id, /^TEST-I-/);
  assert.equal((await appPost('checkout', {initData: initData({id: 70000009}), plan: 'gold'})).status, 400);
  assert.equal((await appPost('complete', {initData: initData({id: 70000009}), plan: 'standard', invoice: 'REAL-1'})).status, 400);
  const done = await appPost('complete', {initData: initData({id: 70000009}), plan: 'standard', invoice: co.body.invoice.id});
  assert.equal(done.body.member.pl, 'スタンダード'); assert.match(done.body.member.no, /^TH-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal((await appPost('state', {initData: initData({id: 70000009})})).body.member.no, done.body.member.no);
  assert.equal(api.length, 0, 'the TEST flow makes no Bot API call at all');
});

await test('Mini App live switch (PAY_LIVE=1, off in production): goes through a membership order and its owner rule; the page cannot self-confirm', async () => {
  env.PAY_LIVE = '1'; api = [];
  assert.equal((await appPost('checkout', {initData: initData(), plan: 'light'})).status, 503, 'needs MEMBERSHIP=1');
  env.MEMBERSHIP = '1';
  const mo = env.CHAT.getByName('membership:main');
  assert.equal((await appPost('checkout', {initData: initData(), plan: 'light'})).status, 409, 'SKU app-light not registered');
  await mo.membership('admin', 'plan_set', {plan: {id: 'app', title: 'アプリ会員', goodsKind: 'digital', chats: [], skus: [{id: 'app-light', amount: 150, currency: 'XTR', days: 30, title: 'ライト'}]}});
  const queued = await appPost('checkout', {initData: initData(), plan: 'light'});
  assert.equal(queued.status, 409, 'without the owner checkout rule the invoice waits for approval');
  assert.equal(queued.body.error, 'pending_approval');
  assert.ok(!api.some(x => x.method === 'createInvoiceLink'));
  await mo.membership('admin', 'rule_add', {preset: 'checkout'});
  const co = await appPost('checkout', {initData: initData(), plan: 'light'});
  assert.equal(co.body.mode, 'live'); assert.ok(co.body.link.startsWith('https://t.me/$'));
  const inv = api.find(x => x.method === 'createInvoiceLink');
  assert.equal(inv.body.currency, 'XTR'); assert.equal(inv.body.prices[0].amount, 150); assert.match(inv.body.payload, /^o:/);
  assert.equal((await appPost('complete', {initData: initData(), plan: 'light', invoice: 'TEST-I-ABCDEF'})).status, 409);
  assert.ok(!api.some(x => x.method === 'sendMessage'), 'the Mini App opens the link itself; no extra message');
  // Before Telegram confirms the payment the live state shows no membership; afterwards the entitlement.
  assert.equal((await appPost('state', {initData: initData()})).body.member, null);
  const payload = inv.body.payload;
  await post('/webhook', {update_id: ++id, message: {message_id: ++id, date: secs(), chat: {id: CHAT, type: 'private'}, from: {id: CHAT, is_bot: false},
    successful_payment: {currency: 'XTR', total_amount: 150, invoice_payload: payload, telegram_payment_charge_id: 'stxTEST1', provider_payment_charge_id: ''}}}); await settle();
  const live = (await appPost('state', {initData: initData()})).body.member;
  assert.equal(live?.pl, 'アプリ会員'); assert.equal(live.live, true);
  delete env.PAY_LIVE; delete env.MEMBERSHIP;
});

await test('/keyboard puts the studio keyboard back (not the legacy one)', async () => {
  skip(); await feed(msg('/keyboard'));
  assert.deepEqual(methods(), ['sendMessage']);
  assert.equal(api[0].body.reply_markup.keyboard[1][1].text, '💳 会員・決済');
});

// ---------------------------------------------------------------- t80u: real Stars plans
const P = await import('../src/studio/plans.mjs');
const L = await import('../src/studio/legal.mjs');
await test('t80u: the three plans register as SKUs app-<plan> (no member group) and the Mini App/widget show the same prices', async () => {
  env.PAY_LIVE = '1'; env.MEMBERSHIP = '1';
  const mo = env.CHAT.getByName('membership:main');
  await mo.membership('admin', 'plan_set', {plan: {id: 'app', title: 'アプリ会員', goodsKind: 'digital', chats: [], skus: [], listed: false}}); // frees app-light from the earlier test
  for (const body of P.planSetPayloads()) await mo.membership('admin', 'plan_set', body);
  const plans = await mo.membership('admin', 'plans', {});
  const sku = id => plans.flatMap(p => p.skus).find(s => s.id === id);
  assert.deepEqual(['app-light', 'app-standard', 'app-premium'].map(i => [sku(i).amount, sku(i).recurring, sku(i).days, sku(i).currency]),
    [[250, false, 30, 'XTR'], [500, true, 30, 'XTR'], [1500, true, 30, 'XTR']]);
  assert.ok(plans.filter(p => p.id !== 'app').every(p => p.chats.length === 0 && p.description && p.title.startsWith(P.SALON)));
  const st = await appPost('state', {initData: initData({id: 70000031, first_name: 'N'})});
  assert.deepEqual(st.body.plans.map(p => [p.id, p.stars, p.recurring]), [['light', 250, false], ['standard', 500, true], ['premium', 1500, true]]);
  assert.equal(st.body.live, true); assert.ok(st.body.legal.tokusho.some(([k, v]) => k === '販売事業者' && v === '準備中'));
  assert.deepEqual(S.PLANS.map(p => p[1]), [250, 500, 1500]);
  const page = await (await worker.fetch(new Request('https://w.invalid/app/'), env, ctx)).text();
  assert.ok(page.includes('利用規約・特商法表記') && page.includes('/paysupport') && page.includes('次回更新'));
  assert.doesNotThrow(() => new Function(/<script>([\s\S]*)<\/script>/.exec(page.split('telegram-web-app.js"></script>')[1])[1]));
});

await test('t80u: with only the checkout rule, each plan gets a real Stars invoice link (subscription for auto-renew), nothing else is sent', async () => {
  const mo = env.CHAT.getByName('membership:main');
  assert.ok((await mo.membership('admin', 'rules', {})).some(r => r.preset === 'checkout' && r.enabled));
  const links = {};
  for (const [plan, amount, sub] of [['light', 250, false], ['standard', 500, true], ['premium', 1500, true]]) {
    api = [];
    const co = await appPost('checkout', {initData: initData({id: 70000031}), plan});
    assert.equal(co.body.mode, 'live', plan);
    assert.deepEqual(methods(), ['createInvoiceLink'], plan);
    const b = api[0].body;
    assert.equal(b.currency, 'XTR'); assert.equal(b.provider_token, ''); assert.equal(b.prices[0].amount, amount);
    assert.equal(b.subscription_period, sub ? 2592000 : undefined, plan);
    assert.ok(b.title.length <= 32 && b.description.length <= 255 && b.description.includes('30日'));
    links[plan] = b.payload;
  }
  // Paying the standard plan (Telegram's successful_payment) → membership with auto-renew; the
  // purchase notice waits for the owner (member_notice is not enabled) and nothing is sent.
  api = [];
  await post('/webhook', {update_id: ++id, message: {message_id: ++id, date: secs(), chat: {id: 70000031, type: 'private'}, from: {id: 70000031, is_bot: false},
    successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: links.standard, telegram_payment_charge_id: 'stxT80U', provider_payment_charge_id: '',
      is_recurring: true, is_first_recurring: true, subscription_expiration_date: secs() + 2592000}}}); await settle();
  assert.ok(!api.length, 'no Bot API call: the notice is queued');
  const m = (await appPost('state', {initData: initData({id: 70000031})})).body.member;
  assert.equal(m.pl, 'スタンダード'); assert.equal(m.renew, true); assert.equal(m.live, true);
  const notice = (await mo.membership('admin', 'approvals', {})).find(a => a.condition === 'member_notice');
  assert.match(notice.params.text, /準備中/); assert.ok(!notice.params.reply_markup);
});

await test('t80u: /terms and /paysupport answer even without /start; /paysupport lists only the asker\'s own orders', async () => {
  skip(); await feed(msg('/terms', 70000031));
  assert.deepEqual(methods(), ['sendMessage']);
  assert.match(api[0].body.text, /特定商取引法に基づく表記/); assert.match(api[0].body.text, /販売事業者<\/b>：準備中/); assert.equal(api[0].body.parse_mode, 'HTML');
  skip(); await feed(msg('/paysupport', 70000031));
  const t = api[0].body.text;
  const orders = await env.CHAT.getByName('membership:main').membership('app_orders', {userId: 70000031});
  const paid = orders.find(o => o.state === 'paid');
  assert.ok(t.includes(paid.id) && t.includes('支払い済み') && t.includes('⭐500'));
  assert.ok(!orders.filter(o => o.state === 'awaiting_payment').some(o => t.includes(o.id)), 'unpaid invoices are not listed');
  skip(); await feed(msg('/paysupport', 70000032));
  assert.match(api[0].body.text, /お支払い履歴はまだありません/); assert.ok(!api[0].body.text.includes(paid.id));
  assert.ok(L.termsText().length < 4096 && L.paysupportText(orders).length < 4096);
});

await test('t80u: /paysupport <text> files a ticket the owner reads (no Telegram id), max 5 a day; history keeps paid orders past unpaid ones', async () => {
  const mo = env.CHAT.getByName('membership:main');
  await feed(msg('/paysupport ' + 'あ'.repeat(1001), 70000031)); // no skip(): never throttled
  assert.match(api[0].body.text, /1000文字以内/);
  await feed(msg('/paysupport 二重に支払いました', 70000031));
  assert.match(api[0].body.text, /受付番号 <code>T1<\/code>/);
  const tk = await mo.membership('admin', 'tickets', {});
  assert.equal(tk[0].id, 'T1'); assert.equal(tk[0].text, '二重に支払いました'); assert.ok(!('userId' in tk[0])); assert.equal(tk[0].orders.length, 1);
  for (let i = 0; i < 4; i++) { skip(); await feed(msg('/paysupport もう一件' + i, 70000031)); }
  skip(); await feed(msg('/paysupport 6件目', 70000031));
  assert.match(api[0].body.text, /上限/);
  for (let i = 0; i < 25; i++) await appPost('checkout', {initData: initData({id: 70000031}), plan: 'light'}); // unpaid invoices
  const o = await mo.membership('app_orders', {userId: 70000031});
  assert.ok(o.some(x => x.state === 'paid') && o.every(x => ['paid', 'refunded'].includes(x.state)));
});

await test('t80u: a member group added to a plan later reaches members who already paid (and their renewals)', async () => {
  const mo = env.CHAT.getByName('membership:main');
  const [, std] = P.planSetPayloads({chats: [-100777], links: {'-100777': 'https://t.me/+x'}});
  await mo.membership('admin', 'plan_set', std);
  const e = await (async () => { const m = env.CHAT._store('membership:main'); return [...m].find(([k]) => k === 'ent:70000031:standard')[1]; })();
  assert.deepEqual(e.chats, [-100777]);
  assert.deepEqual((await appPost('state', {initData: initData({id: 70000031})})).body.member.links, ['https://t.me/+x']);
  const n = (await mo.membership('admin', 'approvals', {})).filter(x => x.condition === 'member_notice' && /開設しました/.test(x.params.text));
  assert.equal(n.length, 1, 'the group announcement is queued, not sent');
  const tr = await mo.membership('admin', 'ticket_reply', {id: 'T1', text: '確認しました'});
  assert.equal(tr.status, 'pending_approval');
  await assert.rejects(mo.membership('admin', 'ticket_reply', {id: 'T999', text: 'x'}), /unknown_ticket/);
  await mo.membership('admin', 'plan_set', P.planSetPayloads()[1]); // back to no group for the next tests
});

await test('t80u: refunds go through the admin API as refundStarPayment and wait for the owner (not executed here)', async () => {
  const mo = env.CHAT.getByName('membership:main');
  const list = await mo.membership('admin', 'orders', {});
  assert.ok(list.length && list.every(o => !('userId' in o) && !('paymentRef' in o)));
  const paid = list.find(o => o.state === 'paid');
  api = [];
  const r = await mo.membership('admin', 'refund', {orderId: paid.id});
  assert.equal(r.status, 'pending_approval'); assert.equal(api.length, 0);
  const a = (await mo.membership('admin', 'approvals', {})).find(x => x.id === r.approvalId);
  assert.equal(a.method, 'refundStarPayment'); assert.equal(a.params.telegram_payment_charge_id, 'stxT80U');
  await mo.membership('admin', 'reject', {id: r.approvalId}); // leave the stub store clean
  await assert.rejects(mo.membership('admin', 'refund', {orderId: list.find(o => o.state === 'awaiting_payment').id}), /not_refundable/);
});

await test('t80u: live widgets — the member card shows the paid membership; the plan card sends the Mini App button, no TEST membership', async () => {
  const U = 70000031;
  skip(); await feed(msg('/start', U));
  skip(); await feed(press('ga:4', U));
  const card = api.find(x => x.method === 'sendWidget');
  assert.deepEqual({...dataOf(card), no: 0}, {no: 0, pl: 'スタンダード', until: dataOf(card).until, rn: 1, lv: 1});
  assert.match(card.body.caption, /お支払い済み/);
  skip(); await feed(press('ga:5', U));
  const pl = api.find(x => x.method === 'sendWidget');
  assert.deepEqual(dataOf(pl), {lv: 1}); assert.doesNotMatch(pl.body.caption, /テスト/);
  const mid = byKind('pl', U);
  skip(); await feed(wq('y2', mid, U));
  assert.deepEqual(methods(), ['sendMessage', 'editMessageWidgetData', 'answerWidgetQuery']);
  assert.equal(api[0].body.reply_markup.inline_keyboard[0][0].web_app.url, 'https://w.invalid/app/?p=premium');
  assert.deepEqual(JSON.parse(api[1].body.chat_data), {lv: 1, go: 2});
  assert.equal(journal(U).studio.member, undefined, 'no TEST member written in live mode');
  skip(); await feed(msg('/pay', U));
  assert.match(api[0].body.text, /⭐1500／30日（自動更新）/);
  skip(); await feed(msg('/plans', U));
  assert.equal(api[0]?.method, 'sendMessage'); assert.match(api[0].body.text, /\/terms/);
  assert.equal(api[0].body.reply_markup.inline_keyboard.length, 3);
  delete env.PAY_LIVE; delete env.MEMBERSHIP;
});

Date.now = realNow;
console.log = realLog;
console.log(JSON.stringify({suite: 't78u', passed: true, tests: pass, results}, null, 1));
