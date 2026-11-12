// Regression tests for the refund / billing-period edge cases from the Codex review (OSS "known issues").
// Service-level, in-memory store, mock Telegram/Stripe; no network, no real charge or refund.
import assert from 'node:assert/strict';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const STRIPE_WH = 'stripe-webhook-NOT-REAL';
const G1 = -1000000000301;
const U = 70000301, U2 = 70000302;
const DAY = 86400000, S30 = 2592000;
const {makeService, addInterval} = await import('../src/membership/service.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const {hmacHex} = await import('../src/membership/providers/contract.mjs');

let clock = Date.UTC(2026, 10, 12);
let api = [], stripeCalls = [], invoices = {};
const fetchMock = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    stripeCalls.push({url: u, method: init.method});
    const inv = /\/invoices\/([^/?]+)/.exec(u)?.[1];
    if (inv) {
      const i = invoices[inv];
      if (!i) return Response.json({error: {}}, {status: 404});
      const expand = new URL(u).searchParams.getAll('expand[]').includes('payments');
      if (i.legacy && expand) return Response.json({error: {type: 'invalid_request_error'}}, {status: 400}); // pre-Basil: no such field
      const {payments, ...rest} = i; // like the Basil API: payments only when expanded
      return Response.json(expand ? i : rest);
    }
    return Response.json({id: 're_mock', status: 'succeeded'});
  }
  const method = u.split('/').pop();
  api.push({method, body: JSON.parse(init.body)});
  return Response.json({ok: true, result: method === 'createInvoiceLink' ? 'https://t.me/$TEST_LINK' : method.startsWith('send') ? {message_id: 1} : true});
};
const env = {BOT_TOKEN: TOKEN, STRIPE_SECRET_KEY: 'stripe-secret-NOT-REAL', STRIPE_WEBHOOK_SECRET: STRIPE_WH};
const make = () => makeService({store: memoryStore(), env, fetch: fetchMock, now: () => clock, rng: () => 0});
const PRESETS = ['checkout', 'join_verify', 'join_approve_paid', 'join_decline', 'expire_remove', 'member_notice'];
async function setup(svc) {
  await svc.setPlan({id: 'm', title: 'M', goodsKind: 'digital', chats: [G1], skus: [{id: 'msub', amount: 300, currency: 'XTR', days: 30, recurring: true}, {id: 'm30', amount: 100, currency: 'XTR', days: 30}]});
  await svc.setPlan({id: 'sv', title: 'SV', goodsKind: 'physical_service', chats: [G1], skus: [
    {id: 'svm', amount: 1000, currency: 'JPY', days: 30, recurring: true, providers: ['stripe']},
    {id: 'svy', amount: 10000, currency: 'JPY', days: 365, recurring: true, providers: ['stripe']},
    {id: 'sv1', amount: 3000, currency: 'JPY', days: 30, providers: ['stripe']}]});
  for (const p of PRESETS) await svc.gate.addRule(p);
}
const ent = (svc, u, p) => svc.store.get(`ent:${u}:${p}`);
const order = (svc, id) => svc.store.get(`order:${id}`);
const sec = () => Math.floor(clock / 1000);

// Telegram Stars subscription charges (first = is_first_recurring).
async function starsSub(svc, user) {
  const r = await svc.checkout({userId: user, chatId: user, skuId: 'msub', provider: 'telegram_stars'});
  return r.orderId;
}
const starsCharge = (svc, user, orderId, charge, periodEnd, first = false) => svc.handleUpdate({message: {from: {id: user}, chat: {id: user, type: 'private'}, date: sec(),
  successful_payment: {currency: 'XTR', total_amount: 300, invoice_payload: `o:${orderId}`, telegram_payment_charge_id: charge, provider_payment_charge_id: '',
    is_recurring: true, ...(first ? {is_first_recurring: true} : {}), subscription_expiration_date: periodEnd}}});
const starsRefund = (svc, user, orderId, charge) => svc.handleUpdate({message: {from: {id: user}, chat: {id: user, type: 'private'}, date: sec(),
  refunded_payment: {currency: 'XTR', total_amount: 300, invoice_payload: `o:${orderId}`, telegram_payment_charge_id: charge}}});

// Stripe webhooks, signed with the test secret.
async function stripe(svc, ev) {
  const raw = JSON.stringify({created: sec(), ...ev});
  const t = sec();
  return svc.payWebhook('stripe', new Request('https://x.invalid/', {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${await hmacHex(STRIPE_WH, `${t}.${raw}`)}`}, body: raw}));
}
async function stripeCheckout(svc, user, sku, evId, obj) {
  const r = await svc.checkout({userId: user, chatId: user, skuId: sku, provider: 'stripe'});
  const o = await order(svc, r.orderId);
  await stripe(svc, {id: evId, type: 'checkout.session.completed', data: {object: {client_reference_id: r.orderId, payment_status: 'paid', amount_total: o.amount, currency: 'jpy', metadata: {order_id: r.orderId}, ...obj}}});
  return r.orderId;
}

const results = [], failures = [];
async function test(name, fn) {
  try { api = []; stripeCalls = []; invoices = {}; clock = Date.UTC(2026, 10, 12); await fn(); results.push(name); }
  catch (err) { failures.push(name); console.error(`FAIL: ${name}\n  ${String(err?.message ?? err).split('\n').slice(0, 6).join('\n  ')}`); }
}

// ---- 1. refunding the first charge of a running subscription ----
await test('subscription: refunding the first charge keeps the order renewable (next renewal still grants)', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  clock += 30 * DAY;
  await starsCharge(svc, U, o, 'k2', t0 + 2 * S30);
  clock += 2 * DAY;
  await starsRefund(svc, U, o, 'k1');                         // owner refunds the first month only
  assert.equal((await order(svc, o)).state, 'paid', 'order stays renewable');
  let e = await ent(svc, U, 'm');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, (t0 + 2 * S30) * 1000, 'the renewed month is not shortened');
  clock = (t0 + 2 * S30) * 1000;
  const out = await starsCharge(svc, U, o, 'k3', t0 + 3 * S30);
  assert.equal(out.out[0].status, 'renewed');
  e = await ent(svc, U, 'm');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, (t0 + 3 * S30) * 1000);
});

await test('subscription: refunding the only charge revokes now, but a later renewal of the same subscription grants again', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U2);
  const t0 = sec();
  await starsCharge(svc, U2, o, 'k1', t0 + S30, true);
  clock += DAY;
  await starsRefund(svc, U2, o, 'k1');
  assert.equal((await ent(svc, U2, 'm')).state, 'revoked');
  clock = (t0 + S30) * 1000;
  const out = await starsCharge(svc, U2, o, 'k2', t0 + 2 * S30);
  assert.equal(out.out[0].status, 'renewed');
  const e = await ent(svc, U2, 'm');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, (t0 + 2 * S30) * 1000);
});

await test('owner refund of an order whose charge was already refunded is refused (no double refund)', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  await starsRefund(svc, U, o, 'k1');
  await assert.rejects(svc.refund(o), /not_refundable/);
});

// ---- 2. renewal during grace / at the boundary, then refunding the old charge ----
await test('renewal during grace: refunding the consumed previous charge does not shorten the new period', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  clock = (t0 + S30) * 1000;
  await svc.cron();                                           // boundary: waits for the renewal in grace
  assert.equal((await ent(svc, U, 'm')).state, 'grace');
  clock += 1000;
  await starsCharge(svc, U, o, 'k2', t0 + 2 * S30);
  clock += DAY;
  await starsRefund(svc, U, o, 'k1');
  const e = await ent(svc, U, 'm');
  assert.equal(e.state, 'active', 'still a member'); assert.equal(e.expiresAt, (t0 + 2 * S30) * 1000);
});

await test('renewal just before expiry: refunding the previous (now consumed) charge after the boundary does not shorten the new period', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  clock = (t0 + S30) * 1000 - 1000;
  await starsCharge(svc, U, o, 'k2', t0 + 2 * S30);
  clock = (t0 + S30) * 1000 + DAY;
  await starsRefund(svc, U, o, 'k1');
  const e = await ent(svc, U, 'm');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, (t0 + 2 * S30) * 1000);
});

await test('stacked one-off purchases: refunding a partly used first purchase takes back only its unused days', async () => {
  const svc = make(); await setup(svc);
  const buy = async c => { const r = await svc.checkout({userId: U2, chatId: U2, skuId: 'm30', provider: 'telegram_stars'});
    await svc.handleUpdate({message: {from: {id: U2}, chat: {id: U2, type: 'private'}, date: sec(), successful_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${r.orderId}`, telegram_payment_charge_id: c, provider_payment_charge_id: ''}}});
    return r.orderId; };
  const t0 = clock;
  const o1 = await buy('p1'); await buy('p2');
  assert.equal((await ent(svc, U2, 'm')).expiresAt, t0 + 60 * DAY);
  clock = t0 + 20 * DAY;
  await svc.handleUpdate({message: {from: {id: U2}, chat: {id: U2, type: 'private'}, date: sec(), refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${o1}`, telegram_payment_charge_id: 'p1'}}});
  const e = await ent(svc, U2, 'm');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, t0 + 50 * DAY, 'the second purchase keeps its full 30 days from now');
});

// ---- 3. calendar periods ----
await test('monthly/yearly interval clamps to the last day of the target month (UTC calendar)', async () => {
  const at = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h);
  assert.equal(addInterval(at(2027, 1, 31, 5), 30), at(2027, 2, 28, 5));
  assert.equal(addInterval(at(2028, 1, 31), 31), at(2028, 2, 29));
  assert.equal(addInterval(at(2027, 3, 31), 30), at(2027, 4, 30));
  assert.equal(addInterval(at(2027, 12, 31), 30), at(2028, 1, 31));
  assert.equal(addInterval(at(2028, 2, 29), 365), at(2029, 2, 28));
  assert.equal(addInterval(at(2027, 2, 28), 366), at(2028, 2, 28));
  assert.equal(addInterval(at(2027, 1, 15), 7), at(2027, 1, 22));
  // 2027-03-01 08:00 JST is still 2027-02-28 in UTC: the month is counted on the UTC date.
  assert.equal(addInterval(Date.parse('2027-03-01T08:00:00+09:00'), 30), Date.parse('2027-03-29T08:00:00+09:00'));
});

await test('Stripe monthly subscription bought on Jan 31 expires on Feb 28, not in March', async () => {
  const svc = make(); await setup(svc);
  clock = Date.UTC(2027, 0, 31, 3);
  await stripeCheckout(svc, U, 'svm', 'evm1', {payment_intent: 'pi_m1', subscription: 'sub_m1'});
  assert.equal((await ent(svc, U, 'sv')).expiresAt, Date.UTC(2027, 1, 28, 3));
});

await test('Stripe yearly subscription bought on Feb 29 expires on Feb 28 of the next year', async () => {
  const svc = make(); await setup(svc);
  clock = Date.UTC(2028, 1, 29, 3);
  await stripeCheckout(svc, U, 'svy', 'evy1', {payment_intent: 'pi_y1', subscription: 'sub_y1'});
  assert.equal((await ent(svc, U, 'sv')).expiresAt, Date.UTC(2029, 1, 28, 3));
});

// ---- 4. Stripe partial refund ----
await test('Stripe partial refund keeps the membership (recorded for review); the full refund then revokes', async () => {
  const svc = make(); await setup(svc);
  const o = await stripeCheckout(svc, U, 'sv1', 'evp1', {payment_intent: 'pi_p1'});
  const before = (await ent(svc, U, 'sv')).expiresAt;
  const r = await stripe(svc, {id: 'evp2', type: 'charge.refunded', data: {object: {id: 'ch_p1', payment_intent: 'pi_p1', amount: 3000, amount_refunded: 1, currency: 'jpy', metadata: {}}}});
  assert.equal(r.out[0].status, 'partial_refund_recorded');
  let e = await ent(svc, U, 'sv');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, before);
  assert.equal((await order(svc, o)).state, 'paid');
  assert.ok((await svc.store.list('audit:')).some(a => a.kind === 'partial_refund_needs_review'));
  await stripe(svc, {id: 'evp3', type: 'charge.refunded', data: {object: {id: 'ch_p1', payment_intent: 'pi_p1', amount: 3000, amount_refunded: 3000, currency: 'jpy', metadata: {}}}});
  e = await ent(svc, U, 'sv');
  assert.equal(e.state, 'revoked');
  assert.equal((await order(svc, o)).state, 'refunded');
});

// ---- 5. Stripe subscription recorded with an invoice id ----
await test('Stripe subscription paid via invoice (no payment_intent): a refund naming the PaymentIntent/charge finds the order', async () => {
  const svc = make(); await setup(svc);
  invoices.in_s1 = {id: 'in_s1', payment_intent: null, payments: {data: [{payment: {type: 'payment_intent', payment_intent: 'pi_s1'}}]}};
  const o = await stripeCheckout(svc, U2, 'svm', 'evs1', {payment_intent: null, invoice: 'in_s1', subscription: 'sub_s1'});
  assert.equal((await ent(svc, U2, 'sv')).state, 'active');
  const r = await stripe(svc, {id: 'evs2', type: 'charge.refunded', data: {object: {id: 'ch_s1', payment_intent: 'pi_s1', amount: 1000, amount_refunded: 1000, currency: 'jpy', metadata: {}}}});
  assert.notEqual(r.out[0].status, 'unknown_order');
  assert.equal((await ent(svc, U2, 'sv')).state, 'revoked');
  assert.equal((await order(svc, o)).state, 'paid', 'the subscription itself stays renewable');
});

await test('Stripe renewal invoice without payment_intent: its charge refund finds the renewal grant', async () => {
  const svc = make(); await setup(svc);
  clock = Date.UTC(2027, 4, 1);
  const o = await stripeCheckout(svc, U, 'svm', 'evr1', {payment_intent: 'pi_r1', subscription: 'sub_r1'});
  clock = Date.UTC(2027, 5, 1) - 1000;
  invoices.in_r2 = {id: 'in_r2', charge: 'ch_r2'};
  await stripe(svc, {id: 'evr2', type: 'invoice.paid', data: {object: {id: 'in_r2', billing_reason: 'subscription_cycle', amount_paid: 1000, currency: 'jpy', subscription: 'sub_r1', payment_intent: null,
    lines: {data: [{period: {end: Date.UTC(2027, 6, 1) / 1000}}]}, metadata: {}}}});
  assert.equal((await ent(svc, U, 'sv')).expiresAt, Date.UTC(2027, 6, 1));
  clock = Date.UTC(2027, 5, 2);
  const r = await stripe(svc, {id: 'evr3', type: 'charge.refunded', data: {object: {id: 'ch_r2', payment_intent: null, amount: 1000, amount_refunded: 1000, currency: 'jpy', metadata: {}}}});
  assert.equal(r.out[0].status, 'revoked', 'the renewed month is taken back');
  assert.equal((await order(svc, o)).state, 'paid');
});

// ---- 6. renewal-failure grace ----
await test('a failed unpaid checkout does not start grace on an existing one-off membership', async () => {
  const svc = make(); await setup(svc);
  const t0 = clock;
  await stripeCheckout(svc, U, 'sv1', 'evf1', {payment_intent: 'pi_f1'});
  const r = await svc.checkout({userId: U, chatId: U, skuId: 'svm', provider: 'stripe'}); // second checkout, never paid
  clock = t0 + 30 * DAY - 1000;
  const out = await svc.applyEvent({id: 'f-unpaid', provider: 'stripe', type: 'failed', orderId: r.orderId, occurredAt: sec()});
  assert.equal(out.status, 'ignored');
  const e = await ent(svc, U, 'sv');
  assert.equal(e.state, 'active'); assert.equal(e.graceUntil ?? null, null);
  clock = t0 + 30 * DAY + 1000;
  await svc.cron();
  assert.equal((await ent(svc, U, 'sv')).state, 'expired', 'ends at the paid expiry');
});

await test('repeated renewal failures during grace do not push the grace end further out', async () => {
  const svc = make(); await setup(svc);
  clock = Date.UTC(2027, 4, 1);
  const o = await stripeCheckout(svc, U2, 'svm', 'evg1', {payment_intent: 'pi_g1', subscription: 'sub_g1'});
  clock = Date.UTC(2027, 5, 1);
  await svc.applyEvent({id: 'g-f1', provider: 'stripe', type: 'failed', orderId: o, occurredAt: sec()});
  const g1 = (await ent(svc, U2, 'sv')).graceUntil;
  clock += 2 * DAY;
  await svc.applyEvent({id: 'g-f2', provider: 'stripe', type: 'failed', orderId: o, occurredAt: sec()});
  assert.equal((await ent(svc, U2, 'sv')).graceUntil, g1);
});

// ---- 7. duplicate renewal delivery ----
await test('the same renewal delivered twice extends the period once', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  clock = (t0 + S30) * 1000;
  await starsCharge(svc, U, o, 'k2', t0 + 2 * S30);
  await starsCharge(svc, U, o, 'k2', t0 + 2 * S30);
  assert.equal((await ent(svc, U, 'm')).expiresAt, (t0 + 2 * S30) * 1000);
});

// ---- review round 1 ----
await test('a replayed payment of a refunded subscription charge does not restore access', async () => {
  const svc = make(); await setup(svc);
  const o = await starsSub(svc, U);
  const t0 = sec();
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);
  await svc.store.delete('event:stars:pay:k1');               // as if its dedup marker had not been written
  await starsRefund(svc, U, o, 'k1');
  assert.equal((await ent(svc, U, 'm')).state, 'revoked');
  await starsCharge(svc, U, o, 'k1', t0 + S30, true);        // Telegram redelivers the payment
  assert.equal((await ent(svc, U, 'm')).state, 'revoked');
});

await test('timed purchases banked under permanent access survive later purchases and count when the permanent one is refunded', async () => {
  const svc = make(); await setup(svc);
  await svc.setPlan({id: 'p', title: 'P', goodsKind: 'digital', chats: [G1], skus: [{id: 'p30', amount: 100, currency: 'XTR', days: 30}, {id: 'pperm', amount: 900, currency: 'XTR', days: null}]});
  const buy = async (sku, c) => { const r = await svc.checkout({userId: U2, chatId: U2, skuId: sku, provider: 'telegram_stars'});
    await svc.applyEvent({id: `pay:${c}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: c, occurredAt: sec()}); return r.orderId; };
  const t0 = clock;
  const perm = await buy('pperm', 'q0'); await buy('p30', 'q1'); await buy('p30', 'q2');
  clock = t0 + 31 * DAY;
  await buy('p30', 'q3');
  await svc.applyEvent({id: 'refund:q0', provider: 'telegram_stars', type: 'refunded', orderId: perm, paymentRef: 'q0', occurredAt: sec()});
  const e = await ent(svc, U2, 'p');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, t0 + 90 * DAY);
});

// ---- review round 2 ----
await test('refunding permanent access keeps the remaining days of a timed purchase shifted by an earlier refund', async () => {
  const svc = make(); await setup(svc);
  await svc.setPlan({id: 'p', title: 'P', goodsKind: 'digital', chats: [G1], skus: [{id: 'p30', amount: 100, currency: 'XTR', days: 30}, {id: 'pperm', amount: 900, currency: 'XTR', days: null}]});
  const buy = async (sku, c) => { const r = await svc.checkout({userId: U, chatId: U, skuId: sku, provider: 'telegram_stars'});
    await svc.applyEvent({id: `pay:${c}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: c, occurredAt: sec()}); return r.orderId; };
  const refund = (o, c) => svc.applyEvent({id: `refund:${c}`, provider: 'telegram_stars', type: 'refunded', orderId: o, paymentRef: c, occurredAt: sec()});
  const t0 = clock;
  const o1 = await buy('p30', 'r1'); await buy('p30', 'r2');
  clock = t0 + 20 * DAY; await refund(o1, 'r1');
  assert.equal((await ent(svc, U, 'p')).expiresAt, t0 + 50 * DAY);
  clock = t0 + 21 * DAY; const perm = await buy('pperm', 'r3');
  await refund(perm, 'r3');
  const e = await ent(svc, U, 'p');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, t0 + 50 * DAY);
});

// ---- review round 3 ----
await test('Stripe pre-Basil account: invoice lookup falls back to the unexpanded invoice', async () => {
  const svc = make(); await setup(svc);
  invoices.in_l1 = {id: 'in_l1', legacy: true, payment_intent: 'pi_l1', charge: 'ch_l1'};
  await stripeCheckout(svc, U, 'svm', 'evl1', {payment_intent: null, invoice: 'in_l1', subscription: 'sub_l1'});
  const r = await stripe(svc, {id: 'evl2', type: 'charge.refunded', data: {object: {id: 'ch_l1', payment_intent: null, amount: 1000, amount_refunded: 1000, currency: 'jpy', metadata: {}}}});
  assert.equal(r.out[0].status, 'revoked');
});

await test('a refunded charge is remembered under all its ids: a replay under the invoice id alone does not restore access', async () => {
  const svc = make(); await setup(svc);
  invoices.in_a1 = {id: 'in_a1', payments: {data: [{payment: {type: 'payment_intent', payment_intent: 'pi_a1'}}]}};
  const o = await stripeCheckout(svc, U2, 'svm', 'eva1', {payment_intent: null, invoice: 'in_a1', subscription: 'sub_a1'});
  await stripe(svc, {id: 'eva2', type: 'charge.refunded', data: {object: {id: 'ch_a1', payment_intent: 'pi_a1', amount: 1000, amount_refunded: 1000, currency: 'jpy', metadata: {}}}});
  assert.equal((await ent(svc, U2, 'sv')).state, 'revoked');
  const out = await svc.applyEvent({id: 'eva1-replay', provider: 'stripe', type: 'paid', orderId: o, amount: 1000, currency: 'JPY', paymentRef: 'in_a1', subscriptionRef: 'sub_a1', occurredAt: sec()});
  assert.equal(out.status, 'ignored_after_refund');
  assert.equal((await ent(svc, U2, 'sv')).state, 'revoked');
});

await test('time banked under permanent access keeps its anchor whatever the order of later purchases', async () => {
  const svc = make(); await setup(svc);
  await svc.setPlan({id: 'p', title: 'P', goodsKind: 'digital', chats: [G1], skus: [{id: 'p30', amount: 100, currency: 'XTR', days: 30}, {id: 'pperm', amount: 900, currency: 'XTR', days: null}]});
  const buy = async (sku, c) => { const r = await svc.checkout({userId: U, chatId: U, skuId: sku, provider: 'telegram_stars'});
    await svc.applyEvent({id: `pay:${c}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: c, occurredAt: sec()}); return r.orderId; };
  const t0 = clock;
  await buy('p30', 'b0');
  clock = t0 + DAY; const perm = await buy('pperm', 'b1');
  clock = t0 + 20 * DAY; await buy('p30', 'b2');
  clock = t0 + 40 * DAY; await buy('p30', 'b3');
  await svc.applyEvent({id: 'refund:b1', provider: 'telegram_stars', type: 'refunded', orderId: perm, paymentRef: 'b1', occurredAt: sec()});
  const e = await ent(svc, U, 'p');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, t0 + 90 * DAY);
});

// ---- review round 4 ----
await test('refunding permanent access twice does not count banked time twice', async () => {
  const svc = make(); await setup(svc);
  await svc.setPlan({id: 'p', title: 'P', goodsKind: 'digital', chats: [G1], skus: [{id: 'p30', amount: 100, currency: 'XTR', days: 30}, {id: 'pperm', amount: 900, currency: 'XTR', days: null}]});
  const buy = async (sku, c) => { const r = await svc.checkout({userId: U2, chatId: U2, skuId: sku, provider: 'telegram_stars'});
    await svc.applyEvent({id: `pay:${c}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: c, occurredAt: sec()}); return r.orderId; };
  const refund = (o, c) => svc.applyEvent({id: `refund:${c}`, provider: 'telegram_stars', type: 'refunded', orderId: o, paymentRef: c, occurredAt: sec()});
  const t0 = clock;
  const p1 = await buy('pperm', 'd0'); await buy('p30', 'd1'); await buy('p30', 'd2');
  await refund(p1, 'd0');
  assert.equal((await ent(svc, U2, 'p')).expiresAt, t0 + 60 * DAY);
  await buy('p30', 'd3');
  const p2 = await buy('pperm', 'd4');
  await refund(p2, 'd4');
  assert.equal((await ent(svc, U2, 'p')).expiresAt, t0 + 90 * DAY);
});

await test('a late redelivery of an already applied payment adds nothing after its grant was used up', async () => {
  const svc = make(); await setup(svc);
  const buy = async c => { const r = await svc.checkout({userId: U, chatId: U, skuId: 'm30', provider: 'telegram_stars'});
    await svc.applyEvent({id: `pay:${c}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: c, occurredAt: sec()}); return r.orderId; };
  const t0 = clock;
  const o1 = await buy('e1');
  clock = t0 + 31 * DAY - 2 * DAY; await buy('e2');            // stacks to day 59
  clock = t0 + 40 * DAY; await buy('e3');                      // prunes e1 (used up)
  const before = (await ent(svc, U, 'm')).expiresAt;
  const out = await svc.applyEvent({id: 'pay:e1-again', provider: 'telegram_stars', type: 'paid', orderId: o1, paymentRef: 'e1', occurredAt: sec()});
  assert.equal(out.status, 'already_paid');
  assert.equal((await ent(svc, U, 'm')).expiresAt, before);
});

console.log(JSON.stringify({suite: 'refund-period', passed: failures.length === 0, tests: results.length + failures.length, failed: failures, results}, null, 1));
if (failures.length) process.exit(1);
