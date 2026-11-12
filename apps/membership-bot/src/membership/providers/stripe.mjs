// Stripe Connect adapter (Checkout Sessions, hosted page). Implements contract.mjs.
// Network only through deps.fetch; keys never logged or put into errors.
import {goodsGuard, safeEqual, hmacHex} from './contract.mjs';

const API = 'https://api.stripe.com/v1';
const TOLERANCE_S = 300;
const ID = 'stripe';

const nowSec = deps => Math.floor((deps?.now?.() ?? Date.now()) / 1000);

// Stripe's bracket form encoding: {a: {b: 1}} -> a[b]=1, arrays -> a[0][...].
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

async function api(deps, method, path, params, {idempotencyKey, account} = {}) {
  const env = deps.env ?? {};
  const headers = {authorization: `Bearer ${env.STRIPE_SECRET_KEY}`};
  if (params) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const acct = account ?? env.STRIPE_CONNECT_ACCOUNT;
  if (acct) headers['stripe-account'] = acct;
  const res = await deps.fetch(`${API}${path}`, {method, headers, body: params ? form(params).toString() : undefined});
  if (!res.ok) throw Object.assign(Error(`${ID}_api_error`), {status: res.status});
  return res.json();
}

// Stripe recurring interval from a day count (week/month/year when it lines up, else days).
function interval(days) {
  if (days === 7) return {interval: 'week', interval_count: 1};
  if (days === 30 || days === 31) return {interval: 'month', interval_count: 1};
  if (days === 365 || days === 366) return {interval: 'year', interval_count: 1};
  return {interval: 'day', interval_count: days};
}

const metaOf = o => o?.metadata?.order_id ? o.metadata
  : o?.subscription_details?.metadata ?? o?.parent?.subscription_details?.metadata ?? o?.metadata ?? {};

function base(ev, obj) {
  const m = metaOf(obj);
  return {
    id: ev.id, provider: ID, tenantId: m.tenant_id ?? null,
    telegramUserId: m.telegram_user_id ? Number(m.telegram_user_id) : null,
    orderId: obj.client_reference_id ?? m.order_id ?? undefined,
    currency: obj.currency ? String(obj.currency).toUpperCase() : undefined,
    occurredAt: ev.created,
  };
}

function mapEvent(ev) {
  const o = ev.data?.object ?? {};
  const b = () => base(ev, o);
  const subOf = x => x.subscription ?? x.parent?.subscription_details?.subscription ?? undefined;
  const periodEnd = x => x.current_period_end ?? x.items?.data?.[0]?.current_period_end ?? undefined;
  switch (ev.type) {
    case 'checkout.session.completed':
      if (o.payment_status !== 'paid') return [];
    // falls through
    case 'checkout.session.async_payment_succeeded':
      return [{...b(), type: 'paid', amount: o.amount_total, paymentRef: o.payment_intent ?? o.invoice ?? undefined, subscriptionRef: o.subscription ?? undefined}];
    case 'invoice.paid':
      if (o.billing_reason !== 'subscription_cycle') return [];
      return [{...b(), type: 'renewed', amount: o.amount_paid, subscriptionRef: subOf(o), paymentRef: o.payment_intent ?? o.id, periodEnd: o.lines?.data?.[0]?.period?.end}];
    case 'invoice.payment_failed':
      return [{...b(), type: 'failed', amount: o.amount_due, subscriptionRef: subOf(o), paymentRef: o.payment_intent ?? o.id}];
    case 'customer.subscription.updated':
      if (!o.cancel_at_period_end) return [];
      return [{...b(), type: 'canceled', subscriptionRef: o.id, periodEnd: periodEnd(o)}];
    case 'customer.subscription.deleted':
      return [{...b(), type: 'expired', subscriptionRef: o.id, periodEnd: o.ended_at ?? periodEnd(o)}];
    case 'charge.refunded':
      return [{...b(), type: 'refunded', amount: o.amount, refundAmount: o.amount_refunded, paymentRef: o.payment_intent ?? o.id}];
    case 'charge.dispute.created':
      return [{...b(), type: 'disputed', amount: o.amount, paymentRef: o.payment_intent ?? o.charge}];
    default:
      return [];
  }
}

export const provider = {
  id: ID,
  supports: {subscription: true, partialRefund: true, goodsKinds: ['physical_service', 'physical_goods'], currencies: ['JPY']},
  configured: env => Boolean(env?.STRIPE_SECRET_KEY && env?.STRIPE_WEBHOOK_SECRET),

  async createCheckout(input, deps) {
    goodsGuard(ID, input.goodsKind);
    if (input.currency !== 'JPY') throw Error('currency_not_supported');
    const returnUrl = input.returnUrl ?? deps.env?.STRIPE_RETURN_URL;
    if (!returnUrl) throw Error('return_url_required');
    const metadata = {order_id: input.orderId, telegram_user_id: input.telegramUserId, tenant_id: input.tenantId};
    const recurring = input.recurring ? interval(input.recurring.intervalDays) : undefined;
    const params = {
      mode: recurring ? 'subscription' : 'payment',
      client_reference_id: input.orderId,
      success_url: returnUrl, cancel_url: returnUrl,
      // JPY is a zero-decimal currency: unit_amount is whole yen, no x100.
      line_items: [{quantity: 1, price_data: {currency: 'jpy', unit_amount: input.amount, recurring,
        product_data: {name: input.title, description: input.description || undefined}}}],
      metadata,
      ...(recurring ? {subscription_data: {metadata}} : {payment_intent_data: {metadata}}),
    };
    const s = await api(deps, 'POST', '/checkout/sessions', params, {idempotencyKey: input.idempotencyKey, account: input.connectedAccount});
    return {provider: ID, kind: 'url', url: s.url, externalRef: s.id};
  },

  async verifyWebhook(request, deps) {
    const raw = await request.text();
    const header = request.headers.get('stripe-signature') ?? '';
    const parts = header.split(',').map(p => p.trim().split('='));
    const t = parts.find(([k]) => k === 't')?.[1];
    const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    const secret = deps.env?.STRIPE_WEBHOOK_SECRET;
    if (!secret || !/^\d+$/.test(t ?? '') || !sigs.length) throw Error('bad_signature');
    if (Math.abs(nowSec(deps) - Number(t)) > TOLERANCE_S) throw Error('bad_signature');
    const expected = await hmacHex(secret, `${t}.${raw}`);
    let ok = false;
    for (const s of sigs) ok = safeEqual(s, expected) || ok; // no early exit
    if (!ok) throw Error('bad_signature');
    return mapEvent(JSON.parse(raw));
  },

  async refund({paymentRef, amount, idempotencyKey, connectedAccount}, deps) {
    // A subscription checkout may only give us the invoice (in_…): resolve it to what /refunds takes.
    // UNVERIFIED for newer API versions, where the PaymentIntent moved under invoice.payments.
    let target = {payment_intent: paymentRef};
    if (String(paymentRef).startsWith('in_')) {
      const inv = await api(deps, 'GET', `/invoices/${encodeURIComponent(paymentRef)}`, null, {account: connectedAccount});
      const pi = inv.payment_intent ?? inv.payments?.data?.[0]?.payment?.payment_intent;
      if (pi) target = {payment_intent: pi}; else if (inv.charge) target = {charge: inv.charge}; else throw Error('refund_reference_unresolved');
    } else if (String(paymentRef).startsWith('ch_')) target = {charge: paymentRef};
    const r = await api(deps, 'POST', '/refunds', {...target, amount}, {idempotencyKey, account: connectedAccount});
    return {refundRef: r.id, status: r.status};
  },

  async cancelSubscription({subscriptionRef, atPeriodEnd = true, connectedAccount}, deps) {
    const path = `/subscriptions/${encodeURIComponent(subscriptionRef)}`;
    if (atPeriodEnd) await api(deps, 'POST', path, {cancel_at_period_end: true}, {account: connectedAccount});
    else await api(deps, 'DELETE', path, null, {account: connectedAccount});
  },
};
