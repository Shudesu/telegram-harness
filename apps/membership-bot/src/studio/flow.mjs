// t78u "studio": /start guided tour, the all-in-widget booking flow, the /widgets gallery and the
// new bottom keyboard. Sits in front of the unchanged engine exactly like the t63u extras: it only
// answers an opted-in user in their own private chat, and only in reaction to their press.
// Authoritative state lives in the chat journal (g.studio, g.t63u.widgets); a widget's chat_data is
// a mirror the bot rewrites with editMessageWidgetData, so a flow never adds messages.
import {randomBytes, createHash} from 'node:crypto';
import {SCHEMAS} from '../schema.mjs';
import {KINDS, GALLERY, TOUR, POLL, FAQ, PLANS, html, parseBooking, bookingText, nextDates, slotsOf, tourCaption} from './widgets.mjs';
import {APP_PLANS, SALON, planById} from './plans.mjs';
import {termsText, paysupportText} from './legal.mjs';

export const KB = {book: '📅 予約', widgets: '✨ ウィジェット', tour: '🎓 ガイド', rich: '🎨 リッチ', pay: '💳 会員・決済', bot: '🤖 Bot作成'};
export const studioKeyboard = () => ({keyboard: [
  [{text: KB.book, style: 'primary'}, {text: KB.widgets}, {text: KB.tour}],
  [{text: KB.rich}, {text: KB.pay}, {text: KB.bot}],
], is_persistent: true, resize_keyboard: true, one_time_keyboard: false, input_field_placeholder: 'ボタンを押すか「料金は？」と送ってみてください'});
export const WELCOME = '👋 <b>Teleharness へようこそ</b>\n予約・会員・配信・自動応答を、すべてこのチャットの中で試せるデモBotです。\n下のボタンからいつでも各機能へ。まずは届いたガイドを『次へ』で進めてください。\n<i>※予約・ダッシュボードはデモです（実予約なし）。会員プランのお支払いは Telegram Stars で実際に決済されます</i>';

const BOT = '@teleharness_bot';
const cmd = (...names) => new Set(names.flatMap(n => n.startsWith('/') ? [n, n + BOT] : [n]));
const TEXTS = {
  start: cmd('/start'),
  book: cmd('/book', '/widget', KB.book),
  widgets: cmd('/widgets', KB.widgets, '✨ウィジェット'),
  tour: cmd('/tour', KB.tour),
  pay: cmd('/pay', KB.pay),
  rich: cmd(KB.rich),
  keyboard: cmd('/keyboard', 'キーボード'),
  bot: cmd(KB.bot),
  terms: cmd('/terms', '利用規約'),
  paysupport: cmd('/paysupport', '/support'),
};
// Typed questions answered by the FAQ bot while no booking-demo industry is selected (with one
// selected, the engine's own contextual FAQ answers instead).
const FAQ_TEXT = [[/^(料金|値段|価格|いくら)/, 0], [/^(営業時間|何時)/, 1], [/^(キャンセル)/, 2], [/^(駐車場)/, 3]];
const KEEP = 40, MIN_GAP_MS = 1500;

const SUPPORT_WITH_TEXT = /^\/paysupport(?:@teleharness_bot)?\s+(\S[\s\S]*)$/;
const commandOf = text => {
  const t = (text ?? '').trim();
  if (SUPPORT_WITH_TEXT.test(t)) return 'paysupport';
  for (const [k, set] of Object.entries(TEXTS)) if (set.has(t)) return k;
  return null;
};
const faqOf = text => { const t = (text ?? '').trim().normalize('NFKC'); return t.length <= 40 ? FAQ_TEXT.find(([re]) => re.test(t))?.[1] ?? null : null; };

// Is this update the studio's? `t` is the t63u journal extension (widgets registry).
export function studioMatch(update, t, g) {
  const m = update?.message;
  if (m && typeof m.text === 'string') {
    if (commandOf(m.text)) return true;
    const s = g?.sessions?.[`${m.chat?.id}:${m.from?.id}`];
    return faqOf(m.text) !== null && !s?.paused && (s?.industry ?? null) === null && Boolean(g?.optins?.[`${m.chat?.id}:${m.from?.id}`]);
  }
  const d = update?.callback_query?.data;
  if (typeof d === 'string' && /^(tu:[npk0gw]|ga:\d{1,2})$/.test(d)) return true;
  const wq = update?.widget_query;
  return Boolean(wq && t.widgets?.[wq.message_id]?.kind);
}

const st = g => { const s = g.studio ??= {}; s.tour ??= {s: 0, x: 0, d: 0}; return s; };
const tag = p => `${p}-${randomBytes(3).toString('hex').toUpperCase()}`;
const tourKeyboard = () => ({inline_keyboard: [
  [{text: '‹ 戻る', callback_data: 'tu:p'}, {text: '▶ 体験', callback_data: 'tu:g', style: 'primary'}, {text: '次へ ›', callback_data: 'tu:n'}],
  [{text: '⏭ スキップ', callback_data: 'tu:k'}, {text: '↺ 最初から', callback_data: 'tu:0'}],
]});
const galleryKeyboard = () => {
  const rows = [];
  GALLERY.forEach(([, e, name], k) => { if (k % 3 === 0) rows.push([]); rows.at(-1).push({text: `${e} ${name}`, callback_data: `ga:${k}`}); });
  return {inline_keyboard: rows};
};
const notModified = err => err?.code === 400;

// The epoch of the user's active booking, else tomorrow 19:00 JST: the countdown's target.
function nextVisit(g, now) {
  const b = st(g).booking;
  if (b && b.st === 'ok') {
    const at = Date.parse(`${b.iso}T${slotsOf(b.i)[b.t]}:00+09:00`);
    if (at > now) return {at, lb: `${SCHEMAS[b.i].short}・${b.label}`};
  }
  const d = nextDates(now, 1)[0];
  return {at: Date.parse(`${d.iso}T19:00:00+09:00`), lb: `${d.label} 19:00（サンプル）`};
}
export function memberNo(userId) {
  const h = createHash('sha256').update(`teleharness-member:${userId}`).digest('hex').toUpperCase();
  return `TH-${h.slice(0, 4)}-${h.slice(4, 8)}`;
}
// chat_data the widget starts with.
function initial(kind, g, now, chatId) {
  const s = st(g);
  if (kind === 'tu') return s.tour;
  if (kind === 'mc') return s.member ? {no: s.member.no, pl: s.member.pl, until: s.member.until, pt: 120} : {no: memberNo(chatId)};
  if (kind === 'cd') return nextVisit(g, now);
  if (kind === 'sc') return s.stamps ?? null;
  if (kind === 'vo') return s.vote ?? null;
  return null;
}

const LIVE_CAPTION = {
  pl: '💎 プラン比較：申し込むと Telegram Stars の支払い画面（Mini App）へ進みます。規約は /terms',
  mc: '🪪 会員証：お支払い済みの会員資格を表示します',
};

export function makeStudio(g, t, io, h) {
  const now = io.now();
  const S = st(g);

  // Sends one widget of `kind`; on a 4xx (client/server without widget support) falls back to text.
  async function send(kind, chatId, {caption} = {}) {
    if (now - (t.last[chatId] ?? 0) < MIN_GAP_MS) return 'throttled';
    t.last[chatId] = now;
    const dates = nextDates(now);
    let data = initial(kind, g, now, chatId);
    if (h.live && kind === 'pl') data = {lv: 1};
    if (h.live && kind === 'mc') {
      const e = h.liveMember ? await h.liveMember(chatId).catch(() => null) : null;
      data = e ? {no: memberNo(chatId), pl: e.pl, until: e.until, rn: e.renew ? 1 : 0, lv: 1} : {no: memberNo(chatId), lv: 1};
    }
    const cap = caption ?? (kind === 'tu' ? tourCaption(S.tour) : h.live && LIVE_CAPTION[kind] ? LIVE_CAPTION[kind] : KINDS[kind].caption);
    const reply_markup = kind === 'tu' ? tourKeyboard() : kind === 'ga' ? galleryKeyboard()
      : kind === 'bk' ? {inline_keyboard: [[{text: '📋 ボタン版で予約', callback_data: h.FALLBACK_DATA}]]} : undefined;
    io.persist(g);
    try {
      const r = await io.call('sendWidget', {chat_id: chatId, html: html(kind, data, now), caption: cap, allow_queries: true,
        ...(data ? {chat_data: JSON.stringify(data)} : {}), ...(reply_markup ? {reply_markup} : {})});
      if (!Number.isSafeInteger(r?.message_id)) throw Error('ambiguous_send');
      remember(r.message_id, {chat: chatId, at: now, kind, dates: dates.map(d => d.label), iso: dates.map(d => d.iso), st: kind === 'bk' ? null : undefined});
      return 'widget_sent';
    } catch (err) {
      if (!(Number.isInteger(err.code) && err.code >= 400 && err.code < 500)) throw err;
      if (kind === 'bk') return 'fallback_legacy';
      // No widget here: the same content as a plain message; the tour and gallery keep their buttons.
      const r = await io.call('sendMessage', {chat_id: chatId, text: kind === 'tu' ? cap : `${cap}\n（この端末ではウィジェットを表示できませんでした）`, ...(reply_markup ? {reply_markup} : {})});
      if (Number.isSafeInteger(r?.message_id)) remember(r.message_id, {chat: chatId, at: now, kind, fb: true});
      return 'widget_fallback_text';
    }
  }
  function remember(id, rec) {
    t.widgets[id] = rec;
    const ids = Object.keys(t.widgets).sort((a, b) => t.widgets[a].at - t.widgets[b].at);
    while (ids.length > KEEP) delete t.widgets[ids.shift()];
    io.persist(g);
  }
  async function setData(chatId, messageId, data) {
    try { await io.call('editMessageWidgetData', {chat_id: chatId, message_id: messageId, chat_data: data === null ? '' : JSON.stringify(data)}); }
    catch (err) { if (!notModified(err)) throw err; }
  }
  // The tour message shows its step twice: in the widget (chat_data) and in the caption, which is
  // what a client without widget support displays.
  async function showTour(chatId, messageId) {
    const rec = t.widgets[messageId];
    try {
      if (rec?.fb) await io.call('editMessageText', {chat_id: chatId, message_id: messageId, text: tourCaption(S.tour), reply_markup: tourKeyboard()});
      else {
        await setData(chatId, messageId, S.tour);
        await io.call('editMessageCaption', {chat_id: chatId, message_id: messageId, caption: tourCaption(S.tour), reply_markup: tourKeyboard()});
      }
    } catch (err) { if (!notModified(err)) throw err; }
  }

  // One tour action. Returns {handled, legacy?} like handleExtra.
  async function tourAct(a, chatId, messageId, from) {
    const T = S.tour, n = TOUR.length;
    if (a === 'n') { if (T.s + 1 < n) T.s++; else T.d = 1; }
    else if (a === 'p') { T.d = 0; T.s = Math.max(0, T.s - 1); }
    else if (a === 'k') T.d = 1;
    else if (a === '0') Object.assign(T, {s: 0, x: 0, d: 0});
    io.persist(g);
    if (a === 'w') return {handled: `tour_${await send('ga', chatId)}`};
    if (a === 'g') {
      if (T.d) return {handled: 'tour_done'};
      T.x |= 1 << T.s; io.persist(g);
      await showTour(chatId, messageId);
      const step = T.s;
      if (step === 0) return relay(await send('bk', chatId), chatId, from, messageId);
      if (step === 1) return {handled: `tour_${await send('pl', chatId)}`};
      if (step === 2) return {handled: 'tour_rich', legacy: h.legacy(chatId, from, messageId, '🎨 メッセージ作成')};
      if (step === 3) return {handled: `tour_${await send('fq', chatId)}`};
      if (step === 4) return {handled: `tour_${await h.newbot(chatId, from)}`};
      return {handled: `tour_${await send('da', chatId)}`};
    }
    await showTour(chatId, messageId);
    return {handled: `tour_${a}`};
  }
  const relay = (r, chatId, from, messageId) => r === 'fallback_legacy'
    ? {handled: 'widget_fallback', legacy: h.legacy(chatId, from, messageId, h.LEGACY_TEXT)} : {handled: r};

  async function payCard(chatId) {
    const rows = [[{text: '💎 チャットでプランを見る', callback_data: 'ga:5'}, {text: '🪪 会員証', callback_data: 'ga:4'}]];
    if (h.origin) rows.unshift([{text: '💳 決済画面を開く（アプリ）', web_app: {url: `${h.origin}/app/`}}]);
    await io.call('sendMessage', {chat_id: chatId, parse_mode: 'HTML', reply_markup: {inline_keyboard: rows},
      text: h.live
        ? `💳 <b>${SALON}・会員プラン</b>\n${APP_PLANS.map(p => `• ${p.name} ⭐${p.stars}／30日${p.recurring ? '（自動更新）' : ''}`).join('\n')}\nお支払いは Telegram Stars（公式の支払い画面）です。\nお申し込み前に /terms をご確認ください。お問い合わせ: /paysupport`
        : '💳 <b>会員・決済</b>\nプラン選択 → Stars で登録 → 会員証、までを試せます。\n<i>デモ：Stars はテスト表示のみで実請求はありません。カード・コンビニ・銀行振込は準備中です。</i>'});
    return 'pay_card';
  }

  // ---- entry points --------------------------------------------------------------------------
  async function onText(m) {
    const chatId = m.chat.id, from = m.from;
    const c = commandOf(m.text);
    if (c === 'start') {
      g.optins[h.keyOf(from.id)] = {since: g.optins[h.keyOf(from.id)]?.since ?? now, lastStartAt: m.date * 1000};
      h.bind(chatId);
      io.persist(g);
      if (now - (t.last[chatId] ?? 0) < MIN_GAP_MS) return {handled: 'throttled'};
      const resume = S.tour.s > 0 && !S.tour.d;
      await io.call('sendMessage', {chat_id: chatId, parse_mode: 'HTML', text: WELCOME, reply_markup: studioKeyboard()});
      const r = await send('tu', chatId, resume ? {caption: `▶ 前回の続き（${S.tour.s + 1}/${TOUR.length}）から再開します\n${tourCaption(S.tour)}`} : {});
      return {handled: resume ? `start_resume_${r}` : `start_${r}`};
    }
    if (c === 'terms' || c === 'paysupport') {
      // Required for Stars sales: answered for anyone who asks in their private chat, like /start.
      g.optins[h.keyOf(from.id)] ??= {since: now, lastStartAt: null};
      h.bind(chatId);
      io.persist(g);
      const body = SUPPORT_WITH_TEXT.exec(m.text.trim())?.[1];
      if (c === 'paysupport' && body) {
        // Not subject to the 1.5 s widget gap (a dropped request would be lost); the ticket store
        // limits it to 5 a day instead.
        if (body.length > 1000) {
          await io.call('sendMessage', {chat_id: chatId, text: `お問い合わせは1000文字以内でお送りください（いま${body.length}文字）。`});
          return {handled: 'paysupport_too_long'};
        }
        const r = h.ticket ? await h.ticket(from.id, body).catch(() => null) : null;
        await io.call('sendMessage', {chat_id: chatId, parse_mode: 'HTML', text: r?.status === 'created'
          ? `✅ お問い合わせを受け付けました（受付番号 <code>${r.id}</code>）。\n担当者が内容と注文を確認します。返金となる場合は Telegram Stars で全額返金され、Telegram から通知が届きます。`
          : r?.status === 'rate_limited' ? '本日のお問い合わせ件数の上限に達しました。明日あらためてお送りください。' : 'いまお問い合わせを受け付けられませんでした。時間をおいてもう一度お送りください。'});
        return {handled: 'paysupport_ticket'};
      }
      if (now - (t.last[chatId] ?? 0) < MIN_GAP_MS) return {handled: 'throttled'};
      t.last[chatId] = now;
      const text = c === 'terms' ? termsText() : paysupportText(h.orders ? await h.orders(from.id).catch(() => []) : []);
      await io.call('sendMessage', {chat_id: chatId, parse_mode: 'HTML', text, link_preview_options: {is_disabled: true}});
      return {handled: c};
    }
    if (!g.optins[h.keyOf(from.id)]) return {handled: 'ignored'};
    h.bind(chatId);
    if (c === 'book') return relay(await send('bk', chatId), chatId, from, m.message_id);
    if (c === 'widgets') return {handled: `gallery_${await send('ga', chatId)}`};
    if (c === 'tour') return {handled: `tour_${await send('tu', chatId)}`};
    if (c === 'pay') return {handled: await payCard(chatId)};
    if (c === 'keyboard') {
      await io.call('sendMessage', {chat_id: chatId, text: '⌨️ 入力欄の下にボタンを出しました（📅予約・✨ウィジェット・🎓ガイド・🎨リッチ・💳会員・決済・🤖Bot作成）。外す場合は /keyboard_off 。', reply_markup: studioKeyboard()});
      return {handled: 'keyboard'};
    }
    if (c === 'rich') return {handled: 'rich', legacy: h.legacy(chatId, from, m.message_id, '🎨 メッセージ作成')};
    if (c === 'bot') return {handled: await h.newbot(chatId, from)};
    const k = faqOf(m.text);
    await io.call('sendMessage', {chat_id: chatId, text: `🤖 ${FAQ[k][1]}\n\n（自動応答のデモ。✨ ウィジェット → 💬 FAQ でも試せます）`});
    return {handled: 'faq_auto'};
  }

  async function onCallback(cb) {
    const chat = cb.message?.chat;
    if (cb.from?.is_bot !== false || chat?.type !== 'private' || chat.id !== cb.from.id || cb.message?.from?.id !== h.BOT || !g.optins[h.keyOf(cb.from.id)]) return {handled: 'ignored'};
    h.bind(chat.id);
    await io.call('answerCallbackQuery', {callback_query_id: cb.id});
    const [p, a] = cb.data.split(':');
    if (p === 'tu') {
      const rec = t.widgets[cb.message.message_id];
      if (!rec || rec.kind !== 'tu' || rec.chat !== chat.id) return {handled: `tour_${await send('tu', chat.id)}`}; // an old/unknown tour message: deal a fresh one
      return tourAct(a, chat.id, cb.message.message_id, cb.from);
    }
    const kind = GALLERY[Number(a)]?.[0];
    if (!kind) return {handled: 'ignored'};
    if (kind === 'tu') Object.assign(S.tour, {s: 0, x: 0, d: 0});
    return relay(await send(kind, chat.id), chat.id, cb.from, cb.message.message_id);
  }

  async function onQuery(wq) {
    const answer = data => io.call('answerWidgetQuery', {widget_query_id: wq.id, data: JSON.stringify(data)});
    const rec = t.widgets[wq.message_id];
    const ok = wq.from?.is_bot === false && wq.chat?.type === 'private' && wq.chat.id === wq.from.id && g.optins[h.keyOf(wq.from.id)] && rec && rec.chat === wq.chat.id && wq.type?.type === 'data' && typeof wq.data === 'string';
    if (!ok) { await answer({e: 'このカードは使えません。/start で出し直してください'}); return {handled: 'widget_query_refused'}; }
    h.bind(wq.chat.id);
    const chatId = wq.chat.id, mid = wq.message_id, d = wq.data;
    const bad = async () => { await answer({e: '不明な操作です'}); return {handled: 'widget_query_bad'}; };
    // Any widget may ask for another one: 'ob' = booking, 'o<k>' = gallery entry k.
    if (/^o(b|\d{1,2})$/.test(d)) {
      const kind = d === 'ob' ? 'bk' : GALLERY[Number(d.slice(1))]?.[0];
      if (!kind) return bad();
      if (kind === 'tu') Object.assign(S.tour, {s: 0, x: 0, d: 0});
      const r = await send(kind, chatId);
      if (r === 'throttled') { await answer({e: '少し待ってからもう一度どうぞ'}); return {handled: 'widget_open_throttled'}; }
      await answer({ok: 1});
      return relay(r, chatId, wq.from, mid);
    }
    if (rec.kind === 'tu') {
      if (!/^[npk0gw]$/.test(d)) return bad();
      const r = await tourAct(d, chatId, mid, wq.from);
      await answer({ok: 1});
      return r;
    }
    if (rec.kind === 'bk') {
      const cur = rec.st;
      if (d === 'r') { await setData(chatId, mid, null); rec.st = null; io.persist(g); await answer({ok: 1}); return {handled: 'booking_reset'}; }
      if (d === 'l') {
        if (!cur) return bad();
        const at = new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
        await answer({l: `${cur.st === 'cx' ? '取消済み' : '有効'}（${at} 照会・ダミー）`});
        return {handled: 'booking_lookup'};
      }
      if (d === 'x') {
        if (!cur || cur.st === 'cx') return bad();
        const next = {...cur, st: 'cx'};
        await setData(chatId, mid, next); rec.st = next;
        if (S.booking?.r === cur.r) S.booking.st = 'cx';
        io.persist(g); await answer({ok: 1});
        return {handled: 'booking_cancelled'};
      }
      const b = parseBooking(d);
      if (!b) return bad();
      if (cur && cur.st === 'ok') { await answer(cur); return {handled: 'booking_already'}; }
      const next = {r: tag('TEST-B'), ...b, st: 'ok'};
      await setData(chatId, mid, next);
      rec.st = next;
      S.booking = {...next, iso: rec.iso?.[b.d], label: `${rec.dates?.[b.d] ?? ''} ${slotsOf(b.i)[b.t]}`, text: bookingText(b, rec.dates ?? []), at: now};
      t.lastIndustry = b.i; io.persist(g);
      await answer({ok: 1});
      return {handled: 'booking_confirmed'};
    }
    if (rec.kind === 'pl') {
      const m = /^y([0-2]|9)$/.exec(d);
      if (!m) return bad();
      if (h.live) {
        // Live: no TEST membership. The press sends the plan's Mini App button; payment, the order and
        // the membership all go through the real Stars flow there.
        if (m[1] === '9') { await setData(chatId, mid, {lv: 1}); await answer({ok: 1}); return {handled: 'plan_reset'}; }
        const p = APP_PLANS[Number(m[1])];
        if (!p || !h.origin) { await answer({e: '入力欄左の『💳 決済・会員』から申し込めます'}); return {handled: 'plan_no_origin'}; }
        if (now - (t.last[chatId] ?? 0) < MIN_GAP_MS) { await answer({e: '少し待ってからもう一度どうぞ'}); return {handled: 'plan_throttled'}; }
        t.last[chatId] = now; io.persist(g);
        await io.call('sendMessage', {chat_id: chatId, parse_mode: 'HTML',
          text: `💎 <b>${p.name}プラン</b> ⭐${p.stars}／30日${p.recurring ? '（自動更新）' : ''}\n下のボタンから Telegram Stars でお申し込みください。規約: /terms`,
          reply_markup: {inline_keyboard: [[{text: `⭐ ${p.name}を申し込む`, web_app: {url: `${h.origin}/app/?p=${p.id}`}}]]}});
        await setData(chatId, mid, {lv: 1, go: Number(m[1])});
        await answer({ok: 1});
        return {handled: 'plan_live_button'};
      }
      if (m[1] === '9') { await setData(chatId, mid, null); io.persist(g); await answer({ok: 1}); return {handled: 'plan_reset'}; }
      const p = Number(m[1]), next = {p, r: tag('TEST-S')};
      await setData(chatId, mid, next);
      S.member = {no: memberNo(chatId), pl: PLANS[p][0], until: until(now), via: 'chat_test', at: now};
      io.persist(g); await answer({ok: 1});
      return {handled: 'plan_test_paid'};
    }
    if (rec.kind === 'vo') {
      const m = /^v([0-3])$/.exec(d);
      if (!m) return bad();
      const k = Number(m[1]), next = {c: POLL.base.map((v, i) => v + (i === k ? 1 : 0)), m: k};
      await setData(chatId, mid, next); S.vote = next; io.persist(g); await answer({ok: 1});
      return {handled: 'vote'};
    }
    if (rec.kind === 'sc') {
      if (d !== 's' && d !== 's0') return bad();
      const cur = S.stamps ?? {n: 0};
      const next = d === 's0' ? {n: 0} : {n: Math.min(10, cur.n + 1), ...(cur.cp ? {cp: cur.cp} : {})};
      if (next.n >= 5 && !next.cp) next.cp = tag('TEST-C');
      await setData(chatId, mid, next); S.stamps = next; io.persist(g); await answer({ok: 1});
      return {handled: 'stamp'};
    }
    return bad();
  }

  return {onText, onCallback, onQuery, send};
}

export function until(now) {
  const d = new Date(now + 9 * 3600000 + 30 * 86400000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
