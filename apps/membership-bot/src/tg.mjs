// Bot API transport for the Worker. Same three guards the Mac mini handler enforced:
//  * only the methods the engine can actually name,
//  * only a destination that is a live opt-in session in THIS chat's journal,
//  * only an asset the catalogue can name (uploaded from the Worker's own static assets) or a
//    file_id this bot previously recorded from its own upload.
import {ANIMATIONS, STRIPS} from './schema.mjs';

// Exactly the Mac mini handler's allowlist, minus getUpdates (there is no polling here). The
// editMessage* family is deliberately absent: the bot's contract is one press, one new message, and
// the upstream test suite asserts that no edit method is ever called.
const SEND = ['sendMessage', 'sendPhoto', 'sendAnimation'];
// t63u adds the Bot API 10.4 widget calls (sendWidget, answerWidgetQuery, editMessageWidgetData —
// the only edit, and only on this bot's own widget messages in that chat) and 9.6 getManagedBotToken.
// t78u adds editMessageCaption / editMessageText, again only on a message this bot registered as one
// of its own widgets (or a widget's text fallback) in that chat: the tour's step caption.
const WIDGET = ['sendWidget', 'editMessageWidgetData', 'editMessageCaption', 'editMessageText'];
const EDITS = new Set(['editMessageWidgetData', 'editMessageCaption', 'editMessageText']);
export const ALLOWED = new Set(['getMe', 'getWebhookInfo', 'answerCallbackQuery', ...SEND, ...WIDGET, 'answerWidgetQuery', 'getManagedBotToken']);
// Destination-bearing calls. getMe/getWebhookInfo carry no chat.
const ADDRESSED = new Set([...SEND, ...WIDGET]);
// Only what the engine can name: the wide staff collages and the header animations.
// The per-person portraits are not shippable at all; they survive only as collage source.
const FILES = new Set([...STRIPS, ...ANIMATIONS]);
// Shape check only; the value must additionally be an id this bot recorded from its own upload.
const FILE_ID = /^[A-Za-z0-9_-]{16,200}$/;
const TIMEOUT_MS = 35000;

// By extension, and then checked against what the field can carry: a photo sent as video/mp4, or an
// animation sent as image/jpeg, is stored by Telegram as a document instead.
const contentType = name => name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/gif';
const ACCEPTS = {photo: ['image/jpeg'], animation: ['video/mp4', 'image/gif']};

async function assetBytes(env, name) {
  // Hostname is ignored by the assets binding; only the pathname selects the file.
  const r = await env.ASSETS.fetch(`https://assets.invalid/${name}`);
  if (!r.ok) throw Error('asset_unavailable');
  return new Uint8Array(await r.arrayBuffer());
}

async function post(env, method, body, upload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const init = {method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS)};
  if (upload) {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
      // An absent field must stay absent: multipart has no null, so String(undefined) would send
      // the literal text "undefined" as that parameter's value.
      if (k === upload.field || v === undefined || v === null) continue;
      form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    form.set(upload.field, new Blob([upload.bytes], {type: upload.type}), upload.name);
    init.body = form;
  } else {
    init.headers = {'content-type': 'application/json'};
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  const p = await r.json().catch(() => null);
  if (!p?.ok) {
    const e = Error('bot_api_error');
    e.code = Number(p?.error_code) || r.status;
    e.retryAfter = Number(p?.parameters?.retry_after) || 30;
    throw e;
  }
  return p.result;
}

// `journal()` returns the live per-chat journal so the opt-in and recorded-file_id checks read the
// same state the engine is mutating, exactly as the handler's closure over `g` did.
export function makeCall(env, journal) {
  return async function call(method, body) {
    if (!ALLOWED.has(method)) throw Error('method_not_allowed');
    const g = journal();
    if (ADDRESSED.has(method)) {
      if (!Number.isSafeInteger(body.chat_id) || !Object.values(g.sessions).some(s =>
        s.chatId === body.chat_id && s.userId === body.chat_id && g.optins[`${s.chatId}:${s.userId}`]
      )) throw Error('unbound_destination');
      if (EDITS.has(method)) {
        const w = g.t63u?.widgets?.[body.message_id];
        if (!w || w.chat !== body.chat_id || 'inline_message_id' in body) throw Error('unbound_widget');
      }
      body = {...body};
      for (const field of ['photo', 'animation']) if (field in body) {
        const name = body[field];
        if (typeof name !== 'string') throw Error('asset_not_allowed');
        if (FILES.has(name)) {
          const type = contentType(name);
          if (!ACCEPTS[field].includes(type)) throw Error('asset_not_allowed');
          return post(env, method, body, {field, name, bytes: await assetBytes(env, name), type});
        }
        if (!FILE_ID.test(name) || !Object.values(g.fileIds ?? {}).includes(name)) throw Error('asset_not_allowed');
      }
    }
    return post(env, method, body);
  };
}
