// providers: Stripe Connect / KOMOJU / bank (virtual account) adapters + registry.
// Every PSP is a mock fetch: no network, no real keys (all secrets below are obviously fake).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {register} from 'node:module';
import {hmacHex, goodsGuard, assertEvent} from '../src/membership/providers/contract.mjs';

const {provider: stripe} = await import('../src/membership/providers/stripe.mjs');
const {provider: komoju} = await import('../src/membership/providers/komoju.mjs');
const {provider: bank, BANK_API} = await import('../src/membership/providers/bank.mjs');

const NOW = Date.parse('2026-11-11T03:00:00Z');
const ENV = {
  STRIPE_SECRET_KEY: 'stripe-secret-NOT-REAL', STRIPE_WEBHOOK_SECRET: 'stripe-whsec-NOT-REAL',
  KOMOJU_SECRET_KEY: 'komoju-secret-NOT-REAL', KOMOJU_WEBHOOK_SECRET: 'komoju-whsec-NOT-REAL',
  BANK_API_BASE: 'https://bank.mock.invalid/api/', BANK_API_TOKEN: 'bank-token-NOT-REAL', BANK_WEBHOOK_SECRET: 'bank-whsec-NOT-REAL',
};
for (const v of Object.values(ENV)) {
  assert.ok(!/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/.test(v) && !/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/.test(v));
}

// Mock fetch: records every request, answers from a queue of canned responses.
function mockFetch(...responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body});
    const r = responses.shift() ?? {status: 200, json: {}};
    return Response.json(r.json ?? {}, {status: r.status ?? 200});
  };
  return {fetch, calls};
}
const depsWith = (m, extra = {}) => ({env: ENV, fetch: m.fetch, now: () => NOW, ...extra});
const noNet = async () => { throw Error('network_used'); };

const INPUT = {
  tenantId: 'tenant-a', planSkuId: 'sku-1', orderId: 'ord_123', telegramUserId: 555000111, amount: 3000,
  currency: 'JPY', goodsKind: 'physical_service', title: '整体 60分', description: '店舗予約',
  idempotencyKey: 'idem-ord_123', returnUrl: 'https://example.invalid/return',
};

let pass = 0; const results = [];
async function test(name, fn) { await fn(); pass++; results.push(name); }
const rejects = (p, msg) => assert.rejects(p, e => e.message === msg);
const req = (body, headers) => new Request('https://worker.invalid/hook', {method: 'POST', body, headers});

// ---- Stripe ----
const S = ENV.STRIPE_WEBHOOK_SECRET;
const tNow = Math.floor(NOW / 1000);
async function stripeReq(ev, {t = tNow, secret = S, header} = {}) {
  const raw = JSON.stringify(ev);
  const sig = await hmacHex(secret, `${t}.${raw}`);
  return req(raw, {'stripe-signature': header ?? `t=${t},v1=${sig}`});
}
const meta = {order_id: 'ord_123', telegram_user_id: '555000111', tenant_id: 'tenant-a'};
const sev = (type, object) => ({id: `evt_${type}`, type, created: tNow, data: {object}});

await test('configured() is false unless every key is present', async () => {
  assert.equal(stripe.configured({}), false);
  assert.equal(stripe.configured({STRIPE_SECRET_KEY: 'x'}), false);
  assert.equal(stripe.configured(ENV), true);
  assert.equal(komoju.configured({KOMOJU_SECRET_KEY: 'x'}), false);
  assert.equal(komoju.configured(ENV), true);
  assert.equal(bank.configured({BANK_API_BASE: 'x', BANK_API_TOKEN: 'y'}), false);
  assert.equal(bank.configured(ENV), true);
});

await test('stripe createCheckout: form body, auth, idempotency, Connect account, metadata, JPY zero-decimal', async () => {
  const m = mockFetch({json: {id: 'cs_mock_1', url: 'https://checkout.stripe.com/c/pay/cs_mock_1'}});
  const r = await stripe.createCheckout({...INPUT, connectedAccount: 'acct_mock'}, depsWith(m));
  assert.deepEqual(r, {provider: 'stripe', kind: 'url', url: 'https://checkout.stripe.com/c/pay/cs_mock_1', externalRef: 'cs_mock_1'});
  const c = m.calls[0];
  assert.equal(c.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.authorization, `Bearer ${ENV.STRIPE_SECRET_KEY}`);
  assert.equal(c.headers['idempotency-key'], 'idem-ord_123');
  assert.equal(c.headers['stripe-account'], 'acct_mock');
  assert.equal(c.headers['content-type'], 'application/x-www-form-urlencoded');
  const b = new URLSearchParams(c.body);
  assert.equal(b.get('mode'), 'payment');
  assert.equal(b.get('client_reference_id'), 'ord_123');
  assert.equal(b.get('metadata[order_id]'), 'ord_123');
  assert.equal(b.get('metadata[telegram_user_id]'), '555000111');
  assert.equal(b.get('metadata[tenant_id]'), 'tenant-a');
  assert.equal(b.get('payment_intent_data[metadata][order_id]'), 'ord_123');
  assert.equal(b.get('line_items[0][price_data][currency]'), 'jpy');
  assert.equal(b.get('line_items[0][price_data][unit_amount]'), '3000');
  assert.equal(b.get('success_url'), INPUT.returnUrl);
});

await test('stripe createCheckout: subscription mode for recurring, env Connect account fallback', async () => {
  const m = mockFetch({json: {id: 'cs_mock_2', url: 'https://checkout.stripe.com/x'}});
  await stripe.createCheckout({...INPUT, recurring: {intervalDays: 30}}, depsWith(m, {env: {...ENV, STRIPE_CONNECT_ACCOUNT: 'acct_env'}}));
  const b = new URLSearchParams(m.calls[0].body);
  assert.equal(b.get('mode'), 'subscription');
  assert.equal(b.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(b.get('subscription_data[metadata][telegram_user_id]'), '555000111');
  assert.equal(b.get('payment_intent_data[metadata][order_id]'), null);
  assert.equal(m.calls[0].headers['stripe-account'], 'acct_env');
});

await test('stripe non-2xx -> stripe_api_error with status, no key in the message', async () => {
  const m = mockFetch({status: 402, json: {error: {message: 'card_declined'}}});
  await assert.rejects(stripe.createCheckout(INPUT, depsWith(m)), e => e.message === 'stripe_api_error' && e.status === 402 && !e.message.includes(ENV.STRIPE_SECRET_KEY));
});

await test('stripe verifyWebhook: valid signature accepted; bad, missing, wrong secret and stale rejected', async () => {
  const ev = sev('checkout.session.completed', {client_reference_id: 'ord_123', payment_status: 'paid', amount_total: 3000, currency: 'jpy', payment_intent: 'pi_1', metadata: meta});
  const d = depsWith({fetch: noNet});
  assert.equal((await stripe.verifyWebhook(await stripeReq(ev), d)).length, 1);
  // several v1 entries (secret rotation): any match is accepted
  const raw = JSON.stringify(ev), good = await hmacHex(S, `${tNow}.${raw}`);
  assert.equal((await stripe.verifyWebhook(req(raw, {'stripe-signature': `t=${tNow},v1=${'0'.repeat(64)},v1=${good}`}), d)).length, 1);
  await rejects(stripe.verifyWebhook(await stripeReq(ev, {secret: 'other-NOT-REAL'}), d), 'bad_signature');
  await rejects(stripe.verifyWebhook(req(raw, {}), d), 'bad_signature');
  await rejects(stripe.verifyWebhook(req(raw, {'stripe-signature': `t=${tNow}`}), d), 'bad_signature');
  await rejects(stripe.verifyWebhook(req(raw.replace('3000', '1'), {'stripe-signature': `t=${tNow},v1=${good}`}), d), 'bad_signature');
  await rejects(stripe.verifyWebhook(await stripeReq(ev, {t: tNow - 301}), d), 'bad_signature');
  await rejects(stripe.verifyWebhook(await stripeReq(ev, {t: tNow + 301}), d), 'bad_signature');
  assert.equal((await stripe.verifyWebhook(await stripeReq(ev, {t: tNow - 299}), d)).length, 1);
});

await test('stripe event mapping covers every listed type', async () => {
  const d = depsWith({fetch: noNet});
  const map = async ev => (await stripe.verifyWebhook(await stripeReq(ev), d)).map(assertEvent);
  const subMeta = {subscription_details: {metadata: meta}};
  let [e] = await map(sev('checkout.session.completed', {client_reference_id: 'ord_123', payment_status: 'paid', amount_total: 3000, currency: 'jpy', payment_intent: 'pi_1', metadata: meta}));
  assert.deepEqual({id: e.id, type: e.type, orderId: e.orderId, tg: e.telegramUserId, tenant: e.tenantId, amt: e.amount, cur: e.currency, ref: e.paymentRef, at: e.occurredAt},
    {id: 'evt_checkout.session.completed', type: 'paid', orderId: 'ord_123', tg: 555000111, tenant: 'tenant-a', amt: 3000, cur: 'JPY', ref: 'pi_1', at: tNow});
  assert.deepEqual(await map(sev('checkout.session.completed', {payment_status: 'unpaid', metadata: meta})), []);
  [e] = await map(sev('checkout.session.async_payment_succeeded', {client_reference_id: 'ord_123', payment_status: 'paid', amount_total: 3000, metadata: meta}));
  assert.equal(e.type, 'paid');
  [e] = await map(sev('invoice.paid', {id: 'in_1', billing_reason: 'subscription_cycle', subscription: 'sub_1', amount_paid: 3000, lines: {data: [{period: {end: tNow + 2592000}}]}, metadata: {}, ...subMeta}));
  assert.deepEqual([e.type, e.subscriptionRef, e.periodEnd, e.telegramUserId], ['renewed', 'sub_1', tNow + 2592000, 555000111]);
  assert.deepEqual(await map(sev('invoice.paid', {billing_reason: 'subscription_create', ...subMeta})), []);
  [e] = await map(sev('invoice.payment_failed', {id: 'in_2', subscription: 'sub_1', amount_due: 3000, ...subMeta}));
  assert.deepEqual([e.type, e.subscriptionRef], ['failed', 'sub_1']);
  [e] = await map(sev('customer.subscription.updated', {id: 'sub_1', cancel_at_period_end: true, current_period_end: tNow + 99, metadata: meta}));
  assert.deepEqual([e.type, e.subscriptionRef, e.periodEnd], ['canceled', 'sub_1', tNow + 99]);
  assert.deepEqual(await map(sev('customer.subscription.updated', {id: 'sub_1', cancel_at_period_end: false, metadata: meta})), []);
  [e] = await map(sev('customer.subscription.deleted', {id: 'sub_1', ended_at: tNow, metadata: meta}));
  assert.deepEqual([e.type, e.subscriptionRef], ['expired', 'sub_1']);
  [e] = await map(sev('charge.refunded', {id: 'ch_1', payment_intent: 'pi_1', amount: 3000, amount_refunded: 1000, currency: 'jpy', metadata: meta}));
  assert.deepEqual([e.type, e.paymentRef, e.refundAmount], ['refunded', 'pi_1', 1000]);
  [e] = await map(sev('charge.dispute.created', {id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 3000, metadata: meta}));
  assert.deepEqual([e.type, e.paymentRef], ['disputed', 'pi_1']);
  assert.deepEqual(await map(sev('customer.created', {id: 'cus_1'})), []);
});

await test('stripe refund and cancelSubscription request shapes', async () => {
  const m = mockFetch({json: {id: 're_1', status: 'succeeded'}}, {json: {}}, {json: {}});
  assert.deepEqual(await stripe.refund({paymentRef: 'pi_1', amount: 1000, idempotencyKey: 'idem-ref-1'}, depsWith(m)), {refundRef: 're_1', status: 'succeeded'});
  assert.equal(m.calls[0].url, 'https://api.stripe.com/v1/refunds');
  assert.equal(m.calls[0].headers['idempotency-key'], 'idem-ref-1');
  const b = new URLSearchParams(m.calls[0].body);
  assert.deepEqual([b.get('payment_intent'), b.get('amount')], ['pi_1', '1000']);
  await stripe.cancelSubscription({subscriptionRef: 'sub_1', atPeriodEnd: true}, depsWith(m));
  assert.deepEqual([m.calls[1].method, m.calls[1].url, m.calls[1].body], ['POST', 'https://api.stripe.com/v1/subscriptions/sub_1', 'cancel_at_period_end=true']);
  await stripe.cancelSubscription({subscriptionRef: 'sub_1', atPeriodEnd: false}, depsWith(m));
  assert.deepEqual([m.calls[2].method, m.calls[2].url, m.calls[2].body], ['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_1', undefined]);
  // full refund: amount omitted from the body
  const m2 = mockFetch({json: {id: 're_2', status: 'pending'}});
  await stripe.refund({paymentRef: 'pi_1', idempotencyKey: 'k'}, depsWith(m2));
  assert.equal(new URLSearchParams(m2.calls[0].body).has('amount'), false);
});

// ---- KOMOJU ----
const KS = ENV.KOMOJU_WEBHOOK_SECRET;
async function komojuReq(ev, {secret = KS, sig} = {}) {
  const raw = JSON.stringify(ev);
  return req(raw, sig === null ? {} : {'x-komoju-signature': sig ?? await hmacHex(secret, raw)});
}
const payment = (extra = {}) => ({id: 'pay_1', amount: 3000, currency: 'JPY', status: 'captured', external_order_num: 'ord_123', metadata: meta, ...extra});
const kev = (type, data) => ({id: `kev_${type}`, type, resource: 'event', created_at: '2026-11-11T03:00:00Z', data});

await test('komoju createCheckout: Basic auth, JSON body, payment_types, idempotency, session_url', async () => {
  const m = mockFetch({json: {id: 'sess_1', session_url: 'https://komoju.com/sessions/sess_1'}});
  const r = await komoju.createCheckout({...INPUT, paymentTypes: ['konbini', 'paypay']}, depsWith(m));
  assert.deepEqual(r, {provider: 'komoju', kind: 'url', url: 'https://komoju.com/sessions/sess_1', externalRef: 'sess_1'});
  const c = m.calls[0];
  assert.equal(c.url, 'https://komoju.com/api/v1/sessions');
  assert.equal(c.headers.authorization, `Basic ${Buffer.from(`${ENV.KOMOJU_SECRET_KEY}:`).toString('base64')}`);
  assert.equal(c.headers['x-komoju-idempotency'], 'idem-ord_123');
  const b = JSON.parse(c.body);
  assert.deepEqual([b.amount, b.currency, b.return_url, b.external_order_num, b.payment_types], [3000, 'JPY', INPUT.returnUrl, 'ord_123', ['konbini', 'paypay']]);
  assert.deepEqual(b.metadata, meta);
  const m2 = mockFetch({json: {id: 's', session_url: 'u'}});
  await komoju.createCheckout(INPUT, depsWith(m2));
  assert.equal('payment_types' in JSON.parse(m2.calls[0].body), false);
  await rejects(komoju.createCheckout({...INPUT, recurring: {intervalDays: 30}}, depsWith(m2)), 'subscription_not_supported');
  await assert.rejects(komoju.createCheckout(INPUT, depsWith(mockFetch({status: 422}))), e => e.message === 'komoju_api_error' && e.status === 422);
});

await test('komoju verifyWebhook: signature checked, every listed type mapped, unknown -> []', async () => {
  const d = depsWith({fetch: noNet});
  const ev = kev('payment.captured', payment());
  await rejects(komoju.verifyWebhook(await komojuReq(ev, {secret: 'other-NOT-REAL'}), d), 'bad_signature');
  await rejects(komoju.verifyWebhook(await komojuReq(ev, {sig: null}), d), 'bad_signature');
  const map = async e => (await komoju.verifyWebhook(await komojuReq(e), d)).map(assertEvent);
  let [e] = await map(ev);
  assert.deepEqual([e.type, e.orderId, e.telegramUserId, e.tenantId, e.paymentRef, e.amount, e.occurredAt], ['paid', 'ord_123', 555000111, 'tenant-a', 'pay_1', 3000, tNow]);
  [e] = await map(kev('payment.refunded', payment({status: 'refunded', amount_refunded: 1000})));
  assert.deepEqual([e.type, e.refundAmount], ['refunded', 1000]);
  [e] = await map(kev('payment.refunded', payment({refunds: [{id: 'rf_1', amount: 500}, {id: 'rf_2', amount: 700}]})));
  assert.equal(e.refundAmount, 1200);
  assert.equal((await map(kev('payment.expired', payment({status: 'expired'}))))[0].type, 'expired');
  assert.equal((await map(kev('payment.cancelled', payment({status: 'cancelled'}))))[0].type, 'expired');
  assert.equal((await map(kev('payment.failed', payment({status: 'failed'}))))[0].type, 'failed');
  assert.deepEqual(await map(kev('payment.authorized', payment())), []);
});

await test('komoju refund and cancelSubscription', async () => {
  const m = mockFetch({json: {id: 'pay_1', status: 'refunded', refunds: [{id: 'rf_9', amount: 1000}]}});
  assert.deepEqual(await komoju.refund({paymentRef: 'pay_1', amount: 1000, idempotencyKey: 'idem-r'}, depsWith(m)), {refundRef: 'rf_9', status: 'refunded'});
  assert.equal(m.calls[0].url, 'https://komoju.com/api/v1/payments/pay_1/refund');
  assert.equal(m.calls[0].method, 'POST');
  assert.equal(m.calls[0].headers['x-komoju-idempotency'], 'idem-r');
  assert.deepEqual(JSON.parse(m.calls[0].body), {amount: 1000});
  await rejects(komoju.cancelSubscription({subscriptionRef: 'x', atPeriodEnd: true}, depsWith(m)), 'subscription_not_supported');
  assert.equal(komoju.supports.subscription, false);
});

// ---- Bank (virtual account) ----
const BS = ENV.BANK_WEBHOOK_SECRET;
async function bankReq(body, {secret = BS, sig} = {}) {
  const raw = JSON.stringify(body);
  return req(raw, sig === null ? {} : {[BANK_API.signatureHeader]: sig ?? await hmacHex(secret, raw)});
}
const EXPECT = {va_1: {orderId: 'ord_123', telegramUserId: 555000111, tenantId: 'tenant-a', amount: 3000}};
function bankDeps() {
  const reviews = [];
  return {reviews, deps: depsWith({fetch: noNet}, {lookupBankExpectation: async id => EXPECT[id] ?? null, onReviewNeeded: async r => { reviews.push(r); }})};
}
const deposit = (extra = {}) => ({virtualAccountId: 'va_1', amount: 3000, depositId: 'dep_1', depositedAt: '2026-11-11T03:00:00Z', ...extra});

await test('bank createCheckout issues a per-order virtual account and returns transfer instructions', async () => {
  const m = mockFetch({json: {virtualAccountId: 'va_1', bankName: 'GMOあおぞらネット銀行', branchName: '法人第二営業部', accountType: '普通', accountNumber: '0000001', accountName: 'テスト（カ', expiresAt: '2026-11-14T03:00:00.000Z'}});
  const r = await bank.createCheckout(INPUT, depsWith(m));
  assert.equal(m.calls[0].url, 'https://bank.mock.invalid/api/virtual-accounts');
  assert.equal(m.calls[0].headers.authorization, `Bearer ${ENV.BANK_API_TOKEN}`);
  assert.equal(m.calls[0].headers['idempotency-key'], 'idem-ord_123');
  assert.deepEqual(JSON.parse(m.calls[0].body), {amount: 3000, orderId: 'ord_123', expiresAt: '2026-11-14T03:00:00.000Z'});
  assert.deepEqual(r, {provider: 'bank_gmo', kind: 'bank_transfer', externalRef: 'va_1', instructions: {
    bankName: 'GMOあおぞらネット銀行', branch: '法人第二営業部', accountType: '普通', accountNumber: '0000001', accountName: 'テスト（カ', amount: 3000, deadline: '2026-11-14T03:00:00.000Z'}});
  await assert.rejects(bank.createCheckout(INPUT, depsWith(mockFetch({status: 500}))), e => e.message === 'bank_gmo_api_error' && e.status === 500);
});

await test('bank deposit: exact amount -> paid with id bank:<depositId>; bad/missing signature rejected', async () => {
  const {deps, reviews} = bankDeps();
  const [e] = (await bank.verifyWebhook(await bankReq(deposit()), deps)).map(assertEvent);
  assert.deepEqual([e.id, e.type, e.orderId, e.telegramUserId, e.tenantId, e.amount, e.currency, e.occurredAt], ['bank:dep_1', 'paid', 'ord_123', 555000111, 'tenant-a', 3000, 'JPY', tNow]);
  assert.equal(reviews.length, 0);
  await rejects(bank.verifyWebhook(await bankReq(deposit(), {secret: 'other-NOT-REAL'}), deps), 'bad_signature');
  await rejects(bank.verifyWebhook(await bankReq(deposit(), {sig: null}), deps), 'bad_signature');
});

await test('bank deposit: amount mismatch or unknown account -> no paid event, review callback', async () => {
  const {deps, reviews} = bankDeps();
  assert.deepEqual(await bank.verifyWebhook(await bankReq(deposit({amount: 2999, depositId: 'dep_2'})), deps), []);
  assert.deepEqual(await bank.verifyWebhook(await bankReq(deposit({amount: 6000, depositId: 'dep_3'})), deps), []);
  assert.deepEqual(await bank.verifyWebhook(await bankReq(deposit({virtualAccountId: 'va_x', depositId: 'dep_4'})), deps), []);
  assert.deepEqual(reviews, [{reason: 'amount_mismatch', depositId: 'dep_2'}, {reason: 'amount_mismatch', depositId: 'dep_3'}, {reason: 'unknown_account', depositId: 'dep_4'}]);
  // no review hook supplied: still nothing emitted, nothing thrown
  assert.deepEqual(await bank.verifyWebhook(await bankReq(deposit({amount: 1})), depsWith({fetch: noNet}, {lookupBankExpectation: async () => EXPECT.va_1})), []);
});

await test('bank refund is manual (no API call); subscriptions unsupported', async () => {
  assert.deepEqual(await bank.refund({paymentRef: 'dep_1', idempotencyKey: 'k'}, depsWith({fetch: noNet})),
    {refundRef: 'manual:dep_1', status: 'pending', note: 'bank_refund_is_manual_transfer'});
  await rejects(bank.cancelSubscription({subscriptionRef: 'x'}, depsWith({fetch: noNet})), 'subscription_not_supported');
});

// ---- Goods guard (Bot Developer Terms §6.2) ----
await test('goods guard: digital via stripe/komoju/bank -> digital_goods_require_stars, before any request', async () => {
  for (const p of [stripe, komoju, bank]) {
    await rejects(p.createCheckout({...INPUT, goodsKind: 'digital'}, depsWith({fetch: noNet})), 'digital_goods_require_stars');
    await rejects(p.createCheckout({...INPUT, goodsKind: undefined}, depsWith({fetch: noNet})), 'goods_kind_required');
    assert.ok(!p.supports.goodsKinds.includes('digital'));
  }
  assert.throws(() => goodsGuard('telegram_stars', 'physical_goods'), {message: 'stars_only_for_digital'});
  assert.throws(() => goodsGuard('telegram_stars', 'physical_service'), {message: 'stars_only_for_digital'});
});

// ---- Registry (index.mjs). stars.mjs is owned by another engineer: if it is not there yet, a stub
// is served in its place through a resolve hook (nothing is written to src/).
const STARS = new URL('../src/membership/providers/stars.mjs', import.meta.url);
const starsStubbed = !fs.existsSync(STARS);
if (starsStubbed) {
  const stub = 'data:text/javascript,' + encodeURIComponent(
    "export const provider={id:'telegram_stars',supports:{subscription:true,partialRefund:false,goodsKinds:['digital'],currencies:['XTR']}," +
    "configured:()=>true,createCheckout:async()=>({provider:'telegram_stars',kind:'invoice_link',url:'https://t.me/$stub',externalRef:'stub'})};");
  const hooks = `export function resolve(s,c,n){if(s==='./stars.mjs'&&c.parentURL&&c.parentURL.endsWith('/providers/index.mjs'))return{url:${JSON.stringify(stub)},shortCircuit:true};return n(s,c);}`;
  register('data:text/javascript,' + encodeURIComponent(hooks));
}
const R = await import('../src/membership/providers/index.mjs');

await test('registry: providerStatus labels / configured / reason; startCheckout guard + config checks', async () => {
  assert.deepEqual(Object.keys(R.PROVIDERS), ['telegram_stars', 'stripe', 'komoju', 'bank_gmo']);
  const st = Object.fromEntries(R.providerStatus({}).map(s => [s.id, s]));
  assert.equal(st.stripe.label, 'Stripe Connect');
  assert.equal(st.komoju.label, 'KOMOJU（コンビニ・PayPay等）');
  assert.equal(st.bank_gmo.label, '銀行振込（バーチャル口座・自動消込）');
  assert.equal(st.telegram_stars.label, 'Telegram Stars');
  for (const id of ['stripe', 'komoju', 'bank_gmo']) assert.deepEqual([st[id].configured, st[id].enabled, st[id].reason], [false, false, '未設定（APIキーなし）のため無効']);
  const on = Object.fromEntries(R.providerStatus(ENV).map(s => [s.id, s]));
  for (const id of ['stripe', 'komoju', 'bank_gmo']) assert.deepEqual([on[id].configured, on[id].enabled, on[id].reason], [true, true, null]);

  const m = mockFetch({json: {id: 'cs_r', url: 'https://checkout.stripe.com/r'}});
  await rejects(R.startCheckout('stripe', {...INPUT, goodsKind: 'digital'}, depsWith(m)), 'digital_goods_require_stars');
  await rejects(R.startCheckout('telegram_stars', INPUT, depsWith(m)), 'stars_only_for_digital');
  await rejects(R.startCheckout('stripe', INPUT, depsWith(m, {env: {}})), 'provider_not_configured');
  await rejects(R.startCheckout('paypal', INPUT, depsWith(m)), 'provider_not_configured');
  await rejects(R.startCheckout('__proto__', INPUT, depsWith(m)), 'provider_not_configured');
  assert.equal(m.calls.length, 0);
  assert.equal((await R.startCheckout('stripe', INPUT, depsWith(m))).externalRef, 'cs_r');
  assert.equal(m.calls.length, 1);
  results.push(`starsModule=${starsStubbed ? 'stub' : 'real'}`);
});

console.log(JSON.stringify({suite: 'providers', passed: true, tests: pass, results}, null, 1));
