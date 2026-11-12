// Exercises the Worker-specific layer — secret check, routing, per-chat Durable Object queueing,
// deferred-step retry, the Bot API allowlist and the asset upload path — with Telegram and the
// Durable Object runtime replaced by local stubs. No network, no Bot API, no Telegram token.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(HERE, '../assets');
const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const SECRET = 'test-webhook-secret-value';
// A made-up chat id: no real chat id appears anywhere in this repository.
const CHAT = 70000001;

const {ChatSession} = await import('../src/chat.mjs');
const worker = (await import('../src/index.mjs')).default;
const {BOT, ANIMATIONS, STRIPS} = await import('../src/schema.mjs');
const SEED = JSON.stringify({'hdr-booking.mp4': 'SEEDED-BOOKING-ID-0001'});

let api = [];            // every Bot API call the Worker attempted
let failNext = null;     // {method, code} — make the next matching call fail
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw Error('unexpected_host:' + u);
  const method = u.split('/').pop();
  const entry = {method, at: api.length};
  if (init.body instanceof FormData) {
    entry.multipart = {};
    for (const [k, v] of init.body.entries()) {
      entry.multipart[k] = v instanceof Blob ? {bytes: v.size, type: v.type, name: v.name} : v;
    }
    entry.body = Object.fromEntries(Object.entries(entry.multipart).map(([k, v]) => [k, typeof v === 'string' ? v : '<file>']));
  } else {
    entry.body = JSON.parse(init.body);
  }
  api.push(entry);
  if (failNext && failNext.method === method) {
    const {code} = failNext; failNext = null;
    return new Response(JSON.stringify({ok: false, error_code: code, description: 'stub'}), {status: code});
  }
  let result = true;
  if (method !== 'answerCallbackQuery') {
    const chat_id = Number(entry.body.chat_id);
    result = {chat: {id: chat_id}, message_id: 1000 + api.length};
    if (method === 'sendPhoto') result.photo = [{file_id: 'PHOTO-STUB-ID-000001'}];
    if (method === 'sendAnimation') result.animation = {file_id: 'ANIM-STUB-ID-' + String(api.length).padStart(6, '0')};
  }
  return new Response(JSON.stringify({ok: true, result}), {headers: {'content-type': 'application/json'}});
};

function makeStorage() { return new Map(); }
function makeCtx(store, name) {
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async delete(k) { return store.delete(k); },
    },
    blockConcurrencyWhile(fn) { const p = fn(); ctx._init = p; return p; },
    _init: Promise.resolve(),
    id: {name},
  };
  return ctx;
}
// Durable Object namespace stub: storage is keyed by name and survives "eviction" (_evict),
// and every method is reached through a promise like a real RPC stub.
function makeNamespace(envRef) {
  const stores = new Map(), live = new Map();
  return {
    getByName(name) {
      if (!stores.has(name)) stores.set(name, makeStorage());
      if (!live.has(name)) {
        const ctx = makeCtx(stores.get(name), name);
        live.set(name, {ctx, obj: new ChatSession(ctx, envRef.env)});
      }
      const {ctx, obj} = live.get(name);
      return new Proxy({}, {get: (_, prop) => (...args) => ctx._init.then(() => obj[prop](...args))});
    },
    _evict() { live.clear(); },
    _names() { return [...stores.keys()]; },
    _journal(name) { return stores.get(name)?.get('journal'); },
  };
}
const envRef = {};
const env = {
  BOT_TOKEN: TOKEN,
  WEBHOOK_SECRET: SECRET,
  SEED_FILE_IDS: SEED,
  SEED_OPTINS: '{}',
  ASSETS: {
    async fetch(url) {
      const name = new URL(String(url)).pathname.slice(1);
      const p = path.join(ASSET_DIR, name);
      if (!fs.existsSync(p)) return new Response('not found', {status: 404});
      return new Response(fs.readFileSync(p));
    },
  },
};
envRef.env = env;
env.CHAT = makeNamespace(envRef);

const pending = [];
const ctx = {waitUntil: p => pending.push(p)};
const settle = async () => { while (pending.length) await pending.shift(); };

const post = (pathname, body, secret = SECRET) => worker.fetch(new Request('https://w.invalid' + pathname, {
  method: 'POST', headers: {'content-type': 'application/json', ...(secret === null ? {} : {'x-telegram-bot-api-secret-token': secret})},
  body: JSON.stringify(body),
}), env, ctx);
const get = (pathname, secret = null) => worker.fetch(new Request('https://w.invalid' + pathname, {
  headers: secret === null ? {} : {'x-telegram-bot-api-secret-token': secret},
}), env, ctx);

let id = 9000;
const secs = () => Math.floor(Date.now() / 1000);
const msg = (text, chat = CHAT) => ({update_id: ++id, message: {message_id: id, date: secs(), chat: {id: chat, type: 'private'}, from: {id: chat, is_bot: false}, text}});
const press = (data, chat = CHAT) => ({update_id: ++id, callback_query: {id: 'cb' + id, data, from: {id: chat, is_bot: false}, message: {message_id: id, date: secs(), chat: {id: chat, type: 'private'}, from: {id: BOT}}}});
const feed = async u => { api = []; const r = await post('/webhook', u); await settle(); return r; };

let pass = 0;
const results = [];
async function test(name, fn) {
  await fn();
  pass++; results.push(name);
}

await test('/health answers without a token, a secret or a chat id', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.mode, 'webhook');
  assert.equal(b.bot, 'teleharness_bot');
  assert.equal(b.tokenConfigured, true);
  assert.equal(b.secretConfigured, true);
  assert.equal(b.assets, new Set([...ANIMATIONS, ...STRIPS]).size);
  assert.equal(b.seededOptins, 0);
  const text = JSON.stringify(b);
  assert.ok(!text.includes(TOKEN) && !text.includes(SECRET) && !text.includes(String(CHAT)));
});

await test('/health?deep=1 needs the secret and then reports every asset', async () => {
  assert.equal((await get('/health?deep=1')).status, 403);
  api = [];
  const b = await (await get('/health?deep=1', SECRET)).json();
  for (const name of new Set([...ANIMATIONS, ...STRIPS])) {
    assert.ok(b.assetBytes[name] > 1000, name);
    // The same read as seen from inside a Durable Object, which is where an upload performs it.
    assert.equal(b.assetBytesFromDurableObject[name], b.assetBytes[name], name);
  }
  assert.deepEqual(env.CHAT._names().filter(n => n.startsWith('chat:')), [],
    'the probe must not be a chat object');
  // The identity check must be exactly one getMe and nothing addressed to a person.
  assert.deepEqual(api.map(x => x.method), ['getMe']);
  assert.equal(b.botApi.ok, false, 'the stub token is not a real bot');
  assert.ok(Array.isArray(b.botApi.ms) && b.botApi.ms.length === 1);
  assert.ok(!JSON.stringify(b).includes(TOKEN));
});

await test('a webhook POST without the right secret is refused and reaches no chat', async () => {
  api = [];
  assert.equal((await post('/webhook', msg('/start'), 'wrong')).status, 403);
  assert.equal((await post('/webhook', msg('/start'), null)).status, 403);
  await settle();
  assert.equal(api.length, 0);
  assert.deepEqual(env.CHAT._names().filter(n => n.startsWith('chat:')), []);
});

await test('an update from someone who never opted in gets no reply at all', async () => {
  const r = await feed(msg('こんにちは', 555000111));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  assert.equal(api.length, 0);
});

await test('/start opts in, attaches the new bottom keyboard and deals the guided-tour widget (t78u)', async () => {
  await feed(msg('/start'));
  assert.deepEqual(api.map(x => x.method), ['sendMessage', 'sendWidget']);
  const kb = api[0].body.reply_markup;
  assert.deepEqual(kb.keyboard.map(r => r.map(b => b.text)),
    [['📅 予約', '✨ ウィジェット', '🎓 ガイド'], ['🎨 リッチ', '💳 会員・決済', '🤖 Bot作成']]);
  assert.ok(String(api[1].body.caption).includes('1/6'));
  assert.equal(liveSession().optins, 1);
});

let session, rev;
await test('choosing an industry uploads the staff collage from the assets binding', async () => {
  await feed(msg('キャバクラ'));
  assert.deepEqual(api.map(x => x.method), ['sendPhoto', 'sendMessage']);
  assert.ok(api[0].multipart, 'the collage has no cached id, so it must be uploaded');
  assert.equal(api[0].multipart.photo.type, 'image/jpeg');
  assert.ok(STRIPS.includes(api[0].multipart.photo.name));
  assert.ok(api[0].multipart.photo.bytes > 50000);
  assert.ok(String(api[0].body.caption).includes('架空スタッフ'));
  // The overview screen has no header animation, so its menu is a plain message, as upstream.
  assert.ok(String(api[1].body.text).includes('キャバクラ'));
});

await test('the decoration showcase uploads the MP4 with a video content type and caches its id', async () => {
  const s0 = liveSession();
  await feed(msg('🎨 メッセージ作成'));
  const s1 = liveSession();
  assert.equal(s1.page, 'compose');
  await feed(press(`${s1.session}:${s1.rev}:animate`));
  const anim = api.filter(x => x.method === 'sendAnimation');
  assert.ok(anim.length >= 1);
  const uploaded = anim.find(x => x.multipart);
  assert.equal(uploaded.multipart.animation.type, 'video/mp4');
  assert.equal(uploaded.multipart.animation.name, 'hdr-decor.mp4');
  assert.ok(uploaded.multipart.animation.bytes > 500000);
  const g = env.CHAT._journal(`chat:${CHAT}`);
  assert.equal(g.fileIds['hdr-decor.mp4'], 'ANIM-STUB-ID-' + String(uploaded.at + 1).padStart(6, '0'));
  void s0;
});

// The live session token is needed to forge presses; read it out of the journal the object
// persisted, the way the Mac mini test suite read journal.json.
function liveSession() {
  const g = env.CHAT._journal(`chat:${CHAT}`);
  const s = g?.sessions?.[`${CHAT}:${CHAT}`];
  return {session: s?.session, rev: s?.rev, page: s?.page, optins: Object.keys(g?.optins ?? {}).length};
}

await test('a press is answered before anything else is sent', async () => {
  const s = liveSession();
  session = s.session; rev = s.rev;
  await feed(press(`${session}:${rev}:book`));
  assert.equal(api[0].method, 'answerCallbackQuery');
  assert.ok(api.length >= 2);
  assert.ok(api.slice(1).every(x => x.method !== 'answerCallbackQuery'));
});

await test('an action the current screen does not offer re-sends the current menu with a notice', async () => {
  const {REFRESH_NOTICE} = await import('../src/menu.mjs');
  await feed(press('deadbeefdeadbeef:99:i0'));
  assert.equal(api[0].method, 'answerCallbackQuery');
  assert.equal(api[0].body.text, REFRESH_NOTICE);
  assert.ok(api.length >= 2);
});

await test('two presses arriving at once are serialised, not dropped as deferred', async () => {
  api = [];
  const s = liveSession();
  const a = post('/webhook', press(`${s.session}:${s.rev}:faq`));
  const b = post('/webhook', press(`${s.session}:${s.rev}:home`));
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  await settle();
  const acks = api.filter(x => x.method === 'answerCallbackQuery').length;
  assert.equal(acks, 2, 'both presses must be answered');
  assert.ok(api.filter(x => x.method.startsWith('send') || x.method.startsWith('edit')).length >= 2,
    'both presses must change the screen');
});

await test('a step held back by the per-user spacing is retried in place instead of being lost', async () => {
  const s = liveSession();
  api = [];
  await post('/webhook', msg('ホーム'));
  await settle();
  const first = api.length;
  api = [];
  // Immediately again: the engine's own 1.1 s spacing defers this, and the retry must still send it.
  await post('/webhook', msg('ヘルプ'));
  await settle();
  assert.ok(first > 0);
  assert.ok(api.some(x => x.method.startsWith('send') || x.method.startsWith('edit')),
    'the second message must still reach the chat');
  void s;
});

await test('a forged destination and a method outside the allowlist are both refused', async () => {
  const {makeCall} = await import('../src/tg.mjs');
  const g = {sessions: {[`${CHAT}:${CHAT}`]: {chatId: CHAT, userId: CHAT}}, optins: {[`${CHAT}:${CHAT}`]: {since: 1}}, fileIds: {}};
  const call = makeCall(env, () => g);
  await assert.rejects(() => call('sendMessage', {chat_id: 111222333, text: 'x'}), /unbound_destination/);
  await assert.rejects(() => call('getChatMember', {chat_id: CHAT}), /method_not_allowed/);
  await assert.rejects(() => call('sendPhoto', {chat_id: CHAT, photo: 'staff-0.jpg'}), /asset_not_allowed/);
  await assert.rejects(() => call('sendAnimation', {chat_id: CHAT, animation: 'NOT-A-RECORDED-ID-X'}), /asset_not_allowed/);
  // t78u: caption/text edits exist only for this bot's own registered widget messages in that chat.
  for (const m of ['editMessageText', 'editMessageCaption']) await assert.rejects(() => call(m, {chat_id: CHAT, message_id: 1}), /unbound_widget/, m);
  for (const m of ['editMessageMedia', 'editMessageReplyMarkup',
    'deleteMessage', 'sendVideo', 'setMyCommands', 'approveChatJoinRequest', 'banChatMember', 'getUpdates', 'setWebhook']) {
    await assert.rejects(() => call(m, {chat_id: CHAT}), /method_not_allowed/, m);
  }
  // A collage may not travel as an animation, nor a header as a photo.
  await assert.rejects(() => call('sendAnimation', {chat_id: CHAT, animation: 'staff-strip-01-day.jpg'}), /asset_not_allowed/);
  await assert.rejects(() => call('sendPhoto', {chat_id: CHAT, photo: 'hdr-booking.mp4'}), /asset_not_allowed/);
});

await test('a 400 on the custom emoji markup is retried once with the markup removed', async () => {
  const s = liveSession();
  api = [];
  failNext = {method: 'sendMessage', code: 400};
  await post('/webhook', msg('ヘルプ'));
  await settle();
  const sends = api.filter(x => x.method === 'sendMessage');
  assert.ok(sends.length >= 2, 'the same copy must go out again');
  assert.ok(String(sends[0].body.text).includes('<tg-emoji'));
  assert.ok(!String(sends.at(-1).body.text).includes('<tg-emoji'));
  void s;
});

await test('an action a previous delivery left half-done is finished on the next press', async () => {
  // This is the one thing a poller got for free: it was handed the same update again until every
  // step was out. Reproduce the state it leaves behind — one step sent, one still planned, the
  // event still 'processing' — and check the next press completes it instead of being refused,
  // which is what classify() does while an action for the same chat is in flight.
  const key = `${CHAT}:${CHAT}`;
  const name = `chat:${CHAT}`;
  env.CHAT._evict();                       // no live instance may overwrite the state we inject
  const g = env.CHAT._journal(name);
  const stuckId = 777001;
  g.events[stuckId] = {
    at: Date.now(), state: 'processing', key, action: 'help', start: false, callbackId: null,
    callbackAcked: true,
    steps: [
      {method: 'sendMessage', state: 'sent', messageId: 1},
      {method: 'sendMessage', state: 'planned', menu: true,
       body: {chat_id: CHAT, text: '<b>停まっていた一通</b>', parse_mode: 'HTML',
              reply_markup: {inline_keyboard: [[{text: 'ホーム', callback_data: 'x:1:home'}]]}}},
    ],
  };
  const s = liveSession();
  api = [];
  await post('/webhook', press(`${s.session}:${s.rev}:home`));
  await settle();
  const texts = api.filter(x => x.method === 'sendMessage').map(x => String(x.body.text));
  assert.ok(texts.some(t => t.includes('停まっていた一通')), 'the held-back message must go out');
  assert.ok(api.some(x => x.method === 'answerCallbackQuery'), 'and the new press must still be answered');
  const after = env.CHAT._journal(name);
  assert.equal(after.events[stuckId].state, 'sent');
  const stillStuck = Object.values(after.events).filter(e => e.state === 'processing');
  assert.deepEqual(stillStuck, [], 'nothing may be left in flight');
});

await test('the journal survives the object being evicted', async () => {
  const before = liveSession();
  env.CHAT._evict();
  const after = liveSession();
  assert.equal(after.session, before.session);
  assert.equal(after.optins, before.optins);
});

await test('/stop removes the opt-in and later presses are answered with silence', async () => {
  const s = liveSession();
  await feed(msg('/stop'));
  assert.equal(api.length, 0, '/stop sends nothing');
  api = [];
  await feed(press(`${s.session}:${s.rev}:home`));
  assert.equal(api.length, 0, 'a press after /stop is ignored entirely');
});

await test('imported consent is applied on the chat\'s own first cold start, not pushed in', async () => {
  const key = `${CHAT}:${CHAT}`;
  // Nothing may create a chat object ahead of Telegram: a Durable Object is placed where its
  // first request lands, so the consent has to be picked up by the object itself.
  env.SEED_OPTINS = JSON.stringify({
    [key]: {since: Date.now() - 86400000},
    '999000111:999000111': {since: 1},            // another chat's consent must be ignored
  });
  env.CHAT._evict();
  assert.equal(liveSession().optins, 0, 'the /stop above really did remove the consent');
  await feed(press('deadbeefdeadbeef:1:home'));
  assert.equal(api[0].method, 'answerCallbackQuery');
  assert.ok(api.length >= 2, 'the press is answered again now that consent is back');
  const g = env.CHAT._journal(`chat:${CHAT}`);
  assert.deepEqual(Object.keys(g.optins), [key], 'only this chat\'s consent is imported');
  const health = await (await get('/health')).json();
  assert.equal(health.seededOptins, 2);
  assert.ok(!JSON.stringify(health).includes(String(CHAT)));
});

await test('a chat that was never opted in is still silent after the import', async () => {
  const r = await feed(msg('こんにちは', 42424242));
  assert.equal(r.status, 200);
  assert.equal(api.length, 0);
});

await test('there is no route that can create or reach a chat object directly', async () => {
  for (const p of ['/admin/seed-optins', '/admin/seed', '/chat', '/send']) {
    assert.equal((await post(p, {optins: {}})).status, 404, p);
  }
});

await test('nothing logged contains the token, the secret or a raw chat id', async () => {
  assert.ok(logs.length > 5, `only ${logs.length} log lines`);
  for (const line of logs) {
    assert.ok(!line.includes(TOKEN), 'token in log');
    assert.ok(!line.includes(SECRET), 'secret in log');
    assert.ok(!line.includes(String(CHAT)), 'chat id in log');
  }
  const parsed = logs.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x?.ev === 'update');
  assert.ok(parsed.length >= 8, `only ${parsed.length} update log lines`);
  assert.ok(parsed.every(x => typeof x.msTotal === 'number' && /^[0-9a-f]{8}$/.test(x.chat)));
  results.push(`updateLogs=${parsed.length}`);
});

await test('an unknown path is a 404 and GET on the webhook is not accepted', async () => {
  assert.equal((await get('/')).status, 404);
  assert.equal((await get('/webhook', SECRET)).status, 404);
});

console.log = realLog;
console.log(JSON.stringify({suite: 'worker', passed: true, tests: pass, results}, null, 1));
