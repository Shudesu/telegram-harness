// Phase 1 membership: paid member group with no human in the loop (01 + 07 + 11, Stars first).
//
//   pay button / /plans ──► createCheckout (Stars invoice or external checkout URL)
//   pre_checkout_query ──► answerPreCheckoutQuery (order re-checked)
//   successful_payment / PSP webhook ──► NormalizedEvent ──► entitlement (expiresAt = paid + period)
//   chat_join_request ──► entitled? ──► button + question (guard-bot Mini App, else DM) ──► approve/decline
//   cron ──► expired / grace over / verification timed out ──► ban→unban / decline
//   refund / cancel ──► revoke ──► ban→unban
//
// Every Telegram write is a gate request (gate.mjs): it runs automatically only under a rule the owner
// approved in advance; otherwise it waits in the approval queue, and when the owner approves it the
// workflow it belongs to is resumed (`resume` + the gate's prepare/after hooks).
import {makeGate} from './gate.mjs';
import {makeExec} from './telegram.mjs';
import {PROVIDERS, providerStatus, startCheckout} from './providers/index.mjs';
import {eventsFromUpdate, orderOfPayload} from './providers/stars.mjs';
import {assertEvent, GOODS_KINDS} from './providers/contract.mjs';
import {parsePayCallback} from '../richmsg/pay.mjs';
import {VERIFY_TIMEOUT_MS, pickQuestion, isCorrect, parseVerifyCallback, checkInitData} from './verify.mjs';

const DAY = 86400000;
// Calendar interval matching the external PSP's billing (Stripe: 7 → week, 30/31 → month, 365/366 → year).
export function addInterval(ms, days) {
  const d = new Date(ms);
  if (days === 30 || days === 31) d.setUTCMonth(d.getUTCMonth() + 1);
  else if (days === 365 || days === 366) d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCDate(d.getUTCDate() + days);
  return d.getTime();
}
const REMOVE_RETRIES = 5, DECISION_RETRIES = 5;
// The rich-message pay button and /plans share one callback grammar: pay/<skuId>/<provider>.
export const parsePayData = parsePayCallback;

class Pending extends Error {
  constructor(approvalId) { super('pending_approval'); this.approvalId = approvalId; }
}

export function makeService({store, env = {}, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), rng = Math.random, origin = ''}) {
  const exec = makeExec(env, fetchImpl);
  const tenantId = env.TENANT_ID ?? 'main';
  const graceMs = (Number(env.MEMBER_GRACE_DAYS) || 3) * DAY;
  const gate = makeGate({store, exec, now, hooks: {
    // A queued ban is approved minutes or days later: its until_date is recomputed at execution, or
    // Telegram would read a date in the past as a permanent ban.
    prepare: async a => {
      const r = a.resume;
      if (r?.kind === 'remove' && await stillEntitled(r.userId, r.chatId, null)) return null;            // repurchased meanwhile
      if (r?.kind === 'join_decision' && r.approve && !(await entitledFor(r.userId, r.chatId))) return null; // refunded/expired meanwhile
      return a.method === 'banChatMember' ? {...a.params, until_date: Math.floor(now() / 1000) + 60} : a.params;
    },
    after: (a, out) => resumeAfterApproval(a, out),
  }});

  // A gated write. Returns the Bot API result, or null when it was queued for approval (or failed).
  // With `strict`, a queued write throws Pending and a failed one throws its error.
  async function write(condition, method, params, extra = {}, strict = false) {
    const out = await gate.request({condition, method, params, chatId: extra.chatId, reason: extra.reason, target: extra.target, resume: extra.resume}, {queueOnly: Boolean(extra.queueOnly)});
    if (out.status === 'executed') return out.result ?? true;
    if (strict) { if (out.status === 'pending_approval') throw new Pending(out.approvalId); throw Object.assign(Error(out.error), {code: out.code}); }
    return null;
  }
  const request = (condition, method, params, extra = {}, opts = {}) => gate.request({condition, method, params, ...extra}, opts);

  // ---------- catalogue ----------
  async function setPlan(plan) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(plan?.id ?? '')) throw Error('bad_plan_id');
    if (!GOODS_KINDS.includes(plan.goodsKind)) throw Error('goods_kind_required');
    if (!Array.isArray(plan.chats) || !plan.chats.every(Number.isSafeInteger)) throw Error('bad_chats');
    for (const s of plan.skus ?? []) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(s.id ?? '') || !Number.isSafeInteger(s.amount) || s.amount < 1) throw Error('bad_sku');
      const owner = await findSku(s.id);
      if (owner && owner.plan.id !== plan.id) throw Error('duplicate_sku_id'); // pay/<skuId>/… must name one product
      if ((plan.skus ?? []).filter(x => x.id === s.id).length > 1) throw Error('duplicate_sku_id');
      if (!['XTR', 'JPY'].includes(s.currency)) throw Error('bad_currency');
      if (s.days !== null && !(Number.isSafeInteger(s.days) && s.days > 0)) throw Error('bad_days');
      if (s.recurring && s.days === null) throw Error('recurring_needs_days');
      if (s.recurring && plan.goodsKind === 'digital' && (s.currency !== 'XTR' || s.days !== 30)) throw Error('stars_subscription_is_30_days_xtr');
    }
    const rec = {id: plan.id, title: String(plan.title ?? plan.id), ...(plan.description ? {description: String(plan.description).slice(0, 255)} : {}), goodsKind: plan.goodsKind, chats: [...plan.chats],
      links: plan.links ?? {}, skus: (plan.skus ?? []).map(s => ({...s, recurring: Boolean(s.recurring)})), listed: plan.listed !== false};
    await store.put(`plan:${rec.id}`, rec);
    // Groups added to a plan later (it launched without one) reach the members who already paid for it.
    if (rec.chats.length) {
      const t = now();
      for (const e of await store.list('ent:')) {
        if (e.planId !== rec.id || !isLive(e, t) || rec.chats.every(c => e.chats.includes(c))) continue;
        const added = rec.chats.filter(c => !e.chats.includes(c));
        e.chats = [...new Set([...e.chats, ...rec.chats])];
        await store.put(entKey(e.userId, e.planId), e);
        const links = added.map(c => rec.links?.[c]).filter(Boolean);
        // Gated like every member notice: queued until the owner enables member_notice or approves it.
        if (links.length) await write('member_notice', 'sendMessage', {chat_id: e.userId,
          text: `👥 「${rec.title}」の会員グループを開設しました。下のボタンから参加申請してください。`,
          reply_markup: {inline_keyboard: links.map((url, i) => [{text: `👥 グループ${i + 1}に参加申請`, url}])}}, {reason: `plan:${rec.id}`});
      }
    }
    await gate.audit({kind: 'plan_set', planId: rec.id});
    return rec;
  }
  async function findSku(skuId) {
    for (const p of await store.list('plan:')) { const s = p.skus.find(x => x.id === skuId); if (s) return {plan: p, sku: s}; }
    return null;
  }

  // ---------- checkout ----------
  async function nextOrderId() {
    const n = ((await store.get('seq:order')) ?? 0) + 1;
    await store.put('seq:order', n);
    return `o${n}${Math.floor(rng() * 1e6).toString(36)}`;
  }

  async function sendCheckoutLink(order, result) {
    if (!Number.isSafeInteger(order.chatId) || result.kind === 'invoice_message') return;
    const text = result.kind === 'bank_transfer'
      ? `お振込先（この注文専用）\n${Object.entries(result.instructions ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')}\n入金を確認すると自動で会員になります。`
      : `${order.terms.title}\nお支払いはこちらから。支払いが完了すると自動で会員になります。`;
    await write('buyer_requested', 'sendMessage', {chat_id: order.chatId, text,
      ...(result.url ? {reply_markup: {inline_keyboard: [[{text: result.kind === 'url' ? '💳 決済ページを開く' : '⭐ Starsで支払う', url: result.url}]]}} : {})},
    {chatId: order.chatId, reason: `order:${order.id}`});
  }

  // t79u: `deliverTo` is where a link is sent if the checkout first waits for owner approval (the
  // Mini App asks for an invoice LINK, so chatId stays null); `silent` skips the immediate link
  // message because the Mini App opens the link itself.
  async function checkout({userId, chatId, skuId, provider, callbackId, deliverTo = null, silent = false}) {
    const found = await findSku(skuId);
    const ack = text => callbackId && write('buyer_requested', 'answerCallbackQuery', {callback_query_id: callbackId, ...(text ? {text} : {})}, {chatId});
    if (!found || !found.plan.listed) { await ack('この商品は現在販売していません'); return {status: 'unknown_sku'}; }
    const {plan, sku} = found;
    const orderId = await nextOrderId();
    // The purchased terms are frozen on the order: a later catalogue edit never changes what was bought.
    const terms = {planId: plan.id, planTitle: plan.title, title: sku.title ?? plan.title, days: sku.days, recurring: Boolean(sku.recurring),
      chats: [...plan.chats], links: {...plan.links}};
    const input = {tenantId, planSkuId: sku.id, orderId, telegramUserId: userId, amount: sku.amount, currency: sku.currency,
      goodsKind: plan.goodsKind, title: terms.title, description: plan.description ?? `${plan.title}（${sku.days ? `${sku.days}日間` : '期限なし'}）`,
      recurring: sku.recurring ? {intervalDays: sku.days} : undefined, idempotencyKey: orderId, chatId,
      returnUrl: `https://t.me/${env.BOT_USERNAME ?? 'teleharness_bot'}?start=paid_${orderId}`};
    const order = {id: orderId, userId, chatId: chatId ?? deliverTo, skuId: sku.id, planId: plan.id, provider, amount: sku.amount, currency: sku.currency,
      goodsKind: plan.goodsKind, terms, state: 'awaiting_payment', createdAt: now()};
    let result;
    try {
      result = await startCheckout(provider, input, {env, fetch: fetchImpl, now,
        call: (method, params) => write('buyer_requested', method, params, {chatId, reason: `order:${orderId}`, resume: {kind: 'checkout', orderId}}, true)});
    } catch (err) {
      const pending = err instanceof Pending;
      await gate.audit({kind: pending ? 'checkout_queued' : 'checkout_refused', orderId, provider, error: pending ? null : String(err?.message ?? err)});
      await ack(pending ? '確認中です。しばらくお待ちください' : 'この支払い方法は使えません');
      if (pending) { order.state = 'awaiting_approval'; await store.put(`order:${orderId}`, order); return {status: 'pending_approval', orderId}; }
      return {status: 'refused', error: String(err?.message ?? err)};
    }
    order.externalRef = result.externalRef;
    await store.put(`order:${orderId}`, order);
    if (result.kind === 'bank_transfer') await store.put(`bankva:${result.externalRef}`, {orderId});
    await ack();
    if (!silent) await sendCheckoutLink(order, result);
    await gate.audit({kind: 'checkout_created', orderId, provider, checkoutKind: result.kind});
    return {status: 'created', orderId, result};
  }

  async function preCheckout(q) {
    const orderId = orderOfPayload(q.invoice_payload);
    const order = orderId && await store.get(`order:${orderId}`);
    const valid = order && order.state === 'awaiting_payment' && order.userId === q.from?.id && order.provider === 'telegram_stars'
      && order.currency === q.currency && order.amount === q.total_amount;
    const params = valid ? {pre_checkout_query_id: q.id, ok: true}
      : {pre_checkout_query_id: q.id, ok: false, error_message: 'この注文は無効になりました。もう一度購入ボタンから手続きしてください。'};
    return (await request(valid ? 'order_valid' : 'order_invalid', 'answerPreCheckoutQuery', params, {chatId: order?.chatId, reason: `order:${orderId ?? '-'}`})).status;
  }

  // ---------- entitlements ----------
  // ent.grants[orderId] = {ms: time this order added (null = permanent), at}. Refunding one order
  // takes back only its own time; access ends when nothing paid for is left.
  const entKey = (userId, planId) => `ent:${userId}:${planId}`;
  const isLive = (e, t) => e && ['active', 'grace'].includes(e.state) && (e.expiresAt === null || e.expiresAt > t || (e.state === 'grace' && e.graceUntil > t));

  async function grant(order, e) {
    const key = entKey(order.userId, order.planId), t = now();
    // A renewal also carries any group the plan gained after the first purchase.
    const planNow = await store.get(`plan:${order.planId}`);
    const terms = {...order.terms, chats: [...new Set([...(order.terms.chats ?? []), ...(planNow?.chats ?? [])])],
      links: {...(planNow?.links ?? {}), ...(order.terms.links ?? {})}};
    const ent = (await store.get(key)) ?? {userId: order.userId, planId: order.planId, chats: [], state: 'new', expiresAt: 0, grants: {}};
    const grantKey = e.type === 'renewed' ? `${order.id}:${e.id}` : order.id;
    if (ent.grants?.[grantKey] && isLive(ent, t)) return; // already applied (redelivery after a partial failure)
    const live = isLive(ent, t);
    // Grants that no longer contribute (the term they were part of has ended) are dropped, so a later
    // refund of them cannot shorten a newer, separately paid term.
    if (!live || !ent.grants) ent.grants = {};
    const start = live && ent.expiresAt !== null && ent.expiresAt ? Math.max(ent.expiresAt, t) : t;
    // added = what this purchase itself is worth (null = permanent), independent of the effective expiry.
    let expiresAt, added;
    if (terms.days === null) { added = null; expiresAt = null; }                                     // permanent: never swept
    else if (e.periodEnd) { added = Math.max(0, e.periodEnd * 1000 - start); expiresAt = Math.max(e.periodEnd * 1000, start); } // provider period is the truth
    else if (terms.recurring && order.provider !== 'telegram_stars') { expiresAt = addInterval(start, terms.days); added = expiresAt - start; } // same calendar interval the PSP bills on
    else { added = terms.days * DAY; expiresAt = start + added; }                                    // stack inside the term
    if (live && ent.expiresAt === null) expiresAt = null;                                            // already permanent
    ent.grants[grantKey] = {orderId: order.id, paymentRef: e.paymentRef ?? null, ms: added, at: t};
    Object.assign(ent, {state: 'active', expiresAt, graceUntil: null, chats: live ? [...new Set([...ent.chats, ...terms.chats])] : [...terms.chats],
      sourceOrderId: order.id, provider: order.provider, paymentRef: e.paymentRef ?? ent.paymentRef, subscriptionRef: e.subscriptionRef ?? ent.subscriptionRef,
      autoRenew: terms.recurring, lastEventAt: e.occurredAt, removal: null});
    await store.put(key, ent);
    await gate.audit({kind: 'entitlement_granted', userId: order.userId, planId: order.planId, orderId: order.id, expiresAt});
    const links = terms.chats.map(c => terms.links?.[c]).filter(Boolean);
    await write('member_notice', 'sendMessage', {chat_id: order.userId,
      text: `🎉 購入ありがとうございます。「${terms.planTitle}」の会員になりました。\n期限: ${expiresAt === null ? 'なし' : new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'}\n${links.length ? '下のボタンで参加申請→Botが自動で確認・承認します。' : '会員グループは準備中です。開設しだいこのチャットでご案内します。'}\nお問い合わせ: /paysupport`,
      ...(links.length ? {reply_markup: {inline_keyboard: links.map((url, i) => [{text: `👥 グループ${i + 1}に参加申請`, url}])}} : {})},
    {reason: `order:${order.id}`});
  }

  async function endEntitlement(ent, state, reason) {
    ent.state = state; ent.endedAt = now(); ent.endReason = reason;
    ent.removal = {chats: [...ent.chats], tries: 0, pendingApproval: []};
    await store.put(entKey(ent.userId, ent.planId), ent);
    await gate.audit({kind: 'entitlement_ended', userId: ent.userId, planId: ent.planId, state, reason});
    await removeFromChats(ent);
  }

  // Another plan may still give this user the same chat; then that chat is not removed.
  async function stillEntitled(userId, chatId, exceptPlan) {
    const t = now();
    return (await store.list(`ent:${userId}:`)).some(e => e.planId !== exceptPlan && isLive(e, t) && e.chats.includes(chatId));
  }

  // ban→unban = removal without a lasting ban (01 §1-2). Refund/expiry and removal are deliberately
  // not one transaction: a Telegram failure leaves the chat in `removal.chats` for the next cron run.
  async function removeFromChats(ent) {
    const left = [];
    for (const chatId of ent.removal.chats) {
      if (await stillEntitled(ent.userId, chatId, ent.planId)) continue;
      const until = Math.floor(now() / 1000) + 60; // if the unban never lands, the ban lapses in a minute
      const b = await request('entitlement_ended', 'banChatMember', {chat_id: chatId, user_id: ent.userId, until_date: until, revoke_messages: false},
        {chatId, reason: ent.endReason, target: ent.userId, resume: {kind: 'remove', userId: ent.userId, planId: ent.planId, chatId}});
      if (b.status === 'pending_approval') { ent.removal.pendingApproval.push(chatId); continue; }
      if (b.status !== 'executed') { left.push(chatId); continue; }
      const u = await request('entitlement_ended', 'unbanChatMember', {chat_id: chatId, user_id: ent.userId, only_if_banned: true},
        {chatId, reason: ent.endReason, target: ent.userId});
      if (u.status !== 'executed') left.push(chatId); // a queued/failed unban is retried; the ban lapses in 60 s anyway
    }
    ent.removal.tries++;
    ent.removal.chats = left;
    ent.removal.done = !left.length && ent.removal.pendingApproval.length === 0;
    if (left.length && ent.removal.tries >= REMOVE_RETRIES) { ent.removal.needsReview = true; await gate.audit({kind: 'removal_needs_review', userId: ent.userId, planId: ent.planId}); }
    await store.put(entKey(ent.userId, ent.planId), ent);
  }

  async function orderForEvent(e) {
    if (e.orderId) return store.get(`order:${e.orderId}`);
    // Disputes and some refunds carry no metadata: correlate through the payment / subscription ref.
    for (const k of [e.paymentRef && `payref:${e.provider}:${e.paymentRef}`, e.subscriptionRef && `subref:${e.provider}:${e.subscriptionRef}`]) {
      const ref = k && await store.get(k);
      if (ref) return store.get(`order:${ref.orderId}`);
    }
    return null;
  }

  // Each step is idempotent and the dedup marker is written last, so a failure part-way through is
  // completed by the redelivery instead of being swallowed as a duplicate.
  async function applyEvent(e) {
    assertEvent(e);
    if (await store.get(`event:${e.id}`)) return {status: 'duplicate'};
    const out = await applyEventOnce(e);
    await store.put(`event:${e.id}`, {at: now(), type: e.type, status: out.status});
    await gate.audit({kind: 'payment_event', provider: e.provider, type: e.type, orderId: e.orderId ?? null, status: out.status});
    return out;
  }

  async function applyEventOnce(e) {
    const order = await orderForEvent(e);
    if (!order) return {status: 'unknown_order'};
    if (Number.isSafeInteger(e.telegramUserId) && e.telegramUserId !== order.userId) return {status: 'user_mismatch'};
    const key = entKey(order.userId, order.planId);
    const ent = await store.get(key);
    switch (e.type) {
      case 'paid': {
        if (order.state === 'refunded') return {status: 'ignored_after_refund'}; // refund arrived first
        if (order.state === 'paid' && ent?.grants?.[order.id]) return {status: 'already_paid'};
        if (e.amount !== undefined && (e.amount !== order.amount || (e.currency && e.currency !== order.currency))) {
          await gate.audit({kind: 'amount_mismatch', orderId: order.id}); return {status: 'amount_mismatch'};
        }
        Object.assign(order, {state: 'paid', paidAt: order.paidAt ?? now(), paymentRef: e.paymentRef, subscriptionRef: e.subscriptionRef});
        await store.put(`order:${order.id}`, order);
        if (e.paymentRef) await store.put(`payref:${order.provider}:${e.paymentRef}`, {orderId: order.id});
        if (e.subscriptionRef) await store.put(`subref:${order.provider}:${e.subscriptionRef}`, {orderId: order.id});
        await grant(order, e);
        return {status: 'granted'};
      }
      case 'renewed':
        if (order.state !== 'paid' || !ent) return {status: 'ignored'};
        if (e.resumed) { ent.autoRenew = true; await store.put(key, ent); return {status: 'resumed'}; }
        if (ent.lastEventAt && e.occurredAt < ent.lastEventAt) return {status: 'stale'};
        if (e.paymentRef) await store.put(`payref:${order.provider}:${e.paymentRef}`, {orderId: order.id});
        await grant(order, e);
        return {status: 'renewed'};
      case 'failed':
        // A renewal failure arrives at (or just after) the end of the paid term: that is still the
        // subscriber's term, not a revoked one, so it starts grace.
        if (!ent || !['active', 'grace'].includes(ent.state)) return {status: 'ignored'};
        ent.state = 'grace'; ent.graceUntil = Math.max(ent.expiresAt ?? 0, now()) + graceMs;
        await store.put(key, ent);
        await gate.audit({kind: 'grace_started', userId: order.userId, planId: order.planId});
        return {status: 'grace'};
      case 'canceled':
        if (ent) { ent.autoRenew = false; await store.put(key, ent); } // valid to period end
        return {status: 'will_not_renew'};
      case 'expired':
        if (order.state === 'awaiting_payment') { order.state = 'expired_order'; await store.put(`order:${order.id}`, order); return {status: 'order_expired'}; }
        if (order.state !== 'paid') return {status: 'ignored'}; // an unpaid/expired order never ends a membership
        if (!ent || !['active', 'grace'].includes(ent.state) || !Object.values(ent.grants ?? {}).some(g => g.orderId === order.id)) return {status: 'expired'};
        for (const [k, g] of Object.entries(ent.grants)) if (g.orderId === order.id) delete ent.grants[k];
        ent.autoRenew = false;
        {
          const rest = Object.values(ent.grants);
          // Other purchases on the same plan keep access: a permanent one, or time stacked beyond now.
          if (rest.some(g => g.ms === null)) { ent.expiresAt = null; ent.state = 'active'; ent.graceUntil = null; }
          else if (rest.length && ent.expiresAt !== null && ent.expiresAt > now()) { ent.state = 'active'; ent.graceUntil = null; }
          else { await endEntitlement(ent, 'expired', 'subscription_ended'); return {status: 'expired'}; }
        }
        await store.put(key, ent);
        return {status: 'expired_partial'};
      case 'refunded': case 'disputed': {
        const was = order.state;
        // A subscription order carries several charges; a refund is for one of them (its paymentRef).
        const mine = g => g.orderId === order.id && (!e.paymentRef || !g.paymentRef || g.paymentRef === e.paymentRef);
        const recurringPartial = order.terms?.recurring && was === 'paid' && e.paymentRef && e.paymentRef !== order.paymentRef;
        if (!recurringPartial) { order.state = 'refunded'; order.refundedAt = now(); }
        order.refunds = [...new Set([...(order.refunds ?? []), e.paymentRef ?? '-'])];
        await store.put(`order:${order.id}`, order);
        // Resumable: a redelivery after an interrupted write finds the order already refunded but its
        // grant still on the entitlement, and finishes the job.
        if (!['paid', 'refunded'].includes(was) || !ent || !['active', 'grace'].includes(ent.state)) return {status: 'revoked'};
        if (!Object.values(ent.grants ?? {}).some(mine)) return {status: 'refund_recorded'}; // its time was already used up
        // Take back only what this order paid for.
        let permanentLeft = false, giveBack = 0;
        for (const [k, g] of Object.entries(ent.grants ?? {})) {
          if (mine(g)) { if (g.ms !== null) giveBack += g.ms; delete ent.grants[k]; }
          else if (g.ms === null) permanentLeft = true;
        }
        const left = Object.keys(ent.grants ?? {}).length;
        if (!left) { await endEntitlement(ent, 'revoked', e.type); return {status: 'revoked'}; }
        if (!permanentLeft) {
          if (ent.expiresAt === null) {
            // The permanent grant was the refunded one: what is left is the timed purchases, counted
            // from the earliest of them.
            const rest = Object.values(ent.grants);
            ent.expiresAt = Math.min(...rest.map(g => g.at)) + rest.reduce((n, g) => n + g.ms, 0);
          }
          else ent.expiresAt -= giveBack;
          if (ent.expiresAt <= now()) { await endEntitlement(ent, 'revoked', e.type); return {status: 'revoked'}; }
        }
        await store.put(key, ent);
        await gate.audit({kind: 'entitlement_shortened', userId: ent.userId, planId: ent.planId, orderId: order.id, expiresAt: ent.expiresAt});
        return {status: 'shortened'};
      }
    }
    return {status: 'ignored'};
  }

  // ---------- join requests + verification ----------
  const jrKey = (chatId, userId) => `jr:${chatId}:${userId}`;
  async function entitledFor(userId, chatId) {
    const t = now();
    return (await store.list(`ent:${userId}:`)).find(e => isLive(e, t) && e.chats.includes(chatId)) ?? null;
  }

  function decisionCall(jr, approve) {
    return jr.queryId
      ? {method: 'answerChatJoinRequestQuery', params: {chat_join_request_query_id: jr.queryId, result: approve ? 'approve' : 'decline'}}
      : {method: approve ? 'approveChatJoinRequest' : 'declineChatJoinRequest', params: {chat_id: jr.chatId, user_id: jr.userId}};
  }

  // The final answer to a join request. Entitlement is re-checked here, because it may have expired
  // or been refunded during the verification window. A Telegram error keeps the decision retryable.
  async function decide(jr, approve, condition) {
    if (approve && !(await entitledFor(jr.userId, jr.chatId))) { approve = false; condition = 'not_entitled'; }
    const {method, params} = decisionCall(jr, approve);
    const out = await request(condition, method, params, {chatId: jr.chatId, reason: condition, target: jr.userId,
      resume: {kind: 'join_decision', chatId: jr.chatId, userId: jr.userId, approve}});
    jr.decision = {approve, condition};
    jr.result = out.status;
    if (out.status === 'executed') {
      jr.state = approve ? 'approved' : 'declined'; jr.decidedAt = now();
      delete jr.question;
    } else if (out.status === 'pending_approval') {
      jr.state = `${approve ? 'approve' : 'decline'}_pending_approval`;
      delete jr.question;
    } else {
      jr.state = 'decision_failed'; jr.decisionTries = (jr.decisionTries ?? 0) + 1;
    }
    await store.put(jrKey(jr.chatId, jr.userId), jr);
    if (approve && out.status === 'executed') await approvedNotice(jr);
    return jr.state;
  }
  async function approvedNotice(jr) {
    if (jr.userChatId && !jr.queryId) {
      await write('member_notice', 'sendMessage', {chat_id: jr.userChatId, text: '✅ 参加を承認しました。グループを開いてください。'}, {chatId: jr.chatId});
    }
  }

  async function onJoinRequest(r) {
    const chatId = r.chat?.id, userId = r.from?.id;
    if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)) return {status: 'ignored'};
    const managed = (await store.list('plan:')).some(p => p.chats.includes(chatId))
      || (await store.list(`ent:${userId}:`)).some(e => e.chats.includes(chatId));
    if (!managed) return {status: 'not_a_member_chat'}; // someone else's group: leave it to its admins
    const jr = {chatId, userId, userChatId: r.user_chat_id ?? null, queryId: r.query_id ?? null, at: now(),
      deadline: now() + VERIFY_TIMEOUT_MS, state: 'verifying', mode: null};
    if (!(await entitledFor(userId, chatId))) { await decide(jr, false, 'not_entitled'); return {status: jr.state}; }
    const question = pickQuestion(rng);
    jr.question = {index: question.index}; jr.step = 'button';
    if (jr.queryId && origin) {
      // Guard bot (10.1): show the verification Mini App before deciding.
      const s = await request('join_verification', 'sendChatJoinRequestWebApp',
        {chat_join_request_query_id: jr.queryId, web_app_url: `${origin}/verify`}, {chatId, target: userId});
      if (s.status === 'executed') { jr.mode = 'webapp'; await store.put(`jrq:${jr.queryId}`, {chatId, userId}); }
      else if (s.status === 'pending_approval') jr.mode = 'webapp_pending';
    }
    if (!jr.mode && jr.userChatId) {
      // Fallback: DM inside the 5-minute window. A guard-bot query that could not show the Mini App
      // is answered through the classic approve/decline once the DM check finishes.
      const s = await request('join_verification', 'sendMessage', {chat_id: jr.userChatId,
        text: `「${r.chat?.title ?? '会員グループ'}」への参加申請を受け付けました。\n本人確認のため、3分以内に下のボタンを押してください。`,
        reply_markup: {inline_keyboard: [[{text: '✅ ロボットではありません', callback_data: `jv/${chatId}/b`}]]}}, {chatId, target: userId});
      jr.mode = s.status === 'executed' ? 'dm' : `dm_${s.status}`;
    }
    if (!jr.mode) jr.mode = 'none';
    await store.put(jrKey(chatId, userId), jr);
    return {status: 'verifying', mode: jr.mode};
  }

  async function liveJr(chatId, userId) {
    const jr = await store.get(jrKey(chatId, userId));
    if (!jr || jr.state !== 'verifying') return null;
    if (now() > jr.deadline) { await decide(jr, false, 'verification_timeout'); return null; }
    return jr;
  }
  const questionOf = jr => pickQuestion(() => (jr.question.index + 0.5) / 4);

  async function onVerifyCallback(cq) {
    const v = parseVerifyCallback(cq.data), userId = cq.from?.id;
    const ack = text => write('join_verification', 'answerCallbackQuery', {callback_query_id: cq.id, ...(text ? {text} : {})}, {chatId: v?.chatId});
    const jr = v && await liveJr(v.chatId, userId);
    if (!jr) { await ack('この確認は終了しています'); return {status: 'closed'}; }
    if (v.step === 'button' && jr.step === 'button') {
      jr.step = 'question'; await store.put(jrKey(jr.chatId, userId), jr);
      await ack();
      const q = questionOf(jr);
      await write('join_verification', 'sendMessage', {chat_id: jr.userChatId ?? userId, text: `質問: ${q.q}`,
        reply_markup: {inline_keyboard: [q.choices.map((c, i) => ({text: c, callback_data: `jv/${jr.chatId}/q/${i}`}))]}}, {chatId: jr.chatId});
      return {status: 'question_sent'};
    }
    if (v.step === 'question' && jr.step === 'question') {
      await ack();
      const ok = isCorrect(jr.question.index, v.choice);
      return {status: await decide(jr, ok, ok ? 'paid_member_verified' : 'verification_failed')};
    }
    await ack('順番に操作してください');
    return {status: 'out_of_order'};
  }

  // Mini App endpoints (/verify/start, /verify/answer). Identity is only the signed initData.
  async function verifyApi(op, body) {
    const who = await checkInitData(body?.initData, env.BOT_TOKEN, now());
    if (!who?.queryId) return {ok: false, error: 'unauthorized'};
    const ref = await store.get(`jrq:${who.queryId}`);
    if (!ref || ref.userId !== who.userId) return {ok: false, error: 'unknown_request'};
    const jr = await liveJr(ref.chatId, ref.userId);
    if (!jr) return {ok: false, error: 'closed'};
    if (op === 'start') {
      jr.step = 'question'; await store.put(jrKey(jr.chatId, jr.userId), jr);
      const q = questionOf(jr);
      return {ok: true, q: q.q, choices: q.choices};
    }
    if (op === 'answer' && jr.step === 'question') {
      const ok = isCorrect(jr.question.index, body?.choice);
      const state = await decide(jr, ok, ok ? 'paid_member_verified' : 'verification_failed');
      return {ok: true, approved: state === 'approved'};
    }
    return {ok: false, error: 'out_of_order'};
  }

  // ---------- resuming a workflow after the owner approves its queued write ----------
  async function resumeAfterApproval(a, out) {
    const r = a.resume;
    if (!r) return;
    if (r.kind === 'remove') {
      const ent = await store.get(entKey(r.userId, r.planId));
      if (ent?.removal) ent.removal.pendingApproval = ent.removal.pendingApproval.filter(c => c !== r.chatId);
      if (out.status === 'executed') {
        // The owner approved this removal; its unban belongs to the same approved step.
        try { await exec('unbanChatMember', {chat_id: r.chatId, user_id: r.userId, only_if_banned: true}); }
        catch { if (ent?.removal) ent.removal.chats.push(r.chatId); }
        await gate.audit({kind: 'executed', via: `approval:${a.id}`, method: 'unbanChatMember', condition: a.condition, chatId: r.chatId, target: r.userId, ok: true});
      } else if (ent?.removal) ent.removal.chats.push(r.chatId);
      if (ent) await store.put(entKey(r.userId, r.planId), ent);
    } else if (r.kind === 'checkout') {
      const order = await store.get(`order:${r.orderId}`);
      if (!order || order.state !== 'awaiting_approval' || out.status !== 'executed') return;
      order.state = 'awaiting_payment';
      await store.put(`order:${order.id}`, order);
      if (a.method === 'createInvoiceLink' && typeof out.result === 'string') await sendCheckoutLink(order, {kind: 'invoice_link', url: out.result});
    } else if (r.kind === 'join_decision') {
      const jr = await store.get(jrKey(r.chatId, r.userId));
      if (!jr) return;
      jr.result = out.status;
      jr.state = out.status === 'executed' ? (r.approve ? 'approved' : 'declined') : 'decision_failed';
      await store.put(jrKey(r.chatId, r.userId), jr);
      if (r.approve && out.status === 'executed') await approvedNotice(jr);
    } else if (r.kind === 'cancel') {
      const ent = await store.get(entKey(r.userId, r.planId));
      if (ent && out.status === 'executed') { ent.autoRenew = false; await store.put(entKey(r.userId, r.planId), ent); }
    }
  }

  // ---------- cron ----------
  async function cron() {
    const t = now(), report = {expired: 0, graceEnded: 0, removalsRetried: 0, verificationsTimedOut: 0, decisionsRetried: 0, ordersExpired: 0};
    for (const ent of await store.list('ent:')) {
      if (ent.state === 'active' && ent.expiresAt !== null && ent.expiresAt <= t && ent.autoRenew) {
        // A subscription at its renewal boundary: wait for the renewal (or its failure) during grace.
        ent.state = 'grace'; ent.graceUntil = ent.expiresAt + graceMs;
        await store.put(entKey(ent.userId, ent.planId), ent); report.awaitingRenewal = (report.awaitingRenewal ?? 0) + 1;
      }
      else if (ent.state === 'active' && ent.expiresAt !== null && ent.expiresAt <= t) { await endEntitlement(ent, 'expired', 'term_ended'); report.expired++; }
      else if (ent.state === 'grace' && ent.graceUntil <= t && ent.expiresAt !== null && ent.expiresAt <= t) { await endEntitlement(ent, 'expired', 'grace_ended'); report.graceEnded++; }
      else if (['expired', 'revoked'].includes(ent.state) && ent.removal?.chats?.length && !ent.removal.needsReview) { await removeFromChats(ent); report.removalsRetried++; }
    }
    for (const jr of await store.list('jr:')) {
      if (jr.state === 'verifying' && t > jr.deadline) { await decide(jr, false, 'verification_timeout'); report.verificationsTimedOut++; }
      else if (jr.state === 'decision_failed' && (jr.decisionTries ?? 0) < DECISION_RETRIES && jr.decision) {
        await decide(jr, jr.decision.approve, jr.decision.condition); report.decisionsRetried++;
      }
    }
    for (const o of await store.list('order:')) {
      if (o.state === 'awaiting_payment' && t - o.createdAt > 3 * DAY) { o.state = 'expired_order'; await store.put(`order:${o.id}`, o); report.ordersExpired++; }
    }
    await gate.audit({kind: 'cron', ...report});
    return report;
  }

  // ---------- owner operations (refund / cancel go through the gate: no preset covers them) ----------
  async function refund(orderId, {queueOnly = false} = {}) {
    const order = await store.get(`order:${orderId}`);
    if (!order || order.state !== 'paid') throw Error('not_refundable');
    try {
      const r = await PROVIDERS[order.provider].refund({paymentRef: order.paymentRef, idempotencyKey: `refund:${order.id}`, telegramUserId: order.userId, fullAmount: order.amount},
        {env, fetch: fetchImpl, now, call: (method, params) => write('owner_refund', method, params, {reason: `order:${orderId}`, queueOnly}, true)});
      // Stars confirms with a refunded_payment update; external rails with their webhook. Revocation
      // happens on that event, so a refund that did not go through never removes anyone.
      return {status: 'requested', ...r};
    } catch (err) {
      if (err instanceof Pending) return {status: 'pending_approval', approvalId: err.approvalId};
      throw err;
    }
  }

  async function cancel(orderId, {atPeriodEnd = true} = {}) {
    const order = await store.get(`order:${orderId}`);
    if (!order || order.state !== 'paid' || !order.subscriptionRef) throw Error('not_a_subscription');
    try {
      await PROVIDERS[order.provider].cancelSubscription({subscriptionRef: order.subscriptionRef, atPeriodEnd, telegramUserId: order.userId},
        {env, fetch: fetchImpl, now, call: (method, params) => write('owner_cancel', method, params,
          {reason: `order:${orderId}`, resume: {kind: 'cancel', userId: order.userId, planId: order.planId}}, true)});
    } catch (err) {
      if (err instanceof Pending) return {status: 'pending_approval', approvalId: err.approvalId};
      throw err;
    }
    const ent = await store.get(entKey(order.userId, order.planId));
    if (ent) {
      ent.autoRenew = false;
      await store.put(entKey(order.userId, order.planId), ent);
      if (!atPeriodEnd && isLive(ent, now())) await endEntitlement(ent, 'revoked', 'canceled_now');
    }
    await gate.audit({kind: 'subscription_canceled', orderId, atPeriodEnd});
    return {status: 'canceled'};
  }

  // ---------- update router ----------
  async function plansMessage(chatId) {
    const plans = (await store.list('plan:')).filter(p => p.listed);
    const rows = [];
    for (const p of plans) for (const s of p.skus) {
      const provider = s.currency === 'XTR' ? 'telegram_stars' : (s.providers?.[0] ?? null);
      if (!provider) continue;
      rows.push([{text: `${p.title} ${s.title ?? ''} ${s.currency === 'XTR' ? `⭐${s.amount}` : `¥${s.amount.toLocaleString('ja-JP')}`}`.replace(/\s+/g, ' ').trim(), callback_data: `pay/${s.id}/${provider}`}]);
    }
    return write('buyer_requested', 'sendMessage', {chat_id: chatId, text: rows.length ? (plans.some(p => p.chats.length) ? '会員プラン（支払い後に自動でグループ参加できます）' : '会員プラン（Telegram Stars でお支払い）\nお申し込み前に /terms をご確認ください。お問い合わせ: /paysupport') : '現在販売中のプランはありません。',
      ...(rows.length ? {reply_markup: {inline_keyboard: rows}} : {})}, {chatId});
  }

  async function handleUpdate(update) {
    // A redelivered update (Telegram retries after a 5xx) is not processed twice.
    if (Number.isSafeInteger(update?.update_id)) {
      const k = `upd:${update.update_id}`;
      if (await store.get(k)) return {status: 'duplicate_update'};
      const out = await route(update);
      await store.put(k, now());
      return out;
    }
    return route(update);
  }

  async function route(update) {
    if (update.chat_join_request) return onJoinRequest(update.chat_join_request);
    if (update.pre_checkout_query) return {status: await preCheckout(update.pre_checkout_query)};
    const events = eventsFromUpdate(update, tenantId);
    if (events.length) { const out = []; for (const e of events) out.push(await applyEvent(e)); return {status: 'events', out}; }
    const cq = update.callback_query;
    if (cq) {
      if (parseVerifyCallback(cq.data)) return onVerifyCallback(cq);
      const pay = parsePayData(cq.data);
      if (pay) return checkout({userId: cq.from?.id, chatId: cq.message?.chat?.type === 'private' ? cq.message.chat.id : cq.from?.id,
        skuId: pay.skuId, provider: pay.provider, callbackId: cq.id});
    }
    const m = update.message;
    if (m?.chat?.type === 'private' && /^\/(plans|join)(@\w+)?$/.test(m.text ?? '')) return plansMessage(m.chat.id);
    return {status: 'ignored'};
  }

  async function payWebhook(providerId, req) {
    const p = PROVIDERS[providerId];
    if (!p || providerId === 'telegram_stars' || !p.configured(env)) return {status: 'not_configured'};
    const events = await p.verifyWebhook(req, {env, fetch: fetchImpl, now,
      lookupBankExpectation: async va => {
        const ref = await store.get(`bankva:${va}`); const o = ref && await store.get(`order:${ref.orderId}`);
        return o ? {orderId: o.id, telegramUserId: o.userId, tenantId, amount: o.amount} : null;
      },
      onReviewNeeded: info => gate.audit({kind: 'payment_needs_review', provider: providerId, reason: info?.reason ?? 'unknown'})});
    const out = [];
    for (const e of events) out.push(await applyEvent(e));
    return {status: 'ok', out};
  }

  return {gate, store, setPlan, checkout, preCheckout, applyEvent, onJoinRequest, onVerifyCallback, verifyApi, cron, refund, cancel,
    // t79u Mini App: the live membership of one user (the authoritative record after a payment).
    async liveMember(userId) {
      const t = now(), ents = (await store.list(`ent:${userId}:`)).filter(e => isLive(e, t));
      return ents.sort((a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity))[0] ?? null;
    },
    // t80u: a user's own orders (for /paysupport) and the owner's order list (for refunds). Neither
    // carries the buyer's Telegram id or a payment charge id.
    async ordersOf(userId) {
      return (await store.list('order:')).filter(o => o.userId === userId && ['paid', 'refunded'].includes(o.state)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
        .map(o => ({id: o.id, title: o.terms?.title ?? o.skuId, amount: o.amount, currency: o.currency, state: o.state, at: o.paidAt ?? o.createdAt}));
    },
    // /paysupport <text>: a support request the owner reads with /admin/membership/tickets. At most 5
    // per user per 24 h; the owner sees the buyer's paid order ids, never the Telegram id.
    async supportTicket(userId, text) {
      const t = now(), mine = (await store.list('ticket:')).filter(x => x.userId === userId && t - x.at < DAY);
      if (mine.length >= 5) return {status: 'rate_limited'};
      const n = ((await store.get('seq:ticket')) ?? 0) + 1;
      await store.put('seq:ticket', n);
      const orders = (await store.list('order:')).filter(o => o.userId === userId && ['paid', 'refunded'].includes(o.state)).map(o => o.id).slice(-10);
      const id = `T${n}`;
      await store.put(`ticket:${String(n).padStart(8, '0')}`, {id, userId, at: t, text: String(text).slice(0, 1000), orders, state: 'open'});
      await gate.audit({kind: 'support_ticket', ticketId: id});
      return {status: 'created', id};
    },
    // The owner's answer to a ticket, addressed by ticket id (the owner never handles the user id).
    // No preset covers it: queued, and sent only when the owner approves that item.
    async ticketReply(ticketId, text, {queueOnly = false} = {}) {
      const tk = (await store.list('ticket:')).find(x => x.id === ticketId);
      if (!tk) throw Error('unknown_ticket');
      const body = String(text ?? '').trim();
      if (!body || body.length > 3500) throw Error('bad_text');
      const r = await request('owner_reply', 'sendMessage', {chat_id: tk.userId, text: `🛟 お問い合わせ ${tk.id} への回答\n\n${body}`}, {reason: `ticket:${tk.id}`}, {queueOnly});
      return {status: r.status, ...(r.approvalId ? {approvalId: r.approvalId} : {})};
    },
    async ticketsForOwner(limit = 50) {
      return (await store.list('ticket:')).slice(-Math.min(Number(limit) || 50, 500)).reverse().map(({userId, ...x}) => x);
    },
    async ordersForOwner(limit = 50) {
      return (await store.list('order:')).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.min(Number(limit) || 50, 500))
        .map(o => ({id: o.id, planId: o.planId, skuId: o.skuId, provider: o.provider, amount: o.amount, currency: o.currency, state: o.state,
          recurring: Boolean(o.terms?.recurring), createdAt: o.createdAt, paidAt: o.paidAt ?? null, refundedAt: o.refundedAt ?? null}));
    },
    handleUpdate, payWebhook, providers: () => providerStatus(env)};
}

// Which updates belong to the membership feature (routed to the membership object).
export function isMembershipUpdate(u) {
  if (u?.chat_join_request || u?.pre_checkout_query || u?.subscription) return true;
  if (u?.message?.successful_payment || u?.message?.refunded_payment) return true;
  const d = u?.callback_query?.data;
  if (d && (parsePayData(d) || parseVerifyCallback(d))) return true;
  return u?.message?.chat?.type === 'private' && /^\/(plans|join)(@\w+)?$/.test(u.message.text ?? '');
}
