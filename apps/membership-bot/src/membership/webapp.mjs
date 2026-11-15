// Telegram Mini App plumbing shared by every page this Worker serves (/app/ and /verify):
//   * the one initData check (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
//   * the security headers of those pages and of their JSON APIs.
// Before v0.3.3 /app and /verify each carried their own copy of the check, with different limits
// (24 h / 1 h, and /verify accepted any future auth_date). Both now call verifyInitData below.

// Why 1 hour: Telegram signs initData once, when the Mini App is opened, and never refreshes it, so
// auth_date is the only thing that bounds a replay. initData is a bearer credential: anyone who
// gets hold of the string (a screenshot of devtools, a log line, a shared link with #tgWebAppData)
// can call the API as that person until it expires. The pages here are short tasks (pick a plan and
// pay, answer one question), and re-opening the app from Telegram issues fresh initData at once, so
// a 1-hour window costs a real user nothing while a leaked value stops working quickly.
export const INIT_DATA_MAX_AGE_S = 3600;
// Why 300 s into the future: a phone's clock can run a little ahead of ours; anything further ahead
// cannot come from a real Telegram client and would otherwise stretch the 1-hour window.
export const INIT_DATA_MAX_FUTURE_S = 300;
const MAX_LEN = 4096;

const enc = new TextEncoder();
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
// Constant-time compare of two lowercase hex strings of equal, fixed length.
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(key=secret, data_check_string)).
async function signatureOf(checkString, botToken) {
  const secret = await hmac('WebAppData', botToken);
  return hex(await hmac(secret, checkString));
}

// Returns {user: {id, first_name}, queryId, authDate} for initData Telegram signed for this bot
// within the window above, otherwise null. `queryId` is chat_join_request_query_id (guard-bot
// verification) when present. initDataUnsafe on the page is never trusted; only this result is.
export async function verifyInitData(raw, botToken, {now = Date.now(), maxAgeS = INIT_DATA_MAX_AGE_S, maxFutureS = INIT_DATA_MAX_FUTURE_S} = {}) {
  if (!botToken || typeof raw !== 'string' || !raw || raw.length > MAX_LEN) return null;
  const p = new URLSearchParams(raw);
  const keys = [...p.keys()];
  if (new Set(keys).size !== keys.length) return null; // a repeated field makes the check string ambiguous
  const hash = p.get('hash');
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return null;
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  if (!sameHex(await signatureOf(check, botToken), hash)) return null;
  const authS = p.get('auth_date') ?? '';
  if (!/^[0-9]{1,12}$/.test(authS)) return null;
  const auth = Number(authS), nowS = now / 1000;
  if (nowS - auth > maxAgeS || auth - nowS > maxFutureS) return null;
  let user;
  try { user = JSON.parse(p.get('user') ?? 'null'); } catch { return null; }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
  return {user: {id: user.id, first_name: String(user.first_name ?? '').slice(0, 64)}, queryId: p.get('chat_join_request_query_id') || null, authDate: auth};
}

// Builds initData the way Telegram does. Tests use it with a fake token; nothing in the Worker
// calls it at run time.
export async function signInitData(fields, botToken) {
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const p = new URLSearchParams(fields);
  p.set('hash', await signatureOf(check, botToken));
  return p.toString();
}

// ---------------------------------------------------------------------------------------------
// Security headers. Inline <script> blocks run only with the per-response nonce, so markup that
// ever reached the page through a bug could not run script. Styles stay 'unsafe-inline' because
// telegram-web-app.js itself injects a <style> element on Telegram Web (theme CSS sent by the
// parent frame) — checked against the published script, 2026-11-15.
// frame-ancestors: Telegram Web (web.telegram.org /k and /a) shows the app in an iframe; the
// mobile and desktop apps use their own web view, which frame-ancestors does not affect.
export const TELEGRAM_SDK = 'https://telegram.org/js/telegram-web-app.js';

export function newNonce() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, c => ({'+': '-', '/': '_', '=': ''}[c]));
}

export function contentSecurityPolicy(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://telegram.org`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'frame-ancestors https://web.telegram.org https://*.telegram.org',
  ].join('; ');
}

const COMMON = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000',
};

// A Mini App page. `cache` is no-store for /verify (one join request) and no-cache for /app/.
export function pageResponse(html, nonce, {cache = 'no-store'} = {}) {
  return new Response(html, {headers: {...COMMON, 'content-type': 'text/html; charset=utf-8', 'cache-control': cache,
    'content-security-policy': contentSecurityPolicy(nonce)}});
}

// JSON from a Mini App API. Never cached; sniffing off.
export function apiJson(body, status = 200) {
  return Response.json(body, {status, headers: {...COMMON, 'cache-control': 'no-store'}});
}
