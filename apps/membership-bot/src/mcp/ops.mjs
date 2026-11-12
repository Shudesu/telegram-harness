// Telegram Harness MCP — the half that runs inside the membership Durable Object (op 'mcp').
//
// Two kinds of operation and nothing else:
//  * reads, returned at once, with every Telegram user/chat id removed (the owner works with order,
//    ticket, approval and rule ids; an AI client never needs a person's id),
//  * "request_*" operations, which only ever *queue*. A Bot API write is parked in the existing
//    approval queue with queueOnly (no enabled rule can pick it up), and the rest — broadcast, rule
//    changes, plan / PAY_LIVE changes, subscription cancel, non-Stars refunds — become owner requests
//    that nothing in this Worker executes. Approving / rejecting stays on the owner's admin API
//    (/admin/membership/approve|reject|request_close), which the MCP key cannot reach.
import {PRESETS} from '../membership/gate.mjs';
import {KINDS, TOUR} from '../studio/widgets.mjs';
import {SCHEMAS} from '../schema.mjs';
import {templateById} from '../richmsg/templates.mjs';

const pad = n => String(n).padStart(10, '0');
const clampLimit = (v, def, max) => Math.min(Math.max(Number.isSafeInteger(Number(v)) ? Number(v) : def, 1), max);
const isChatId = v => Number.isSafeInteger(v) && v !== 0;
const isUserId = v => Number.isSafeInteger(v) && v > 0;
const text = (v, max) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || t.length > max) throw Error(`bad_text (1..${max} characters)`);
  return t;
};
const kindOfChat = id => (Number.isSafeInteger(id) ? (id < 0 ? 'group' : 'user') : null);

// ---------------------------------------------------------------- redaction
function planView(p) {
  return {id: p.id, title: p.title, description: p.description ?? null, goodsKind: p.goodsKind, listed: p.listed !== false,
    memberGroups: (p.chats ?? []).length, groupLinksConfigured: Object.keys(p.links ?? {}).length,
    skus: (p.skus ?? []).map(s => ({id: s.id, title: s.title ?? null, amount: s.amount, currency: s.currency, days: s.days ?? null,
      recurring: Boolean(s.recurring), providers: s.currency === 'XTR' ? ['telegram_stars'] : (s.providers ?? [])}))};
}
const ruleView = r => ({id: r.id, preset: r.preset, title: r.title, enabled: Boolean(r.enabled), scopedGroups: (r.chats ?? []).length,
  approvedAt: r.approvedAt ?? null, disabledAt: r.disabledAt ?? null});
function approvalView(a) {
  const p = a.params ?? {};
  return {id: a.id, state: a.state, at: a.at, method: a.method, condition: a.condition, reason: a.reason ?? null,
    recipient: kindOfChat(p.chat_id ?? p.user_id), outcome: a.outcome ?? null, decidedAt: a.decidedAt ?? null,
    ...(typeof p.text === 'string' ? {textPreview: p.text.slice(0, 300)} : {}),
    ...(a.via === 'mcp' || a.condition?.startsWith('mcp_') ? {queuedBy: 'mcp'} : {})};
}
// Audit rows carry chatId / target / userId (Telegram ids). They are dropped wherever they appear;
// a chat keeps only its kind (user / group).
const PERSON_KEYS = new Set(['userId', 'chatId', 'target', 'user_id', 'chat_id', 'telegramUserId', 'chats']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !PERSON_KEYS.has(k)).map(([k, x]) => [k, scrub(x)]));
}
const auditView = row => ({...scrub(row), ...(row.chatId != null ? {chat: kindOfChat(row.chatId)} : {})});
const requestView = r => ({id: r.id, kind: r.kind, state: r.state, at: r.at, note: r.note ?? null, summary: r.summary,
  closedAt: r.closedAt ?? null});

// ---------------------------------------------------------------- owner requests (never executed here)
async function ownerRequest(svc, kind, payload, summary, note) {
  const n = ((await svc.store.get('seq:mcpreq')) ?? 0) + 1;
  await svc.store.put('seq:mcpreq', n);
  const rec = {id: `q${n}`, kind, payload, summary, note: note ? String(note).slice(0, 500) : null, state: 'pending', at: Date.now(), by: 'mcp'};
  await svc.store.put(`mcpreq:${pad(n)}`, rec);
  await svc.gate.audit({kind: 'mcp_request', requestId: rec.id, request: kind});
  return {status: 'pending_owner', requestId: rec.id, executes: 'never automatically — the owner applies it and closes it with /admin/membership/request_close'};
}

export async function listOwnerRequests(store, state = 'pending') {
  return (await store.list('mcpreq:')).filter(r => !state || r.state === state);
}

// Owner side (admin API only): mark a request handled or declined. Applying it is the owner's job.
export async function closeOwnerRequest(svc, id, state) {
  if (!['done', 'rejected'].includes(state)) throw Error('bad_state');
  const rec = (await svc.store.list('mcpreq:')).find(r => r.id === id);
  if (!rec) throw Error('unknown_request');
  if (rec.state !== 'pending') throw Error('already_closed');
  rec.state = state; rec.closedAt = Date.now();
  await svc.store.put(`mcpreq:${pad(Number(id.slice(1)))}`, rec);
  await svc.gate.audit({kind: 'mcp_request_closed', requestId: id, state, by: 'owner'});
  return requestView(rec);
}

// ---------------------------------------------------------------- the op table
export const MCP_OPS = {
  async summary(svc) {
    const [plans, rules, approvals, orders, tickets, requests] = await Promise.all([
      svc.store.list('plan:'), svc.gate.listRules(), svc.gate.listApprovals('pending'), svc.store.list('order:'),
      svc.store.list('ticket:'), listOwnerRequests(svc.store, 'pending')]);
    const byState = {};
    // Every Stars charge (first payment and each renewal) leaves one payref record pointing at its
    // order; each refunded charge is listed in order.refunds (a renewal refund can leave the order paid).
    const charges = {};
    for (const ref of await svc.store.list('payref:telegram_stars:')) if (ref?.orderId) charges[ref.orderId] = (charges[ref.orderId] ?? 0) + 1;
    const refundedCharges = o => Math.max((o.refunds ?? []).length, o.state === 'refunded' ? 1 : 0);
    const paidStars = orders.filter(o => o.currency === 'XTR' && ['paid', 'refunded'].includes(o.state))
      .reduce((n, o) => n + (o.amount || 0) * Math.max((charges[o.id] ?? 1) - refundedCharges(o), 0), 0);
    for (const o of orders) byState[o.state] = (byState[o.state] ?? 0) + 1;
    const t = Date.now();
    // Entitlements are per user and plan: a person with two live plans is one member.
    const live = new Set((await svc.store.list('ent:')).filter(e => ['active', 'grace'].includes(e.state)
      && (e.expiresAt === null || e.expiresAt > t || (e.state === 'grace' && e.graceUntil > t))).map(e => e.userId)).size;
    return {plans: plans.length, listedPlans: plans.filter(p => p.listed !== false).length,
      rules: {total: rules.length, enabled: rules.filter(r => r.enabled).map(r => r.preset)},
      pendingApprovals: approvals.length, pendingOwnerRequests: requests.length,
      orders: {total: orders.length, byState, paidStarsTotal: paidStars},
      activeMembers: live, openTickets: tickets.filter(t => t.state === 'open').length, ticketsTotal: tickets.length};
  },
  plans: async svc => (await svc.store.list('plan:')).map(planView),
  presets: () => Object.entries(PRESETS).map(([id, p]) => ({id, title: p.title, conditions: p.conditions, methods: p.methods})),
  rules: async svc => (await svc.gate.listRules()).map(ruleView),
  approvals: async (svc, a) => {
    const state = a.state === 'all' ? null : (['pending', 'approved', 'rejected'].includes(a.state) ? a.state : 'pending');
    // Approval ids are unpadded (a1, a10, a100 …), so storage order is not age order.
    const seq = x => Number(String(x.id).slice(1)) || 0;
    return (await svc.gate.listApprovals(state)).sort((x, y) => (x.at - y.at) || (seq(x) - seq(y)))
      .slice(-clampLimit(a.limit, 50, 500)).reverse().map(approvalView);
  },
  owner_requests: async (svc, a) => {
    const state = a.state === 'all' ? null : (['pending', 'done', 'rejected'].includes(a.state) ? a.state : 'pending');
    return (await listOwnerRequests(svc.store, state)).slice(-clampLimit(a.limit, 50, 500)).reverse().map(requestView);
  },
  audit: async (svc, a) => (await svc.gate.auditLog()).slice(-clampLimit(a.limit, 100, 1000)).reverse().map(auditView),
  orders: (svc, a) => svc.ordersForOwner(clampLimit(a.limit, 50, 500)),
  tickets: (svc, a) => svc.ticketsForOwner(clampLimit(a.limit, 50, 500)),
  providers: svc => svc.providers(),

  // These workflow requests are records only: no dispatch, execution or state update.
  async q_booking(svc, a) {
    if (!isChatId(a.chatId) || !['start', 'lookup', 'cancel'].includes(a.action)) throw Error('bad_booking_request');
    return ownerRequest(svc, 'booking', {chatId: a.chatId, action: a.action, demo: true}, `デモ予約: ${a.action}`, a.note);
  },
  async q_widget(svc, a) {
    if (!isChatId(a.chatId) || !Object.hasOwn(KINDS, a.kind)) throw Error('bad_widget_request');
    return ownerRequest(svc, 'widget', {chatId: a.chatId, kind: a.kind}, `ウィジェット表示: ${a.kind}`, a.note);
  },
  async q_guide(svc, a) {
    if (!isChatId(a.chatId) || !Number.isInteger(a.step) || a.step < 1 || a.step > TOUR.length) throw Error('bad_guide_request');
    return ownerRequest(svc, 'guide', {chatId: a.chatId, step: a.step}, `ガイド表示: ${a.step}`, a.note);
  },
  async q_rich_message(svc, a) {
    const template = templateById(a.templateId);
    if (!isChatId(a.chatId) || !template) throw Error('bad_template_request');
    return ownerRequest(svc, 'rich_message', {chatId: a.chatId, template: structuredClone(template)}, `リッチテンプレ送信: ${template.templateId}`, a.note);
  },
  async q_auto_reply_change(svc, a) {
    const question = text(a.question, 200), answer = text(a.answer, 2000);
    return ownerRequest(svc, 'auto_reply_change', {question, answer}, 'FAQ自動応答の変更（要コード反映）', a.note);
  },
  async q_managed_bot_creation(svc, a) {
    if (!SCHEMAS.some(s => s.id === a.industryId)) throw Error('unknown_industry');
    return ownerRequest(svc, 'managed_bot_creation', {industryId: a.industryId, ownerInteractionRequired: true}, `Managed Bot作成: ${a.industryId}（本人操作が必要）`, a.note);
  },
  async q_invoice_link(svc, a) {
    const plans = await svc.store.list('plan:');
    const plan = plans.find(p => p.listed !== false && (p.skus ?? []).some(s => s.id === a.skuId && s.currency === 'XTR'));
    if (!plan) throw Error('unknown_stars_sku');
    const sku = plan.skus.find(s => s.id === a.skuId);
    return ownerRequest(svc, 'invoice_link', {planId: plan.id, sku: structuredClone(sku), buyerConfirmationRequired: true}, `Stars請求リンク: ${sku.id}（購入者本人の確認が必要）`, a.note);
  },
  async q_approval(svc, a) {
    const approval = (await svc.gate.listApprovals('pending')).find(r => r.id === a.approvalId);
    if (!approval) throw Error('unknown_pending_approval');
    return ownerRequest(svc, 'approval_review', {approvalId: approval.id}, `承認判断の依頼: ${approval.id}（未承認）`, a.note);
  },

  // ---------- queue-only ----------
  async q_send_message(svc, a) {
    if (!isChatId(a.chatId)) throw Error('bad_chat_id');
    const body = text(a.text, 4096);
    const r = await svc.gate.request({condition: 'mcp_send_message', method: 'sendMessage', params: {chat_id: a.chatId, text: body},
      chatId: a.chatId < 0 ? a.chatId : undefined, reason: 'mcp'}, {queueOnly: true});
    return {status: r.status, approvalId: r.approvalId};
  },
  async q_kick(svc, a) {
    if (!isChatId(a.chatId) || a.chatId > 0) throw Error('bad_chat_id (a group id is negative)');
    if (!isUserId(a.userId)) throw Error('bad_user_id');
    // until_date is recomputed when the owner approves (gate prepare hook): a 60 s ban = a kick.
    const r = await svc.gate.request({condition: 'mcp_kick', method: 'banChatMember',
      params: {chat_id: a.chatId, user_id: a.userId, until_date: Math.floor(Date.now() / 1000) + 60}, chatId: a.chatId, reason: 'mcp'}, {queueOnly: true});
    return {status: r.status, approvalId: r.approvalId};
  },
  async q_ticket_reply(svc, a) {
    return svc.ticketReply(String(a.ticketId ?? ''), text(a.text, 3500), {queueOnly: true});
  },
  async q_refund(svc, a) {
    const orderId = String(a.orderId ?? '');
    const order = await svc.store.get(`order:${orderId}`);
    if (!order || order.state !== 'paid') throw Error('not_refundable');
    // Stars: the refundStarPayment call itself is parked in the approval queue. External rails refund
    // through their own API rather than a Bot API call, so they become an owner request instead.
    if (order.provider === 'telegram_stars') return svc.refund(orderId, {queueOnly: true});
    return ownerRequest(svc, 'refund', {orderId}, `返金（${order.provider}）注文 ${orderId}`, a.note);
  },
  async q_subscription_cancel(svc, a) {
    const orderId = String(a.orderId ?? '');
    const order = await svc.store.get(`order:${orderId}`);
    if (!order || order.state !== 'paid' || !order.subscriptionRef) throw Error('not_a_subscription');
    const atPeriodEnd = a.atPeriodEnd !== false;
    return ownerRequest(svc, 'subscription_cancel', {orderId, atPeriodEnd}, `自動更新の解約 注文 ${orderId}（${atPeriodEnd ? '期間末' : '即時'}）`, a.note);
  },
  async q_broadcast(svc, a) {
    const body = text(a.text, 4096);
    const audience = ['active_members', 'all_buyers'].includes(a.audience) ? a.audience : null;
    if (!audience) throw Error('bad_audience (active_members | all_buyers)');
    return ownerRequest(svc, 'broadcast', {audience, text: body}, `一斉配信（${audience}）: ${body.slice(0, 60)}`, a.note);
  },
  async q_rule_change(svc, a) {
    if (a.action === 'enable') {
      if (!Object.hasOwn(PRESETS, a.preset)) throw Error('unknown_preset');
      const chats = a.chats ?? [];
      if (!Array.isArray(chats) || !chats.every(isChatId)) throw Error('bad_chats');
      return ownerRequest(svc, 'rule_enable', {preset: a.preset, chats}, `ルール有効化: ${a.preset}${chats.length ? `（グループ${chats.length}件に限定）` : ''}`, a.note);
    }
    if (a.action === 'disable') {
      const rule = (await svc.gate.listRules()).find(r => r.id === a.ruleId);
      if (!rule) throw Error('unknown_rule');
      return ownerRequest(svc, 'rule_disable', {ruleId: rule.id}, `ルール無効化: ${rule.id}（${rule.preset}）`, a.note);
    }
    throw Error('bad_action (enable | disable)');
  },
  async q_plan_change(svc, a) {
    const plan = a.plan;
    if (!plan || typeof plan !== 'object' || !/^[A-Za-z0-9_-]{1,32}$/.test(plan.id ?? '')) throw Error('bad_plan');
    if (JSON.stringify(plan).length > 8000) throw Error('plan_too_large');
    const exists = Boolean(await svc.store.get(`plan:${plan.id}`));
    return ownerRequest(svc, 'plan_change', {plan}, `プラン${exists ? '変更' : '追加'}: ${plan.id}`, a.note);
  },
  async q_pay_live(svc, a) {
    if (typeof a.enabled !== 'boolean') throw Error('bad_enabled');
    return ownerRequest(svc, 'pay_live_change', {enabled: a.enabled}, `PAY_LIVE を ${a.enabled ? '1（本番請求）' : '0（TEST）'} にする`, a.note);
  },
};
