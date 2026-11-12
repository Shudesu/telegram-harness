// KOMOJU adapter (hosted session: konbini, PayPay, cards, ...). Implements contract.mjs.
// One-off payments only. Network only through deps.fetch; keys never logged.
import {goodsGuard, safeEqual, hmacHex} from './contract.mjs';

const API = 'https://komoju.com/api/v1';
const ID = 'komoju';

async function api(deps, method, path, body, idempotencyKey) {
  const headers = {authorization: `Basic ${btoa(`${deps.env?.KOMOJU_SECRET_KEY}:`)}`, 'content-type': 'application/json'};
  // Header name per KOMOJU docs ("X-KOMOJU-IDEMPOTENCY"); re-check before go-live.
  if (idempotencyKey) headers['x-komoju-idempotency'] = idempotencyKey;
  const res = await deps.fetch(`${API}${path}`, {method, headers, body: body ? JSON.stringify(body) : undefined});
  if (!res.ok) throw Object.assign(Error(`${ID}_api_error`), {status: res.status});
  return res.json();
}

const TYPES = {
  'payment.captured': 'paid',
  'payment.refunded': 'refunded',
  'payment.expired': 'expired', // konbini slip not paid in time: the order was never paid
  'payment.cancelled': 'expired',
  'payment.failed': 'failed',
};

function mapEvent(ev) {
  const type = TYPES[ev.type];
  if (!type) return [];
  const p = ev.data ?? {};
  const m = p.metadata ?? {};
  const refunded = Array.isArray(p.refunds) ? p.refunds.reduce((s, r) => s + (r.amount ?? 0), 0) : undefined;
  const e = {
    id: `komoju:${ev.id}`, provider: ID, type,
    tenantId: m.tenant_id ?? null,
    telegramUserId: m.telegram_user_id ? Number(m.telegram_user_id) : null,
    orderId: p.external_order_num ?? m.order_id ?? undefined,
    paymentRef: p.id, amount: p.amount, currency: p.currency ? String(p.currency).toUpperCase() : undefined,
    occurredAt: Math.floor(Date.parse(ev.created_at ?? p.updated_at ?? p.created_at) / 1000),
  };
  if (type === 'refunded') e.refundAmount = p.amount_refunded ?? refunded;
  return [e];
}

export const provider = {
  id: ID,
  supports: {subscription: false, partialRefund: true, goodsKinds: ['physical_service', 'physical_goods'], currencies: ['JPY']},
  configured: env => Boolean(env?.KOMOJU_SECRET_KEY && env?.KOMOJU_WEBHOOK_SECRET),

  async createCheckout(input, deps) {
    goodsGuard(ID, input.goodsKind);
    if (input.currency !== 'JPY') throw Error('currency_not_supported');
    if (input.recurring) throw Error('subscription_not_supported');
    const returnUrl = input.returnUrl ?? deps.env?.KOMOJU_RETURN_URL;
    if (!returnUrl) throw Error('return_url_required');
    const metadata = {order_id: input.orderId, telegram_user_id: String(input.telegramUserId), tenant_id: input.tenantId};
    const body = {
      amount: input.amount, currency: 'JPY', return_url: returnUrl, default_locale: 'ja',
      ...(input.paymentTypes?.length ? {payment_types: input.paymentTypes} : {}),
      external_order_num: input.orderId,
      metadata,
      // Sessions carry payment-level fields under payment_data; metadata is duplicated there so the
      // payment.* webhooks see it. UNVERIFIED: confirm metadata propagation against KOMOJU docs.
      payment_data: {external_order_num: input.orderId, metadata},
    };
    const s = await api(deps, 'POST', '/sessions', body, input.idempotencyKey);
    return {provider: ID, kind: 'url', url: s.session_url, externalRef: s.id};
  },

  async verifyWebhook(request, deps) {
    const raw = await request.text();
    const sig = request.headers.get('x-komoju-signature');
    const secret = deps.env?.KOMOJU_WEBHOOK_SECRET;
    if (!secret || !sig || !safeEqual(sig.toLowerCase(), await hmacHex(secret, raw))) throw Error('bad_signature');
    return mapEvent(JSON.parse(raw));
  },

  async refund({paymentRef, amount, idempotencyKey}, deps) {
    const p = await api(deps, 'POST', `/payments/${encodeURIComponent(paymentRef)}/refund`, amount ? {amount} : {}, idempotencyKey);
    const last = Array.isArray(p.refunds) ? p.refunds.at(-1) : null;
    return {refundRef: last?.id ?? p.id, status: p.status};
  },

  async cancelSubscription() {
    throw Error('subscription_not_supported');
  },
};
