// Bot API 9.6 Managed Bots. Primary source: https://core.telegram.org/bots/api#keyboardbuttonrequestmanagedbot
//  * KeyboardButton.request_managed_bot: KeyboardButtonRequestManagedBot {request_id, suggested_name?, suggested_username?}
//    "Available for bots that enabled management of other bots in the @BotFather Mini App. Available in private chats only."
//  * the result arrives as Update.managed_bot (ManagedBotUpdated {user, bot}) and as Message.managed_bot_created {bot}
//  * getManagedBotToken {user_id} returns the managed bot's token as a String
//  * User.can_manage_bots (getMe only) says whether the setting is on
// The managed bot's token is encrypted (AES-GCM, key from the MANAGED_BOT_KEY secret) before it is
// stored, is never logged, and is only ever placed in the Bot API URL of that bot's own requests.
import {SCHEMAS} from './schema.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function hmac(env, label) {
  if (!/^[0-9a-f]{64}$/.test(env.MANAGED_BOT_KEY ?? '')) throw Error('managed_key_missing');
  const raw = Uint8Array.from(env.MANAGED_BOT_KEY.match(/../g), h => parseInt(h, 16));
  const k = await crypto.subtle.importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(label));
}
const aesKey = async env => crypto.subtle.importKey('raw', await hmac(env, 'teleharness:managed:aes'), 'AES-GCM', false, ['encrypt', 'decrypt']);

export const managedConfigured = env => /^[0-9a-f]{64}$/.test(env.MANAGED_BOT_KEY ?? '');
// The secret_token the managed bot's webhook must present. Derived, so nothing extra is stored.
export const webhookSecret = async (env, botId) => hex(await hmac(env, `teleharness:managed:webhook:${botId}`));

export async function sealToken(env, token, botId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: enc.encode(String(botId))}, await aesKey(env), enc.encode(token));
  return {iv: b64(iv), ct: b64(ct)};
}
export async function openToken(env, sealed, botId) {
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: enc.encode(String(botId))}, await aesKey(env), unb64(sealed.ct));
  return dec.decode(pt);
}

export const NEWBOT_BUTTON = '🤖 1タップで自分のBotを作る';
export const DEFAULT_TEMPLATE = 1; // 美容室

export function newbotKeyboard(industry, rand) {
  const c = SCHEMAS[industry];
  return {
    keyboard: [
      [{text: NEWBOT_BUTTON, style: 'primary', request_managed_bot: {request_id: 1, suggested_name: `${c.short} 予約デモ`, suggested_username: `th_${c.id}_${rand}_bot`}}],
      [{text: 'キーボード'}],
    ],
    resize_keyboard: true, one_time_keyboard: true,
    input_field_placeholder: '上のボタンを1回押すだけ',
  };
}

export const NOT_ENABLED_TEXT = '⏸ Managed Bots はまだ使えません。@BotFather の Mini App で @teleharness_bot の「他のBotの管理（management of other bots）」を有効にすると、/newbot で作成ボタンが出ます。';

// What the created bot is told to be: one of the nine industries, as description and commands.
export function templateFor(industry) {
  const c = SCHEMAS[industry];
  return {
    description: `${c.label}の予約デモBotです（@teleharness_bot から作成）。/start でメニュー。TEST専用・実予約／実請求なし。`,
    short_description: `${c.label}の予約デモ（TEST専用）`,
    commands: [{command: 'start', description: 'メニューを開く'}, {command: 'book', description: 'ダミー予約'}],
  };
}

// Bot API caller for a managed bot. Its own allowlist; the main bot's transport never sees this token.
const MANAGED_ALLOWED = new Set(['getMe', 'setMyDescription', 'setMyShortDescription', 'setMyCommands', 'setWebhook', 'sendMessage', 'answerCallbackQuery']);
export async function managedCall(token, method, body) {
  if (!MANAGED_ALLOWED.has(method)) throw Error('method_not_allowed');
  let r;
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
  } catch { throw Error('managed_bot_network_error'); } // never let a URL with the token reach a log
  const p = await r.json().catch(() => null);
  if (!p?.ok) { const e = Error('managed_bot_api_error'); e.code = Number(p?.error_code) || r.status; throw e; }
  return p.result;
}

// The created bot's own conversation: it answers only its creator, in their private chat.
export function managedReply(rec, update) {
  const c = SCHEMAS[rec.industry];
  const m = update?.message, cb = update?.callback_query;
  const owner = rec.owner;
  if (m) {
    if (m.chat?.type !== 'private' || m.from?.id !== owner || m.chat.id !== owner || typeof m.text !== 'string') return null;
    const services = c.services.map((s, i) => [{text: `${s.brief} ${s.minutes}分 ¥${s.yen.toLocaleString('ja-JP')}`, callback_data: `s${i}`}]);
    return {steps: [{method: 'sendMessage', body: {chat_id: owner, text: `✨ ${c.label}の予約デモBotです。\nメニューを選ぶとダミー予約を受け付けます（実予約・実請求なし）。`, reply_markup: {inline_keyboard: services}}}]};
  }
  if (cb) {
    if (cb.from?.id !== owner || cb.message?.chat?.id !== owner || !/^s[01]$/.test(cb.data ?? '')) return cb?.id ? {steps: [{method: 'answerCallbackQuery', body: {callback_query_id: cb.id}}]} : null;
    const s = c.services[Number(cb.data[1])];
    const ref = `TEST-M-${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
    return {steps: [
      {method: 'answerCallbackQuery', body: {callback_query_id: cb.id, text: '受け付けました（ダミー）'}},
      {method: 'sendMessage', body: {chat_id: owner, text: `✅ ダミー予約を受け付けました\n${c.label}・${s.name}\n受付 ${ref}\n実予約・実請求はありません。`}},
    ]};
  }
  return null;
}
