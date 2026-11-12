// t63u: HTML widget (Bot API 10.4) and Managed Bots (9.6) layered in front of the unchanged engine.
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
  else if (/^send/.test(method)) result = {chat: {id: Number(body.chat_id)}, message_id: ++msgSeq, ...(method === 'sendWidget' ? {widget: {html: body.html}} : {})};
  return Response.json({ok: true, result});
};

function makeCtx(store, name) {
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async delete(k) { return store.delete(k); },
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

await test('the t63u card HTML (still answered for cards already in chats) is within the Bot API limits', async () => {
  const html = W.widgetHtml(W.nextDates(Date.parse('2026-11-11T00:00:00Z')));
  const raw = Buffer.byteLength(html);
  const py = Number(execFileSync('python3', ['-I', '-c', 'import sys,zlib;print(len(zlib.compress(sys.stdin.buffer.read(),9)))'], {input: html}).toString());
  assert.ok(raw <= 32768 && py < 4096, `raw=${raw} py=${py}`);
});

await test('/start (t78u) opts in, shows the 2x3 keyboard and the tour widget', async () => {
  await feed(msg('/start'));
  assert.deepEqual(api.map(x => x.method), ['sendMessage', 'sendWidget']);
  const kb = api[0].body.reply_markup.keyboard;
  assert.deepEqual(kb[0].map(b => b.text), ['📅 予約', '✨ ウィジェット', '🎓 ガイド']);
  assert.equal(api[0].body.reply_markup.is_persistent, true);
});

const byKind = (k, chat = CHAT) => Number(Object.entries(journal(chat).t63u.widgets).filter(([, w]) => w.kind === k).sort((a, b) => b[1].at - a[1].at)[0]?.[0]);
let widgetMsg;
await test('/widget now sends the all-in-widget booking card with allow_queries, a caption and the button-version fallback', async () => {
  await pause(1600);
  await feed(msg('/widget'));
  assert.deepEqual(api.map(x => x.method), ['sendWidget']);
  const b = api[0].body;
  assert.equal(b.chat_id, CHAT); assert.equal(b.allow_queries, true);
  assert.ok(b.caption.includes('予約カード') && b.html.includes('TelegramWidget'));
  assert.deepEqual(b.reply_markup.inline_keyboard[0][0], {text: '📋 ボタン版で予約', callback_data: 'wfb'});
  widgetMsg = byKind('bk');
  assert.ok(widgetMsg);
});

await test('the ✨ウィジェット buttons open the gallery; a second tap within 1.5 s is ignored', async () => {
  await pause(1600);
  await feed(msg('✨ウィジェット'));
  assert.deepEqual(api.map(x => x.method), ['sendWidget']);
  assert.ok(api[0].body.caption.includes('ウィジェット一覧'));
  await feed(msg('✨ ウィジェット'));
  assert.equal(api.length, 0);
});

await test('a booking request edits the widget state in place and answers the widget', async () => {
  await feed(wq('b11012', widgetMsg));
  assert.deepEqual(api.map(x => x.method), ['editMessageWidgetData', 'answerWidgetQuery']);
  const state = JSON.parse(api[0].body.chat_data);
  assert.equal(api[0].body.message_id, widgetMsg);
  assert.deepEqual({i: state.i, v: state.v, p: state.p, d: state.d, t: state.t, st: state.st}, {i: 1, v: 1, p: 0, d: 1, t: 2, st: 'ok'});
  assert.match(state.r, /^TEST-B-[0-9A-F]{6}$/);
  await feed(wq('b00000', widgetMsg));
  assert.deepEqual(api.map(x => x.method), ['answerWidgetQuery']);
  assert.equal(JSON.parse(api[0].body.data).r, state.r);
});

await test('"r" clears the widget state so another slot can be taken', async () => {
  await feed(wq('r', widgetMsg));
  assert.deepEqual(api.map(x => x.method), ['editMessageWidgetData', 'answerWidgetQuery']);
  assert.equal(api[0].body.chat_data, '');
  assert.equal(journal().t63u.widgets[widgetMsg].st, null);
});

await test('a widget query for an unknown message, a bad payload or another user is answered but changes nothing', async () => {
  await feed(wq('b00000', 999999));
  assert.deepEqual(api.map(x => x.method), ['answerWidgetQuery']);
  assert.ok(JSON.parse(api[0].body.data).e);
  await feed(wq('b99999', widgetMsg));
  assert.deepEqual(api.map(x => x.method), ['answerWidgetQuery']);
  await feed(wq('b00000', widgetMsg, 555000222));
  assert.deepEqual(api.map(x => x.method), ['answerWidgetQuery']);
  const {makeCall} = await import('../src/tg.mjs');
  const call = makeCall(env, () => journal());
  await assert.rejects(() => call('editMessageWidgetData', {chat_id: CHAT, message_id: 424242, chat_data: 'x'}), /unbound_widget/);
  await assert.rejects(() => call('editMessageCaption', {chat_id: CHAT, message_id: 424242, caption: 'x'}), /unbound_widget/);
  await assert.rejects(() => call('sendWidget', {chat_id: 111222333, html: 'x'}), /unbound_destination/);
  for (const m of ['setWebhook', 'setMyCommands', 'replaceManagedBotToken', 'sendSharedWidget', 'editSharedWidgetData', 'deleteMessage']) {
    await assert.rejects(() => call(m, {chat_id: CHAT}), /method_not_allowed/, m);
  }
});

await test('the "従来版で開く" button answers the press and opens the existing rich booking flow', async () => {
  await pause(1200);
  await feed(press('wfb'));
  assert.equal(api[0].method, 'answerCallbackQuery');
  assert.ok(api.length >= 2, 'the engine rendered the booking screen');
  assert.ok(api.slice(1).every(x => ['sendMessage', 'sendAnimation', 'sendPhoto'].includes(x.method)));
});

await test('if sendWidget is refused (4xx) the same tap falls back to the rich message flow', async () => {
  await pause(1600);
  fail.sendWidget = 400;
  await feed(msg('/widget'));
  assert.equal(api[0].method, 'sendWidget');
  assert.ok(api.length >= 2 && api.slice(1).every(x => ['sendMessage', 'sendAnimation', 'sendPhoto'].includes(x.method)));
});

await test('someone who never opted in gets nothing from /widget, /newbot or a widget query', async () => {
  for (const u of [msg('/widget', 555000333), msg('/newbot', 555000333), wq('b000', widgetMsg, 555000333)]) {
    await feed(u);
    assert.ok(api.every(x => x.method === 'answerWidgetQuery'), 'only the mandatory widget answer');
  }
});

await test('/newbot without the BotFather setting replies with the one-line instruction and no button', async () => {
  canManage = false;
  await pause(1600);
  await feed(msg('/newbot'));
  assert.deepEqual(api.map(x => x.method), ['getMe', 'sendMessage']);
  assert.ok(api[1].body.text.includes('@BotFather') && !api[1].body.reply_markup);
});

await test('/newbot with the setting shows the official request_managed_bot button', async () => {
  canManage = true;
  await pause(1600);
  await feed(msg('/newbot'));
  assert.deepEqual(api.map(x => x.method), ['getMe', 'sendMessage']);
  const btn = api[1].body.reply_markup.keyboard[0][0];
  assert.equal(btn.text, M.NEWBOT_BUTTON);
  assert.equal(btn.request_managed_bot.request_id, 1);
  assert.match(btn.request_managed_bot.suggested_username, /^[a-z0-9_]{5,32}$/);
  assert.ok(btn.request_managed_bot.suggested_username.endsWith('bot'));
  assert.equal(api[1].body.reply_markup.one_time_keyboard, true);
});

await test('a managed_bot update: token fetched, template set, token sealed, webhook pointed at /<botId>/webhook', async () => {
  await feed({update_id: ++id, managed_bot: {user: {id: CHAT, is_bot: false, first_name: 'T'}, bot: {id: MBOT, is_bot: true, first_name: 'B', username: 'th_beauty_ab12_bot'}}});
  const seq = api.map(x => (x.managed ? 'M:' : '') + x.method);
  assert.deepEqual(seq, ['getManagedBotToken', 'M:setMyDescription', 'M:setMyShortDescription', 'M:setMyCommands', 'M:setWebhook', 'sendMessage']);
  assert.equal(api[0].body.user_id, MBOT);
  // The template is the industry last booked in the widget (b112 = 美容室).
  assert.ok(api[1].body.description.includes('美容室'));
  const hook = api[4].body;
  assert.equal(hook.url, `https://w.invalid/${MBOT}/webhook`);
  assert.equal(hook.secret_token, await M.webhookSecret(env, MBOT));
  assert.match(hook.secret_token, /^[0-9a-f]{64}$/);
  assert.ok(api[5].body.text.includes('@th_beauty_ab12_bot') && api[5].body.reply_markup.keyboard[0][1].text === '✨ ウィジェット');
  const rec = env.CHAT._store(`mbot:${MBOT}`).get('managed');
  assert.equal(rec.owner, CHAT); assert.equal(rec.industry, 1);
  assert.ok(!JSON.stringify(rec).includes(MANAGED_TOKEN), 'the stored record must not hold the token in clear');
  assert.equal(await M.openToken(env, rec.sealed, MBOT), MANAGED_TOKEN);
  await assert.rejects(() => M.openToken(env, rec.sealed, MBOT + 1)); // bound to its bot id
  assert.ok(!JSON.stringify(journal()).includes(MANAGED_TOKEN));
});

await test('the managed_bot_created service message for the same bot does not set it up twice', async () => {
  await feed(msg(null, CHAT, {managed_bot_created: {bot: {id: MBOT, is_bot: true, first_name: 'B', username: 'th_beauty_ab12_bot'}}}));
  assert.equal(api.length, 0);
});

await test('the managed bot webhook needs its derived secret and answers only its creator', async () => {
  const hookSecret = await M.webhookSecret(env, MBOT);
  api = [];
  assert.equal((await post(`/${MBOT}/webhook`, msg('/start'), 'wrong')).status, 403);
  assert.equal((await post(`/${MBOT}/webhook`, msg('/start'), SECRET)).status, 403);
  assert.equal((await post(`/${MBOT + 1}/webhook`, msg('/start'), hookSecret)).status, 403);
  await settle(); assert.equal(api.length, 0);
  await post(`/${MBOT}/webhook`, msg('/start', 555000444), hookSecret); await settle();
  assert.equal(api.length, 0, 'a stranger gets silence');
  await post(`/${MBOT}/webhook`, msg('/start'), hookSecret); await settle();
  assert.deepEqual(api.map(x => (x.managed ? 'M:' : '') + x.method), ['M:sendMessage']);
  assert.ok(api[0].body.text.includes('美容室'));
  await pause(1200);
  api = [];
  await post(`/${MBOT}/webhook`, press('s0'), hookSecret); await settle();
  assert.deepEqual(api.map(x => (x.managed ? 'M:' : '') + x.method), ['M:answerCallbackQuery', 'M:sendMessage']);
  assert.match(api[1].body.text, /TEST-M-[0-9a-f]{6}/);
});

await test('managed bot transport has its own allowlist', async () => {
  for (const m of ['getManagedBotToken', 'replaceManagedBotToken', 'deleteMessage', 'banChatMember', 'sendWidget']) {
    await assert.rejects(() => M.managedCall(MANAGED_TOKEN, m, {}), /method_not_allowed/, m);
  }
});

await test('a fast press on the managed bot menu is delayed, not dropped', async () => {
  const hookSecret = await M.webhookSecret(env, MBOT);
  api = [];
  await post(`/${MBOT}/webhook`, msg('/start'), hookSecret); await settle();
  api = [];
  await post(`/${MBOT}/webhook`, press('s1'), hookSecret); await settle();
  assert.deepEqual(api.map(x => (x.managed ? 'M:' : '') + x.method), ['M:answerCallbackQuery', 'M:sendMessage']);
});

await test('a ManagedBotUpdated for a ready bot refreshes the sealed token and messages nobody', async () => {
  const before = env.CHAT._store(`mbot:${MBOT}`).get('managed').sealed;
  await feed({update_id: ++id, managed_bot: {user: {id: CHAT, is_bot: false, first_name: 'T'}, bot: {id: MBOT, is_bot: true, first_name: 'B', username: 'th_beauty_ab12_bot'}}});
  assert.deepEqual(api.map(x => x.method), ['getManagedBotToken']);
  const after = env.CHAT._store(`mbot:${MBOT}`).get('managed').sealed;
  assert.notDeepEqual(after, before);
  assert.equal(await M.openToken(env, after, MBOT), MANAGED_TOKEN);
});

await test('a redelivered /widget update does not send a second card', async () => {
  await pause(1600);
  const u = msg('/widget');
  await feed(u);
  assert.deepEqual(api.map(x => x.method), ['sendWidget']);
  await pause(1600);
  await feed(u);
  assert.equal(api.length, 0);
});

await test('during a human handoff the widget and /newbot stay silent and widget requests are refused', async () => {
  // A second, fresh chat so the engine's 20-per-minute rate cap from the tests above does not apply.
  const C2 = 70000002, j2 = () => env.CHAT._journal(`chat:${C2}`);
  await feed(msg('/start', C2)); await pause(1200);
  await feed(msg('/widget', C2)); await pause(1200);
  const wid = byKind('bk', C2);
  await feed(msg('美容室', C2)); await pause(1200); // the engine pauses only once an industry is chosen
  await feed(msg('/pause', C2));
  assert.equal(j2().sessions[`${C2}:${C2}`].paused, true);
  await pause(1600);
  await feed(msg('/widget', C2));
  assert.ok(!api.some(x => x.method === 'sendWidget'));
  await pause(1600);
  await feed(msg('/newbot', C2));
  assert.ok(!api.some(x => x.method === 'getMe' || (x.body?.reply_markup?.keyboard ?? []).flat().some(b => b.request_managed_bot)));
  await feed(wq('b000', wid, C2));
  assert.deepEqual(api.map(x => x.method), ['answerWidgetQuery']);
  assert.ok(JSON.parse(api[0].body.data).e);
});

await test('a redelivered managed-bot update is answered once', async () => {
  const hookSecret = await M.webhookSecret(env, MBOT);
  const u = msg('/start');
  api = [];
  await post(`/${MBOT}/webhook`, u, hookSecret); await settle();
  await post(`/${MBOT}/webhook`, u, hookSecret); await settle();
  assert.deepEqual(api.map(x => (x.managed ? 'M:' : '') + x.method), ['M:sendMessage']);
});

await test('a set-up that failed half-way is resumed by the next event for that bot', async () => {
  const BOT2 = 7000000002, ev = () => ({update_id: ++id, managed_bot: {user: {id: CHAT, is_bot: false, first_name: 'T'}, bot: {id: BOT2, is_bot: true, first_name: 'B', username: 'th_beauty_cd34_bot'}}});
  fail.getManagedBotToken = 500;
  await feed(ev());
  assert.equal(journal().t63u.bots[BOT2].state, 'setting_up');
  await feed(msg(null, CHAT, {managed_bot_created: {bot: {id: BOT2, is_bot: true, first_name: 'B', username: 'th_beauty_cd34_bot'}}}));
  assert.equal(journal().t63u.bots[BOT2].state, 'ready');
  assert.equal(api.at(-1).method, 'sendMessage');
});

await test('nothing logged contains either token, the secrets, the managed key or a raw chat id', async () => {
  assert.ok(logs.length > 5);
  for (const line of logs) {
    for (const s of [TOKEN, MANAGED_TOKEN, SECRET, MKEY, String(CHAT), '70000002', String(555000444)]) assert.ok(!line.includes(s), 'leak in log');
  }
  const kinds = logs.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  assert.ok(kinds.some(x => x.kind === 'widget_query') && kinds.some(x => x.kind === 'managed_bot') && kinds.some(x => x.ev === 'managed_update'));
});

console.log = realLog;
console.log(JSON.stringify({suite: 't63u', passed: true, tests: pass, results}, null, 1));
