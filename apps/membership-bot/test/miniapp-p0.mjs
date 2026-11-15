// v0.3.3 Mini App P0: one initData check with the same limits everywhere, security headers on
// /app/ and /verify, the new page structure (tabs, bottom sheet, BackButton, theme) and the
// reserved app-lock routes. Stubs only: no network, no real token, no real chat id, no charge.
import assert from 'node:assert/strict';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const U = 70000501;
const W = await import('../src/membership/webapp.mjs');
const {appFetch, appHtml} = await import('../src/studio/app.mjs');
const {membershipFetch} = await import('../src/membership/http.mjs');
const {verifyPage} = await import('../src/membership/verify.mjs');
const {makeService} = await import('../src/membership/service.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const L = await import('../src/membership/applock.mjs');

const NOW = Date.UTC(2026, 10, 15, 12);
const sec = ms => String(Math.floor(ms / 1000));
const init = (fields = {}, token = TOKEN) => W.signInitData({auth_date: sec(NOW), query_id: 'AAH-test', user: JSON.stringify({id: U, first_name: 'T'}), ...fields}, token);

// A CHAT namespace that records every Durable Object call.
let doCalls = [];
const env = {BOT_TOKEN: TOKEN, CHAT: {getByName: name => new Proxy({}, {get: (_, op) => async (...args) => {
  doCalls.push({name, op, args});
  if (op === 'studioApp') return null;
  if (op === 'membership') return args[0] === 'verify' ? {ok: false, error: 'unauthorized'} : null;
  return null;
}})}};
const app = (path, {method = 'POST', body, now = NOW} = {}) => appFetch(new Request(`https://w.invalid${path}`, {method, headers: {'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), env, {now});

const results = [], failures = [];
async function test(name, fn) {
  try { doCalls = []; await fn(); results.push(name); }
  catch (err) { failures.push(name); console.error(`FAIL: ${name}\n  ${String(err?.message ?? err).split('\n').slice(0, 8).join('\n  ')}`); }
}

// ---------------------------------------------------------------- 1. one initData check
await test('1a. a value Telegram signed for this bot is accepted and gives the user and the join-request query id', async () => {
  const r = await W.verifyInitData(await init({chat_join_request_query_id: 'jrq-1'}), TOKEN, {now: NOW});
  assert.deepEqual(r, {user: {id: U, first_name: 'T'}, queryId: 'jrq-1', authDate: Math.floor(NOW / 1000)});
  assert.equal((await W.verifyInitData(await init(), TOKEN, {now: NOW})).queryId, null);
});

await test('1b. the limits are 1 hour old and 300 s ahead, and they are the same for /app and /verify', async () => {
  assert.equal(W.INIT_DATA_MAX_AGE_S, 3600);
  assert.equal(W.INIT_DATA_MAX_FUTURE_S, 300);
  const at = async ms => W.verifyInitData(await init({auth_date: sec(ms)}), TOKEN, {now: NOW});
  assert.ok(await at(NOW - 3600 * 1000), 'exactly 1 hour old');
  assert.equal(await at(NOW - 3601 * 1000), null, 'older than 1 hour');
  assert.ok(await at(NOW + 300 * 1000), '300 s ahead');
  assert.equal(await at(NOW + 301 * 1000), null, 'more than 300 s ahead');
});

await test('1c. tampering, another bot\'s token, a repeated field, a bad hash or auth_date, no user, oversize → refused', async () => {
  const good = await init();
  const v = s => W.verifyInitData(s, TOKEN, {now: NOW});
  assert.equal(await v(good.replace(/first_name%22%3A%22T/, 'first_name%22%3A%22X')), null, 'changed field');
  assert.equal(await v(await init({}, '1:OTHER-TOKEN')), null, 'other token');
  assert.equal(await v(`${good}&auth_date=${sec(NOW)}`), null, 'repeated field');
  assert.equal(await v(good.replace(/hash=[0-9a-f]+/, 'hash=XYZ')), null, 'hash not hex');
  assert.equal(await v(good.replace(/hash=([0-9a-f]+)/, (_, h) => `hash=${h.toUpperCase()}`)), null, 'uppercase hash');
  assert.equal(await v(await init({auth_date: '1e9'})), null, 'auth_date not an integer');
  assert.equal(await v(await init({user: JSON.stringify({id: -5})})), null, 'bad user id');
  assert.equal(await v(await init({user: 'not json'})), null, 'user not JSON');
  assert.equal(await v(await init({x: 'a'.repeat(4100)})), null, 'oversize');
  assert.equal(await v(''), null); assert.equal(await v(null), null);
  assert.equal(await W.verifyInitData(good, '', {now: NOW}), null, 'no token configured');
});

await test('1d. /app/api: 2-hour-old initData (accepted before, with the old 24 h limit) is now 401; fresh is 200', async () => {
  const old = await init({auth_date: sec(NOW - 2 * 3600 * 1000)});
  const r = await app('/app/api/state', {body: {initData: old}});
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), {error: 'unauthorized'});
  assert.equal(doCalls.length, 0, 'nothing reaches a Durable Object');
  assert.equal((await app('/app/api/state', {body: {initData: await init({auth_date: sec(NOW + 400 * 1000)})}})).status, 401, 'from the future');
  const ok = await app('/app/api/state', {body: {initData: await init()}});
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
});

await test('1e. /verify: initData from more than 300 s in the future (accepted before) is refused; within the window it works', async () => {
  let clock = NOW;
  const svc = makeService({store: memoryStore(), env: {BOT_TOKEN: TOKEN}, fetch: async () => Response.json({ok: true, result: true}), now: () => clock, rng: () => 0, origin: 'https://bot.example.invalid'});
  const ahead = await init({auth_date: sec(NOW + 3600 * 1000), chat_join_request_query_id: 'jrq-f'});
  assert.deepEqual(await svc.verifyApi('start', {initData: ahead}), {ok: false, error: 'unauthorized'});
  const fresh = await init({chat_join_request_query_id: 'jrq-f'});
  assert.deepEqual(await svc.verifyApi('start', {initData: fresh}), {ok: false, error: 'unknown_request'}, 'signature and time pass; no such join request');
  clock = NOW + 3601 * 1000;
  assert.deepEqual(await svc.verifyApi('start', {initData: fresh}), {ok: false, error: 'unauthorized'}, 'older than 1 hour');
});

await test('1f. there is one implementation: verify.mjs and app.mjs no longer carry their own HMAC check', async () => {
  const fs = await import('node:fs');
  for (const f of ['../src/studio/app.mjs', '../src/membership/verify.mjs', '../src/membership/service.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!src.includes('WebAppData'), `${f} has its own check`);
  }
});

// ---------------------------------------------------------------- 2. security headers
function scriptsOf(html) { return [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1]); }
function checkPage(r, html) {
  const csp = r.headers.get('content-security-policy');
  const nonce = /'nonce-([A-Za-z0-9_-]{16,})'/.exec(csp)?.[1];
  assert.ok(nonce, csp);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-[^']+' https:\/\/telegram\.org(;|$)/, 'only the nonce and the Telegram SDK');
  assert.ok(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), 'no unsafe-inline / unsafe-eval for scripts');
  assert.match(csp, /connect-src 'self'/); assert.match(csp, /object-src 'none'/); assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /frame-ancestors https:\/\/web\.telegram\.org https:\/\/\*\.telegram\.org/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(r.headers.get('permissions-policy').includes('camera=()'));
  assert.match(r.headers.get('content-type'), /^text\/html/);
  const tags = scriptsOf(html);
  assert.ok(tags.includes(' src="https://telegram.org/js/telegram-web-app.js"'), 'loads the Telegram SDK from telegram.org');
  for (const t of tags) assert.ok(t === ` nonce="${nonce}"` || t.includes('src="https://telegram.org/'), `script without the nonce: ${t}`);
  assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline event-handler attributes in the markup');
  return nonce;
}

await test('2a. GET /app/: strict CSP with a fresh nonce per response, nosniff, no-referrer; the inline script carries it', async () => {
  const r1 = await app('/app/', {method: 'GET'}), r2 = await app('/app/', {method: 'GET'});
  const n1 = checkPage(r1, await r1.text()), n2 = checkPage(r2, await r2.text());
  assert.notEqual(n1, n2, 'nonce changes per response');
  assert.equal(r1.headers.get('cache-control'), 'no-cache');
});

await test('2b. GET /verify (MEMBERSHIP=1): the same headers; /verify/start answers JSON with nosniff and no-store', async () => {
  const e = {...env, MEMBERSHIP: '1'};
  const r = await membershipFetch(new Request('https://w.invalid/verify'), e);
  assert.equal(r.status, 200);
  const html = await r.text();
  checkPage(r, html);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(html.includes('参加前の本人確認') && html.includes('/verify/start') && html.includes('/verify/answer'));
  const s = await membershipFetch(new Request('https://w.invalid/verify/start', {method: 'POST', body: '{}'}), e);
  assert.equal(s.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(s.headers.get('cache-control'), 'no-store');
});

await test('2c. the inline scripts of both pages parse', async () => {
  const body = (html, n) => html.slice(html.indexOf(`<script nonce="${n}">`) + `<script nonce="${n}">`.length, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(body(appHtml('N1'), 'N1')));
  assert.doesNotThrow(() => new Function(`return async () => {${body(verifyPage('N2'), 'N2')}}`));
});

// ---------------------------------------------------------------- 3. the page
await test('3a. /app/ page: home, four tabs, round shortcuts, notices, a bottom sheet, BackButton, SettingsButton, theme, haptics', async () => {
  const h = appHtml('N');
  for (const s of ['data-t=home', 'data-t=plans', 'data-t=card', 'data-t=more', 'class=acts', 'class=bn', 'id=sh ', 'role=dialog', 'aria-modal=true', 'id=shx',
    'BackButton', 'SettingsButton', 'disableVerticalSwipes', 'enableVerticalSwipes', 'themeChanged', 'setHeaderColor', 'setBottomBarColor',
    "selectionChanged", "impactOccurred('light')", 'notificationOccurred', 'CloudStorage', 'checkHomeScreenStatus', 'isVersionAtLeast',
    '--tg-theme-bg-color', '--tg-safe-area-inset-bottom', '--tg-content-safe-area-inset-top', 'prefers-reduced-motion',
    'MainButton', 'SecondaryButton', 'openInvoice', '準備中', 'light-dark(', '/paysupport']) assert.ok(h.includes(s), s);
});

await test('3b. no wording, prefix or brand copied from the app used as a reference', async () => {
  const pages = appHtml('N') + verifyPage('N');
  for (const s of ['Pintopay', 'PRC-', 'Insufficient funds', 'New Cards', "Let's get started", 'USDT']) assert.ok(!pages.includes(s), s);
});

await test('3c. bottom buttons are hidden with hide(), never given an empty text (the SDK throws on it), and hidden while a sheet is open', async () => {
  const h = appHtml('N');
  assert.ok(h.includes('if(!t){B.hide();return}'));
  assert.ok(!/setParams\(\{text:''/.test(h) && !/text:t\|\|' '/.test(h));
  assert.ok(h.includes('function main(t,f){LM=[t,f];if(shOn)t=') && h.includes('shOn=1;main(LM[0],LM[1]);sec(LS[0],LS[1])') && h.includes('shOn=0;main(LM[0],LM[1]);sec(LS[0],LS[1])'), 'native buttons are hidden while the sheet is open and restored after');
});

// ---------------------------------------------------------------- 4. app lock: names only
await test('4a. /app/api/lock* answers 501 app_lock_not_available for every method and touches no Durable Object', async () => {
  for (const [method, path] of [['GET', '/app/api/lock'], ['POST', '/app/api/lock/setup'], ['POST', '/app/api/lock/unlock'], ['DELETE', '/app/api/lock/bio/abc'], ['POST', '/app/api/lock/rescue']]) {
    const r = await app(path, {method, ...(method === 'POST' ? {body: {initData: await init()}} : {})});
    assert.equal(r.status, 501, path);
    assert.deepEqual(await r.json(), {error: 'app_lock_not_available'});
  }
  assert.equal(doCalls.length, 0);
  assert.equal((await app('/app/api/locked', {body: {}})).status, 404, 'only the reserved prefix');
});

await test('4b. reserved names: DO keys, routes, switch and secret; nothing is available yet', async () => {
  assert.equal(L.APP_LOCK_KEYS.lock(U), `lock:${U}`);
  assert.equal(L.APP_LOCK_KEYS.bio(U, 'd1'), `bio:${U}:d1`);
  assert.equal(L.APP_LOCK_KEYS.rescue(U), `rescue:${U}`);
  assert.deepEqual([L.APP_LOCK_SWITCH, L.APP_LOCK_PEPPER], ['APP_LOCK', 'APP_LOCK_PEPPER']);
  assert.ok(L.APP_LOCK_ROUTES.every(r => /^(GET|POST|DELETE) \/app\/api\/lock/.test(r)));
  assert.equal(L.appLockAvailable({APP_LOCK: '1', APP_LOCK_PEPPER: 'x'}), false);
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = new URL('../src/', import.meta.url).pathname;
  const files = fs.readdirSync(dir, {recursive: true}).filter(f => f.endsWith('.mjs') && !f.endsWith('applock.mjs'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/[`'"](lock|bio|rescue):/.test(src), `${f} uses a reserved key prefix`);
  }
});

console.log(JSON.stringify({suite: 'miniapp-p0', passed: results.length, failed: failures}, null, 1));
if (failures.length) process.exit(1);
