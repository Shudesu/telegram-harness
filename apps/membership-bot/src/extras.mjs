// t63u additions that sit in front of the unchanged engine: the HTML widget (/widget, ✨ウィジェット,
// widget_query) and Managed Bots (/newbot, managed_bot). Everything here answers a press or a
// message from an opted-in user in their own private chat; nothing is ever sent unprompted.
// Returns null when the update is not ours, so the engine sees exactly what it saw before.
import {randomBytes} from 'node:crypto';
import {SCHEMAS} from './schema.mjs';
import {KEYBOARD_TEXT, replyKeyboard} from './menu.mjs';
import {FRESH, session} from './engine.mjs';
import {WIDGET_BUTTON, FALLBACK_DATA, LEGACY_TEXT, CAPTION, widgetHtml, nextDates, parseRequest} from './widget.mjs';
import {makeStudio, studioMatch, studioKeyboard} from './studio/flow.mjs';
import {planById} from './studio/plans.mjs';
import {BOT} from './schema.mjs';
import {NEWBOT_BUTTON, NOT_ENABLED_TEXT, DEFAULT_TEMPLATE, newbotKeyboard, templateFor, managedCall, sealToken, webhookSecret, managedConfigured} from './managed.mjs';

// t78u: /widget and ✨ウィジェット moved to the studio (the all-in-widget booking and the gallery). The
// t63u card is no longer sent, but presses on cards already in chats are still answered below.
const WIDGET_COMMANDS = new Set();
const NEWBOT_COMMANDS = new Set(['/newbot', '/newbot@teleharness_bot']);
const WIDGET_KEEP = 20;        // widget messages remembered per chat
const MIN_GAP_MS = 1500;        // at most one new widget / bot prompt per 1.5 s per user
const ME_TTL_MS = 10 * 60000;

// The bottom keyboard gains one row. The engine's own keyboard (menu.mjs) is untouched; this rewrites
// only the outgoing copy, so /start and /keyboard show the new button and the text says so.
export const EXTRA_ROW = [{text: WIDGET_BUTTON, style: 'success'}];
export const EXTRA_KEYBOARD_TEXT = KEYBOARD_TEXT.replace('ボタンを3つ', 'ボタンを4つ').replace('『📅 予約デモ』。', `『📅 予約デモ』『${WIDGET_BUTTON}』。`);
export function augment(method, body) {
  const kb = body?.reply_markup;
  if (method !== 'sendMessage' || !kb?.is_persistent || !Array.isArray(kb.keyboard)) return body;
  if (!kb.keyboard.flat().some(b => b.text === LEGACY_TEXT) || kb.keyboard.flat().some(b => b.text === WIDGET_BUTTON)) return body;
  return {...body, ...(body.text === KEYBOARD_TEXT ? {text: EXTRA_KEYBOARD_TEXT} : {}), reply_markup: {...kb, keyboard: [...kb.keyboard, EXTRA_ROW]}};
}

const ext = g => { const t = g.t63u ??= {widgets: {}, last: {}, pending: {}, bots: {}, me: null}; t.seen ??= {}; return t; };
const SEEN_MS = 48 * 3600000;
// Webhook redelivery of an update we already acted on must not repeat a send. The engine has its
// own journal; this is the same idea for the updates handled here.
function seen(t, updateId, now) {
  for (const [k, at] of Object.entries(t.seen)) if (now - at > SEEN_MS) delete t.seen[k];
  if (!Number.isSafeInteger(updateId)) return false;
  if (t.seen[updateId]) return true;
  t.seen[updateId] = now;
  return false;
}
// A human handoff (/pause, 人につないで) stops automation for that user, exactly as the engine does.
const paused = (g, id) => g.sessions[`${id}:${id}`]?.paused === true;
const privateMsg = m => m?.chat?.type === 'private' && Number.isSafeInteger(m.from?.id) && m.from.is_bot === false && m.from.id === m.chat.id && !m.forward_origin && !m.via_bot && !m.edit_date && Number.isSafeInteger(m.date);
const fresh = (m, now) => m.date * 1000 >= now - FRESH && m.date * 1000 <= now + 60000;
const keyOf = id => `${id}:${id}`;
// The transport only sends to a chat that has a live session; an opted-in user whose 24 h session
// expired gets one back the same way the engine and the Mini App adapter re-create it.
function bind(g, id, now) { (g.sessions[keyOf(id)] ??= session(id, id, now)).lastActive = now; }

// The main bot's keyboard with the widget row, for messages that put it back.
// t78u: the studio keyboard, the same one /start and /keyboard install.
function mainKeyboard() { return studioKeyboard(); }

// A message the engine can run, built from a press or a refused widget, so the fallback is the same
// rich flow the bottom keyboard's 📅 button opens.
function legacy(updateId, chat, from, messageId, now, text = LEGACY_TEXT) {
  return {update_id: updateId, message: {message_id: messageId, date: Math.floor(now / 1000), chat: {id: chat.id, type: 'private'}, from: {id: from.id, is_bot: false}, text}};
}

// t80u: real Stars sales (PAY_LIVE=1 with MEMBERSHIP=1). The membership object is the record of who
// paid; the studio only reads it (member card, /paysupport order list).
const ymd = ms => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
function liveHooks(env) {
  const on = env?.MEMBERSHIP === '1';
  const mo = () => env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`);
  return {
    live: on && env?.PAY_LIVE === '1',
    liveMember: on ? async userId => {
      const e = await mo().membership('app_member', {userId});
      return e ? {pl: planById(e.planId)?.name ?? e.title, until: e.expiresAt ? ymd(e.expiresAt) : '無期限', renew: e.autoRenew === true} : null;
    } : null,
    orders: on ? userId => mo().membership('app_orders', {userId}) : null,
    ticket: on ? (userId, text) => mo().membership('app_ticket', {userId, text}) : null,
  };
}

export async function handleExtra(g, update, io, deps) {
  const now = io.now();
  const t = ext(g);
  const m = update?.message;
  const isOurs = (m && typeof m.text === 'string' && (WIDGET_COMMANDS.has(m.text.trim()) || NEWBOT_COMMANDS.has(m.text.trim())))
    || update?.callback_query?.data === FALLBACK_DATA || update?.widget_query || update?.managed_bot || m?.managed_bot_created
    || studioMatch(update, t, g);
  if (!isOurs) return null;
  // Paused: commands and the fallback button go to the engine, which discards them like any other
  // input during a handoff; a widget request gets its mandatory answer and nothing else.
  const who = m?.from?.id ?? update?.callback_query?.from?.id ?? update?.widget_query?.from?.id;
  if (!update?.managed_bot && !m?.managed_bot_created && Number.isSafeInteger(who) && paused(g, who)) {
    if (update.widget_query) {
      await io.call('answerWidgetQuery', {widget_query_id: update.widget_query.id, data: JSON.stringify({e: '担当者対応中のため一時停止しています'})});
      return {handled: 'widget_paused'};
    }
    return null;
  }
  // Managed-bot events are idempotent by t.bots[botId].state instead: a failed set-up stays
  // 'setting_up' and is resumed by the next event for that bot (the service message, a redelivery,
  // a token change), so they are never marked seen.
  const managedEvent = Boolean(update?.managed_bot || m?.managed_bot_created);
  if (!managedEvent && seen(t, update.update_id, now)) { io.persist(g); return {handled: 'duplicate_update'}; }
  // Write-ahead: the marker is issued before any Bot API call, so the Durable Object output gate
  // holds the send until it is durable and a redelivery after a restart is still recognised.
  io.persist(g);

  // 0) t78u studio: /start tour, widget booking, gallery, keyboard, FAQ auto-reply, studio widgets.
  if (studioMatch(update, t, g)) {
    const h = {FALLBACK_DATA, LEGACY_TEXT, BOT, origin: deps.origin, keyOf, bind: id => bind(g, id, now), ...liveHooks(deps.env),
      legacy: (chatId, from, messageId, text) => legacy(update.update_id, {id: chatId}, from, messageId, now, text),
      newbot: (chatId, from) => newbot(g, t, io, deps, chatId, from, now)};
    const studio = makeStudio(g, t, io, h);
    if (m) {
      if (!privateMsg(m) || !fresh(m, now)) return {handled: 'ignored'};
      return studio.onText(m);
    }
    if (update.callback_query) return studio.onCallback(update.callback_query);
    return studio.onQuery(update.widget_query);
  }

  // 1) Widget: /widget or the ✨ button.
  if (m && typeof m.text === 'string' && WIDGET_COMMANDS.has(m.text.trim())) {
    if (!privateMsg(m) || !g.optins[keyOf(m.from.id)] || !fresh(m, now)) return {handled: 'ignored'};
    if (now - (t.last[m.chat.id] ?? 0) < MIN_GAP_MS) return {handled: 'throttled'};
    t.last[m.chat.id] = now;
    bind(g, m.chat.id, now);
    io.persist(g);
    const dates = nextDates(now);
    const body = {chat_id: m.chat.id, html: widgetHtml(dates), caption: CAPTION, allow_queries: true, protect_content: true,
      reply_markup: {inline_keyboard: [[{text: '📅 従来版で開く', callback_data: FALLBACK_DATA}]]}};
    try {
      const r = await io.call('sendWidget', body);
      if (!Number.isSafeInteger(r?.message_id)) throw Error('ambiguous_send');
      t.widgets[r.message_id] = {chat: m.chat.id, at: now, dates: dates.map(d => d.iso), booking: null};
      const ids = Object.keys(t.widgets).sort((a, b) => t.widgets[a].at - t.widgets[b].at);
      while (ids.length > WIDGET_KEEP) delete t.widgets[ids.shift()];
      io.persist(g);
      return {handled: 'widget_sent'};
    } catch (err) {
      // A 4xx proves nothing was delivered (no widget support for this bot / server): fall back to
      // the existing rich-message booking flow instead.
      if (Number.isInteger(err.code) && err.code >= 400 && err.code < 500) {
        io.persist(g);
        return {handled: 'widget_fallback', legacy: legacy(update.update_id, m.chat, m.from, m.message_id, now)};
      }
      throw err;
    }
  }

  // 2) The inline button under the widget: open the classic rich flow.
  const cb = update?.callback_query;
  if (cb?.data === FALLBACK_DATA) {
    const chat = cb.message?.chat;
    if (cb.from?.is_bot !== false || chat?.type !== 'private' || chat.id !== cb.from.id || !g.optins[keyOf(cb.from.id)]) return {handled: 'ignored'};
    await io.call('answerCallbackQuery', {callback_query_id: cb.id});
    return {handled: 'fallback_pressed', legacy: legacy(update.update_id, chat, cb.from, cb.message.message_id, now)};
  }

  // 3) A request from the widget.
  const wq = update?.widget_query;
  if (wq) {
    const answer = data => io.call('answerWidgetQuery', {widget_query_id: wq.id, data: JSON.stringify(data)});
    const w = t.widgets[wq.message_id];
    const ok = wq.from?.is_bot === false && wq.chat?.type === 'private' && wq.chat.id === wq.from.id && g.optins[keyOf(wq.from.id)] && w && w.chat === wq.chat.id && wq.type?.type === 'data';
    if (ok) bind(g, wq.chat.id, now);
    if (!ok) { await answer({e: 'このカードは使えません。/widget で出し直してください'}); return {handled: 'widget_query_refused'}; }
    const req = parseRequest(wq.data);
    if (!req) { await answer({e: '不明な操作です'}); return {handled: 'widget_query_bad'}; }
    if (req.reset) {
      try { await io.call('editMessageWidgetData', {chat_id: wq.chat.id, message_id: wq.message_id, chat_data: ''}); }
      catch (err) { if (err.code !== 400) throw err; } // "message is not modified" counts as done
      w.booking = null; io.persist(g);
      await answer({s: 'reset'});
      return {handled: 'widget_reset'};
    }
    if (w.booking) { await answer(w.booking); return {handled: 'widget_already'}; }
    const state = {r: `TEST-W-${randomBytes(3).toString('hex').toUpperCase()}`, i: req.i, d: req.d, t: req.t};
    try {
      await io.call('editMessageWidgetData', {chat_id: wq.chat.id, message_id: wq.message_id, chat_data: JSON.stringify(state)});
    } catch (err) {
      await answer({e: '確定できませんでした。もう一度押してください'});
      return {handled: 'widget_edit_failed'};
    }
    w.booking = state; t.lastIndustry = req.i; io.persist(g);
    await answer(state);
    return {handled: 'widget_booked'};
  }

  // 4) /newbot: the official request_managed_bot button.
  if (m && typeof m.text === 'string' && NEWBOT_COMMANDS.has(m.text.trim())) {
    if (!privateMsg(m) || !g.optins[keyOf(m.from.id)] || !fresh(m, now)) return {handled: 'ignored'};
    return {handled: await newbot(g, t, io, deps, m.chat.id, m.from, now)};
  }

  // 5) The created bot: Update.managed_bot or the Message.managed_bot_created service message.
  const created = update?.managed_bot ? {user: update.managed_bot.user, bot: update.managed_bot.bot}
    : m?.managed_bot_created ? {user: m.from, bot: m.managed_bot_created.bot} : null;
  if (created) {
    const {user, bot} = created;
    if (!Number.isSafeInteger(user?.id) || user.is_bot !== false || !Number.isSafeInteger(bot?.id) || bot.is_bot !== true) return {handled: 'ignored'};
    if (!g.optins[keyOf(user.id)] || !managedConfigured(deps.env)) return {handled: 'ignored'};
    if (t.bots[bot.id]?.state === 'ready') {
      // The service message repeats the creation; a ManagedBotUpdated for a ready bot is a token or
      // owner change, so the sealed token is refreshed (silently: nobody is messaged for it).
      if (!update?.managed_bot) return {handled: 'managed_duplicate'};
      if (deps.ownerOf && (await deps.ownerOf(bot.id)) !== user.id) return {handled: 'managed_owner_changed'};
      const fresh = await io.call('getManagedBotToken', {user_id: bot.id});
      if (typeof fresh !== 'string' || !fresh.includes(':')) throw Error('managed_token_unavailable');
      await deps.storeManagedBot(bot.id, {owner: user.id, industry: t.bots[bot.id].industry, username: bot.username ?? t.bots[bot.id].username, sealed: await sealToken(deps.env, fresh, bot.id), at: now});
      return {handled: 'managed_token_refreshed'};
    }
    const industry = t.pending[user.id]?.industry ?? DEFAULT_TEMPLATE;
    bind(g, user.id, now);
    t.bots[bot.id] = {state: 'setting_up', industry, username: bot.username ?? null, at: now};
    io.persist(g);
    const token = await io.call('getManagedBotToken', {user_id: bot.id});
    if (typeof token !== 'string' || !token.includes(':')) throw Error('managed_token_unavailable');
    const tpl = templateFor(industry);
    await managedCall(token, 'setMyDescription', {description: tpl.description});
    await managedCall(token, 'setMyShortDescription', {short_description: tpl.short_description});
    await managedCall(token, 'setMyCommands', {commands: tpl.commands});
    await deps.storeManagedBot(bot.id, {owner: user.id, industry, username: bot.username ?? null, sealed: await sealToken(deps.env, token, bot.id), at: now});
    await managedCall(token, 'setWebhook', {url: `${deps.origin}/${bot.id}/webhook`, secret_token: await webhookSecret(deps.env, bot.id),
      allowed_updates: ['message', 'callback_query'], max_connections: 1, drop_pending_updates: true});
    t.bots[bot.id].state = 'ready';
    delete t.pending[user.id];
    io.persist(g);
    const name = bot.username ? `@${bot.username}` : '新しいBot';
    await io.call('sendMessage', {chat_id: user.id,
      text: `✅ ${name} を作成し、テンプレ「${SCHEMAS[industry].label}」を設定しました。\nwebhook はこのWorkerに接続済み。開いて /start を押すと動きます（返信は作成者のあなたにだけ）。`,
      reply_markup: mainKeyboard()});
    return {handled: 'managed_ready'};
  }
  return null;
}

// /newbot: the official request_managed_bot button (also reached from the tour and 🤖 Bot作成).
async function newbot(g, t, io, deps, chatId, from, now) {
    if (now - (t.last[chatId] ?? 0) < MIN_GAP_MS) return 'throttled';
    t.last[chatId] = now;
    bind(g, chatId, now);
    io.persist(g);
    // Only a positive answer is cached, so the button appears as soon as the owner turns the
    // BotFather setting on.
    if (!t.me?.can || now - t.me.at > ME_TTL_MS) {
      const me = await io.call('getMe', {});
      t.me = {at: now, can: me?.can_manage_bots === true};
    }
    if (!t.me.can || !managedConfigured(deps.env)) {
      io.persist(g);
      await io.call('sendMessage', {chat_id: chatId, text: t.me.can ? '⏸ Managed Bots の保存鍵が未設定です。' : NOT_ENABLED_TEXT});
      return 'newbot_not_enabled';
    }
    const industry = Number.isInteger(t.lastIndustry) ? t.lastIndustry : DEFAULT_TEMPLATE;
    t.pending[from.id] = {industry, at: now};
    io.persist(g);
    await io.call('sendMessage', {chat_id: chatId,
      text: `下のボタンを1回押すと、あなた専用のBotがその場で作られます。\nテンプレ：${SCHEMAS[industry].label}（予約デモ）\n作成後、このWorkerが設定まで済ませます。`,
      reply_markup: newbotKeyboard(industry, randomBytes(2).toString('hex'))});
    return 'newbot_prompt';
}

export {NEWBOT_BUTTON};
