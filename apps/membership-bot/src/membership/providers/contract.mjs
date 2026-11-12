// Phase 1 payment layer — the one interface every provider implements (11-payments §4-3).
//
//   provider.id                       'telegram_stars' | 'stripe' | 'komoju' | 'bank_gmo'
//   provider.supports                 {subscription, partialRefund, goodsKinds: [...], currencies: [...]}
//   provider.configured(env)          true only when every key it needs is present (else shown as 無効)
//   provider.createCheckout(input, deps)  -> CheckoutResult
//   provider.verifyWebhook(request, deps) -> NormalizedEvent[]   (throws 'bad_signature' etc.)
//   provider.refund({paymentRef, amount?, idempotencyKey, telegramUserId?}, deps) -> {refundRef, status}
//   provider.cancelSubscription({subscriptionRef, atPeriodEnd, telegramUserId?}, deps) -> void
//
// deps = {env, fetch, call, now}. `fetch` is injected so tests use a mock API and nothing can reach
// a real PSP from a unit test; `call` is the gated Bot API caller (Stars only).
//
// CheckoutInput  {tenantId, planSkuId, orderId, telegramUserId, amount, currency: 'JPY'|'XTR',
//                 goodsKind: 'digital'|'physical_service'|'physical_goods', title, description,
//                 recurring?: {intervalDays}, idempotencyKey, chatId?, returnUrl?}
// CheckoutResult {provider, kind: 'invoice_message'|'invoice_link'|'url'|'bank_transfer',
//                 url?, externalRef, instructions?}
// NormalizedEvent {id, provider, type: 'paid'|'renewed'|'failed'|'canceled'|'expired'|'refunded'|'disputed',
//                 tenantId, telegramUserId, orderId?, subscriptionRef?, paymentRef?, amount?, currency?,
//                 refundAmount?, periodEnd? (unix s), occurredAt (unix s)}
export const GOODS_KINDS = ['digital', 'physical_service', 'physical_goods'];
export const EVENT_TYPES = ['paid', 'renewed', 'failed', 'canceled', 'expired', 'refunded', 'disputed'];

// Telegram Bot Developer Terms §6.2: a digital good or service sold inside Telegram must be paid in
// Stars. External rails are only for physical goods, services delivered in person (reservations), or
// things delivered outside Telegram. This guard runs before every createCheckout, whatever the caller.
export function goodsGuard(providerId, goodsKind) {
  if (!GOODS_KINDS.includes(goodsKind)) throw Error('goods_kind_required');
  if (goodsKind === 'digital' && providerId !== 'telegram_stars') throw Error('digital_goods_require_stars');
  if (goodsKind !== 'digital' && providerId === 'telegram_stars') throw Error('stars_only_for_digital');
}

export function assertEvent(e) {
  if (!e || typeof e.id !== 'string' || !e.id) throw Error('event_id_required');
  if (!EVENT_TYPES.includes(e.type)) throw Error('event_type');
  if (!Number.isFinite(e.occurredAt)) throw Error('event_time');
  return e;
}

// Constant-time comparison for webhook signatures and shared secrets.
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && x.length > 0;
}

export async function hmacHex(key, message, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), {name: 'HMAC', hash}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, typeof message === 'string' ? new TextEncoder().encode(message) : message);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
