// Telegram Stars (XTR) — the only rail allowed for digital goods sold inside Telegram (Bot Developer
// Terms §6.2). Implements the common provider interface (contract.mjs). `deps.call` is the gated Bot
// API caller: it runs only under a pre-approved rule or after the owner approved the item.
import {safeEqual} from './contract.mjs';

export const SUBSCRIPTION_PERIOD = 2592000; // Bot API: currently must be exactly 30 days.
export const MAX_SUBSCRIPTION_STARS = 10000;
const PAYLOAD = /^o:([A-Za-z0-9_-]{1,64})$/;
export const payloadFor = orderId => `o:${orderId}`;
export const orderOfPayload = p => PAYLOAD.exec(String(p ?? ''))?.[1] ?? null;

// Pure mapping from a Telegram update to NormalizedEvents (11-payments §4-3 event table).
export function eventsFromUpdate(update, tenantId = 'main') {
  const out = [], m = update?.message;
  const sp = m?.successful_payment;
  if (sp && sp.currency === 'XTR') {
    const recurringRenewal = sp.is_recurring && !sp.is_first_recurring;
    out.push({
      id: `stars:pay:${sp.telegram_payment_charge_id}`, provider: 'telegram_stars', type: recurringRenewal ? 'renewed' : 'paid',
      tenantId, telegramUserId: m.from?.id, orderId: orderOfPayload(sp.invoice_payload) ?? undefined,
      paymentRef: sp.telegram_payment_charge_id,
      subscriptionRef: sp.subscription_expiration_date ? sp.telegram_payment_charge_id : undefined,
      amount: sp.total_amount, currency: 'XTR', periodEnd: sp.subscription_expiration_date, occurredAt: m.date,
    });
  }
  const rp = m?.refunded_payment;
  if (rp) {
    out.push({
      id: `stars:refund:${rp.telegram_payment_charge_id}`, provider: 'telegram_stars', type: 'refunded', tenantId,
      telegramUserId: m.from?.id, orderId: orderOfPayload(rp.invoice_payload) ?? undefined,
      paymentRef: rp.telegram_payment_charge_id, refundAmount: rp.total_amount, currency: rp.currency, occurredAt: m.date,
    });
  }
  const sub = update?.subscription; // BotSubscriptionUpdated (10.2): canceled | active | failed
  if (sub && ['canceled', 'failed', 'active'].includes(sub.state)) {
    out.push({
      id: `stars:sub:${update.update_id}`, provider: 'telegram_stars',
      // 'active' = a renewal the bot or user had cancelled is switched back on; no new period.
      type: sub.state === 'active' ? 'renewed' : sub.state, resumed: sub.state === 'active' || undefined,
      tenantId, telegramUserId: sub.user?.id, orderId: orderOfPayload(sub.invoice_payload) ?? undefined,
      occurredAt: Math.floor(Date.now() / 1000),
    });
  }
  return out;
}

export const provider = {
  id: 'telegram_stars',
  supports: {subscription: true, partialRefund: false, goodsKinds: ['digital'], currencies: ['XTR']},
  configured: env => Boolean(env?.BOT_TOKEN),

  async createCheckout(i, {call}) {
    if (i.currency !== 'XTR') throw Error('stars_requires_xtr');
    if (!Number.isSafeInteger(i.amount) || i.amount < 1) throw Error('bad_amount');
    const base = {
      title: String(i.title).slice(0, 32), description: String(i.description ?? i.title).slice(0, 255),
      payload: payloadFor(i.orderId), provider_token: '', currency: 'XTR',
      prices: [{label: String(i.title).slice(0, 32), amount: i.amount}],
    };
    if (i.recurring) {
      // Stars subscriptions exist only as invoice links with subscription_period.
      if (i.amount > MAX_SUBSCRIPTION_STARS) throw Error('subscription_price_too_high');
      const url = await call('createInvoiceLink', {...base, subscription_period: SUBSCRIPTION_PERIOD});
      return {provider: 'telegram_stars', kind: 'invoice_link', url, externalRef: base.payload};
    }
    if (Number.isSafeInteger(i.chatId)) {
      await call('sendInvoice', {chat_id: i.chatId, ...base});
      return {provider: 'telegram_stars', kind: 'invoice_message', externalRef: base.payload};
    }
    const url = await call('createInvoiceLink', base);
    return {provider: 'telegram_stars', kind: 'invoice_link', url, externalRef: base.payload};
  },

  // Telegram delivers Stars events on the bot webhook itself; its proof is the secret_token header.
  async verifyWebhook(request, {env}) {
    if (!safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), env.WEBHOOK_SECRET)) throw Error('bad_signature');
    let update;
    try { update = await request.json(); } catch { throw Error('bad_body'); }
    return eventsFromUpdate(update, env.TENANT_ID ?? 'main');
  },

  async refund({paymentRef, amount, fullAmount, telegramUserId}, {call}) {
    // Stars refunds are all-or-nothing; a partial refund is refused rather than silently widened.
    if (amount !== undefined && amount !== fullAmount) throw Error('partial_refund_not_supported');
    if (!Number.isSafeInteger(telegramUserId)) throw Error('user_required');
    await call('refundStarPayment', {user_id: telegramUserId, telegram_payment_charge_id: paymentRef});
    return {refundRef: paymentRef, status: 'succeeded'};
  },

  // Stars can only stop renewal; the period already paid stays valid (editUserStarSubscription).
  async cancelSubscription({subscriptionRef, telegramUserId}, {call}) {
    if (!Number.isSafeInteger(telegramUserId)) throw Error('user_required');
    await call('editUserStarSubscription', {user_id: telegramUserId, telegram_payment_charge_id: subscriptionRef, is_canceled: true});
  },
};
