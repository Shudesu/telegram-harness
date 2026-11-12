// Regression tests for the review findings on the membership lifecycle (Codex review rounds).
// Service-level, in-memory store, mock Telegram/Stripe; no network.
import assert from 'node:assert/strict';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const STRIPE_WH = 'stripe-webhook-NOT-REAL';
const G1 = -1000000000101, G2 = -1000000000102;
const U = 70000201, U2 = 70000202;
const DAY = 86400000;
const {makeService} = await import('../src/membership/service.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const {hmacHex} = await import('../src/membership/providers/contract.mjs');
const worker = (await import('../src/index.mjs')).default;
const {ChatSession} = await import('../src/chat.mjs');

let clock = Date.UTC(2026, 10, 12);
let api = [], fail = {}, stripeCalls = [];
const fetchMock = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    stripeCalls.push({url: u, method: init.method, body: String(init.body ?? '')});
    if (u.includes('/invoices/')) return Response.json({id: 'in_mock', payment_intent: 'pi_from_invoice'});
    return Response.json({id: 're_mock', status: 'succeeded'});
  }
  const method = u.split('/').pop();
  const body = JSON.parse(init.body);
  api.push({method, body});
  if (fail[method]) { const code = fail[method]; delete fail[method]; return Response.json({ok: false, error_code: code}, {status: code}); }
  return Response.json({ok: true, result: method === 'createInvoiceLink' ? 'https://t.me/$TEST_LINK' : method.startsWith('send') ? {message_id: 1} : true});
};
const env = {BOT_TOKEN: TOKEN, STRIPE_SECRET_KEY: 'stripe-secret-NOT-REAL', STRIPE_WEBHOOK_SECRET: STRIPE_WH};
const calls = m => api.filter(c => c.method === m);
const make = (store = memoryStore()) => makeService({store, env, fetch: fetchMock, now: () => clock, rng: () => 0});
const ALL = ['checkout', 'join_verify', 'join_approve_paid', 'join_decline', 'expire_remove', 'member_notice'];
async function setup(svc, presets = ALL) {
  await svc.setPlan({id: 'a', title: 'A', goodsKind: 'digital', chats: [G1, G2], skus: [{id: 'a30', amount: 100, currency: 'XTR', days: 30}]});
  await svc.setPlan({id: 'b', title: 'B', goodsKind: 'digital', chats: [G1], skus: [{id: 'bperm', amount: 900, currency: 'XTR', days: null}]});
  await svc.setPlan({id: 'svc', title: 'S', goodsKind: 'physical_service', chats: [], skus: [{id: 's1', amount: 3000, currency: 'JPY', days: 30, providers: ['stripe']}]});
  for (const p of presets) await svc.gate.addRule(p);
}
async function buy(svc, user, sku, charge) {
  const r = await svc.checkout({userId: user, chatId: user, skuId: sku, provider: 'telegram_stars'});
  await svc.handleUpdate({message: {from: {id: user}, chat: {id: user, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: (await svc.store.get(`order:${r.orderId}`)).amount, invoice_payload: `o:${r.orderId}`, telegram_payment_charge_id: charge, provider_payment_charge_id: ''}}});
  return r.orderId;
}
const ent = (svc, u, p) => svc.store.get(`ent:${u}:${p}`);

const results = [];
let pass = 0;
async function test(name, fn) {
  try { api = []; await fn(); pass++; results.push(name); }
  catch (err) { console.error(`FAIL: ${name}\n`, err); process.exit(1); }
}

await test('removal approved by the owner later runs ban with a fresh until_date and then unban', async () => {
  const svc = make();
  await setup(svc, ALL.filter(p => p !== 'expire_remove'));
  await buy(svc, U, 'a30', 'c1');
  clock += 31 * DAY;
  api = [];
  await svc.cron();
  assert.equal(calls('banChatMember').length, 0);
  const queued = (await svc.gate.listApprovals()).filter(a => a.method === 'banChatMember');
  assert.equal(queued.length, 2);
  clock += 5 * DAY; // the owner approves days later
  for (const a of queued) await svc.gate.decide(a.id, true);
  const bans = calls('banChatMember');
  assert.equal(bans.length, 2);
  for (const b of bans) assert.ok(b.body.until_date > Math.floor(clock / 1000) + 30, 'until_date is fresh, not in the past');
  assert.deepEqual(calls('unbanChatMember').map(c => c.body.only_if_banned), [true, true]);
  assert.deepEqual((await ent(svc, U, 'a')).removal.pendingApproval, []);
});

await test('a chat still covered by another live plan is not removed when one plan expires', async () => {
  const svc = make();
  await setup(svc);
  await buy(svc, U, 'a30', 'c2');
  await buy(svc, U, 'bperm', 'c3');
  clock += 31 * DAY;
  api = [];
  await svc.cron();
  assert.deepEqual(calls('banChatMember').map(c => c.body.chat_id), [G2]); // G1 stays: plan b is permanent
});

await test('order terms are frozen: deleting or editing the SKU after checkout still grants what was bought', async () => {
  const svc = make();
  await setup(svc);
  const r = await svc.checkout({userId: U2, chatId: U2, skuId: 'a30', provider: 'telegram_stars'});
  await svc.setPlan({id: 'a', title: 'A2', goodsKind: 'digital', chats: [G2], skus: [{id: 'a7', amount: 100, currency: 'XTR', days: 7}]});
  await svc.handleUpdate({message: {from: {id: U2}, chat: {id: U2, type: 'private'}, date: 1,
    successful_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${r.orderId}`, telegram_payment_charge_id: 'c4', provider_payment_charge_id: ''}}});
  const e = await ent(svc, U2, 'a');
  assert.equal(e.expiresAt, clock + 30 * DAY); assert.deepEqual(e.chats, [G1, G2]);
});

await test('stacked purchases: refunding the first takes back only its 30 days; refunding the last one revokes', async () => {
  const svc = make();
  await setup(svc);
  const o1 = await buy(svc, U, 'a30', 'c5');
  const o2 = await buy(svc, U, 'a30', 'c6');
  assert.equal((await ent(svc, U, 'a')).expiresAt, clock + 60 * DAY);
  await svc.handleUpdate({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: 2, refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${o1}`, telegram_payment_charge_id: 'c5'}}});
  const e = await ent(svc, U, 'a');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, clock + 30 * DAY);
  api = [];
  await svc.handleUpdate({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: 3, refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${o2}`, telegram_payment_charge_id: 'c6'}}});
  assert.equal((await ent(svc, U, 'a')).state, 'revoked');
  assert.equal(calls('banChatMember').length, 2);
});

await test('entitlement is re-checked at decision time: refunded during verification → declined', async () => {
  const svc = make();
  await setup(svc);
  const o = await buy(svc, U, 'a30', 'c7');
  await svc.handleUpdate({chat_join_request: {chat: {id: G1}, from: {id: U}, user_chat_id: U, date: 1}});
  await svc.handleUpdate({callback_query: {id: 'x1', from: {id: U}, data: `jv/${G1}/b`}});
  await svc.handleUpdate({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: 4, refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${o}`, telegram_payment_charge_id: 'c7'}}});
  api = [];
  await svc.handleUpdate({callback_query: {id: 'x2', from: {id: U}, data: `jv/${G1}/q/1`}}); // rng()=0 → question 0, answer 1
  assert.equal(calls('approveChatJoinRequest').length, 0);
  assert.equal(calls('declineChatJoinRequest').length, 1);
});

await test('a join decision Telegram rejects stays retryable and the cron retries it', async () => {
  const svc = make();
  await setup(svc);
  await buy(svc, U2, 'a30', 'c8');
  await svc.handleUpdate({chat_join_request: {chat: {id: G1}, from: {id: U2}, user_chat_id: U2, date: 1}});
  await svc.handleUpdate({callback_query: {id: 'y1', from: {id: U2}, data: `jv/${G1}/b`}});
  fail.approveChatJoinRequest = 500;
  await svc.handleUpdate({callback_query: {id: 'y2', from: {id: U2}, data: `jv/${G1}/q/1`}});
  assert.equal((await svc.store.get(`jr:${G1}:${U2}`)).state, 'decision_failed');
  await svc.cron();
  assert.equal((await svc.store.get(`jr:${G1}:${U2}`)).state, 'approved');
  assert.equal(calls('approveChatJoinRequest').length, 2);
});

await test('checkout queued for approval resumes on approval: order becomes payable and the invoice link is delivered', async () => {
  const svc = make();
  await setup(svc, []);
  await svc.setPlan({id: 'm', title: 'M', goodsKind: 'digital', chats: [G1], skus: [{id: 'msub', amount: 300, currency: 'XTR', days: 30, recurring: true}]});
  const r = await svc.checkout({userId: U, chatId: U, skuId: 'msub', provider: 'telegram_stars'});
  assert.equal(r.status, 'pending_approval');
  await svc.gate.addRule('checkout');
  const a = (await svc.gate.listApprovals()).find(x => x.method === 'createInvoiceLink');
  await svc.gate.decide(a.id, true);
  assert.equal((await svc.store.get(`order:${r.orderId}`)).state, 'awaiting_payment');
  assert.equal(calls('sendMessage').at(-1).body.reply_markup.inline_keyboard[0][0].url, 'https://t.me/$TEST_LINK');
});

await test('a recurring external SKU uses its own interval (7 days → weekly Stripe subscription)', async () => {
  const svc = make();
  await setup(svc);
  await svc.setPlan({id: 'w', title: 'W', goodsKind: 'physical_service', chats: [], skus: [{id: 'w7', amount: 1000, currency: 'JPY', days: 7, recurring: true, providers: ['stripe']}]});
  stripeCalls = [];
  await svc.checkout({userId: U, chatId: U, skuId: 'w7', provider: 'stripe'});
  assert.match(decodeURIComponent(stripeCalls[0].body), /recurring\]\[interval\]=week/);
});

await test('Stripe: dispute without metadata is matched through the payment ref; invoice refs are resolved before refunding', async () => {
  const svc = make();
  await setup(svc);
  const r = await svc.checkout({userId: U2, chatId: U2, skuId: 's1', provider: 'stripe'});
  const sign = async raw => { const t = Math.floor(clock / 1000); return new Request('https://x.invalid/', {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${await hmacHex(STRIPE_WH, `${t}.${raw}`)}`}, body: raw}); };
  const paid = JSON.stringify({id: 'evt_p', type: 'checkout.session.completed', created: Math.floor(clock / 1000), data: {object: {client_reference_id: r.orderId, payment_status: 'paid', amount_total: 3000, currency: 'jpy', payment_intent: 'pi_one', metadata: {order_id: r.orderId}}}});
  assert.equal((await svc.payWebhook('stripe', await sign(paid))).out[0].status, 'granted');
  stripeCalls = [];
  const {provider: stripe} = await import('../src/membership/providers/stripe.mjs');
  await stripe.refund({paymentRef: 'in_mock', idempotencyKey: 'k'}, {env, fetch: fetchMock});
  assert.ok(stripeCalls[0].url.includes('/invoices/in_mock'));
  assert.match(stripeCalls[1].body, /payment_intent=pi_from_invoice/);
  const dispute = JSON.stringify({id: 'evt_d', type: 'charge.dispute.created', created: Math.floor(clock / 1000), data: {object: {id: 'dp_1', amount: 3000, charge: 'ch_x', payment_intent: 'pi_one', metadata: {}}}});
  assert.equal((await svc.payWebhook('stripe', await sign(dispute))).out[0].status, 'revoked');
  assert.equal((await ent(svc, U2, 'svc')).state, 'revoked');
});

await test('a payment the membership object fails to process gets a 503, and the redelivery grants exactly once', async () => {
  const stores = new Map();
  const ns = {getByName(name) {
    if (!stores.has(name)) {
      const m = new Map();
      let failNextPut = 0;
      const ctx = {id: {name}, blockConcurrencyWhile: fn => fn(), storage: {
        async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
        async put(k, v) { if (k.startsWith('ent:') && failNextPut > 0) { failNextPut--; throw Error('storage_down'); } m.set(k, structuredClone(v)); },
        async delete(k) { return m.delete(k); },
        async list({prefix = ''} = {}) { return new Map([...m.keys()].filter(k => k.startsWith(prefix)).sort().map(k => [k, structuredClone(m.get(k))])); },
      }};
      stores.set(name, {m, obj: new ChatSession(ctx, wenv), arm: n => { failNextPut = n; }});
    }
    const s = stores.get(name);
    return new Proxy({}, {get: (_, p) => p === '_arm' ? s.arm : p === '_m' ? s.m : (...a) => s.obj[p](...a)});
  }};
  const wenv = {...env, WEBHOOK_SECRET: 'test-webhook-secret-value', MEMBERSHIP: '1', ADMIN_TOKEN: 'adm-NOT-REAL', CHAT: ns, SEED_FILE_IDS: '{}', SEED_OPTINS: '{}'};
  const realFetch = globalThis.fetch; globalThis.fetch = fetchMock;
  const realNow = Date.now; Date.now = () => clock;
  const realLog = console.log; console.log = () => {};
  try {
    const ctx = {waitUntil() {}};
    const adm = (op, body) => worker.fetch(new Request(`https://w.invalid/admin/membership/${op}`, {method: 'POST', headers: {authorization: 'Bearer adm-NOT-REAL'}, body: JSON.stringify(body)}), wenv, ctx);
    await adm('plan_set', {plan: {id: 'a', title: 'A', goodsKind: 'digital', chats: [G1], skus: [{id: 'a30', amount: 100, currency: 'XTR', days: 30}]}});
    for (const p of ALL) await adm('rule_add', {preset: p});
    const hook = u => worker.fetch(new Request('https://w.invalid/webhook', {method: 'POST', headers: {'x-telegram-bot-api-secret-token': 'test-webhook-secret-value'}, body: JSON.stringify(u)}), wenv, ctx);
    api = [];
    await hook({update_id: 1, callback_query: {id: 'q', from: {id: U}, message: {chat: {id: U, type: 'private'}}, data: 'pay/a30/telegram_stars'}});
    const payload = calls('sendInvoice')[0].body.payload;
    const pay = {update_id: 2, message: {from: {id: U}, chat: {id: U, type: 'private'}, date: 1, successful_payment: {currency: 'XTR', total_amount: 100, invoice_payload: payload, telegram_payment_charge_id: 'cz', provider_payment_charge_id: ''}}};
    ns.getByName('membership:main')._arm(1);
    assert.equal((await hook(pay)).status, 503);
    assert.equal(ns.getByName('membership:main')._m.get(`ent:${U}:a`), undefined);
    assert.equal((await hook(pay)).status, 200);
    assert.equal(ns.getByName('membership:main')._m.get(`ent:${U}:a`).state, 'active');
    assert.equal((await hook(pay)).status, 200);
    assert.equal(Object.keys(ns.getByName('membership:main')._m.get(`ent:${U}:a`).grants).length, 1);
  } finally { globalThis.fetch = realFetch; Date.now = realNow; console.log = realLog; }
});

await test('round 2: a queued ban is skipped if the member repurchased; a queued approval is skipped if refunded meanwhile', async () => {
  const svc = make();
  await setup(svc, ALL.filter(p => p !== 'expire_remove' && p !== 'join_approve_paid'));
  await buy(svc, U, 'a30', 'r1');
  clock += 31 * DAY;
  await svc.cron();
  await buy(svc, U, 'a30', 'r2');
  api = [];
  for (const a of (await svc.gate.listApprovals()).filter(a => a.method === 'banChatMember')) assert.equal((await svc.gate.decide(a.id, true)).status, 'stale');
  assert.equal(calls('banChatMember').length, 0);
  const o = (await svc.store.list('order:')).filter(x => x.userId === U).at(-1);
  await svc.handleUpdate({chat_join_request: {chat: {id: G1}, from: {id: U}, user_chat_id: U, date: 1}});
  await svc.handleUpdate({callback_query: {id: 'z1', from: {id: U}, data: `jv/${G1}/b`}});
  await svc.handleUpdate({callback_query: {id: 'z2', from: {id: U}, data: `jv/${G1}/q/1`}});
  const ap = (await svc.gate.listApprovals()).find(a => a.method === 'approveChatJoinRequest');
  assert.ok(ap);
  await svc.handleUpdate({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: 9, refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${o.id}`, telegram_payment_charge_id: 'r2'}}});
  api = [];
  assert.equal((await svc.gate.decide(ap.id, true)).status, 'stale');
  assert.equal(calls('approveChatJoinRequest').length, 0);
});

await test('round 2: refunding the permanent purchase leaves the timed one with its own 30 days; an expired grant cannot shorten a new term', async () => {
  const svc = make();
  await setup(svc);
  await svc.setPlan({id: 'b', title: 'B', goodsKind: 'digital', chats: [G1], skus: [{id: 'bperm', amount: 900, currency: 'XTR', days: null}, {id: 'b30', amount: 100, currency: 'XTR', days: 30}]});
  const start = clock;
  const p = await buy(svc, U2, 'bperm', 'p1');
  await buy(svc, U2, 'b30', 'p2');
  assert.equal((await ent(svc, U2, 'b')).expiresAt, null);
  await svc.handleUpdate({message: {from: {id: U2}, chat: {id: U2, type: 'private'}, date: 9, refunded_payment: {currency: 'XTR', total_amount: 900, invoice_payload: `o:${p}`, telegram_payment_charge_id: 'p1'}}});
  assert.equal((await ent(svc, U2, 'b')).expiresAt, start + 30 * DAY);
  // Let it expire, buy again, then refund the old (consumed) purchase: the new term is untouched.
  clock = start + 31 * DAY;
  await svc.cron();
  const old = (await svc.store.list('order:')).find(x => x.userId === U2 && x.skuId === 'b30');
  await buy(svc, U2, 'b30', 'p3');
  const fresh = (await ent(svc, U2, 'b')).expiresAt;
  await svc.handleUpdate({message: {from: {id: U2}, chat: {id: U2, type: 'private'}, date: 10, refunded_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${old.id}`, telegram_payment_charge_id: 'p2'}}});
  assert.equal((await ent(svc, U2, 'b')).expiresAt, fresh);
  assert.equal((await ent(svc, U2, 'b')).state, 'active');
});

await test('round 2: duplicate SKU ids are rejected; pre-checkout matches a chat-scoped checkout rule', async () => {
  const svc = make();
  await setup(svc, []);
  await assert.rejects(svc.setPlan({id: 'z', title: 'Z', goodsKind: 'digital', chats: [], skus: [{id: 'a30', amount: 1, currency: 'XTR', days: 1}]}), /duplicate_sku_id/);
  await svc.gate.addRule('checkout', {chats: [U]});
  const r = await svc.checkout({userId: U, chatId: U, skuId: 'a30', provider: 'telegram_stars'});
  api = [];
  assert.equal(await svc.preCheckout({id: 'pc', from: {id: U}, currency: 'XTR', total_amount: 100, invoice_payload: `o:${r.orderId}`}), 'executed');
});

await test('round 2: a late "expired" for an already-expired unpaid order does not end a paid membership', async () => {
  const svc = make();
  await setup(svc);
  await buy(svc, U, 'a30', 'e1');
  const stale = await svc.checkout({userId: U, chatId: U, skuId: 'a30', provider: 'telegram_stars'});
  clock += 4 * DAY;
  await svc.cron();
  assert.equal((await svc.store.get(`order:${stale.orderId}`)).state, 'expired_order');
  await svc.applyEvent({id: 'late-exp', provider: 'komoju', type: 'expired', tenantId: 'main', telegramUserId: U, orderId: stale.orderId, occurredAt: 1});
  assert.equal((await ent(svc, U, 'a')).state, 'active');
});

await test('round 3: a renewal failure right at the boundary starts grace; the cron waits for renewal instead of removing', async () => {
  const svc = make();
  await setup(svc);
  await svc.setPlan({id: 'm', title: 'M', goodsKind: 'digital', chats: [G1], skus: [{id: 'msub', amount: 300, currency: 'XTR', days: 30, recurring: true}]});
  const r = await svc.checkout({userId: U, chatId: U, skuId: 'msub', provider: 'telegram_stars'});
  const t0 = Math.floor(clock / 1000);
  await svc.handleUpdate({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: t0, successful_payment: {currency: 'XTR', total_amount: 300, invoice_payload: `o:${r.orderId}`, telegram_payment_charge_id: 's1', provider_payment_charge_id: '', is_recurring: true, is_first_recurring: true, subscription_expiration_date: t0 + 2592000}}});
  clock = (t0 + 2592000) * 1000 + 1000;
  api = [];
  await svc.cron();
  assert.equal((await ent(svc, U, 'm')).state, 'grace'); assert.equal(calls('banChatMember').length, 0);
  await svc.handleUpdate({update_id: 77, subscription: {user: {id: U}, invoice_payload: `o:${r.orderId}`, state: 'failed'}});
  assert.equal((await ent(svc, U, 'm')).state, 'grace');
  clock += 4 * DAY;
  await svc.cron();
  assert.equal((await ent(svc, U, 'm')).state, 'expired');
});

await test('round 3: a subscription ending keeps a permanent purchase on the same plan; external monthly uses the calendar month', async () => {
  const svc = make();
  await setup(svc);
  await svc.setPlan({id: 'sv', title: 'SV', goodsKind: 'physical_service', chats: [G2], skus: [{id: 'svm', amount: 1000, currency: 'JPY', days: 30, recurring: true, providers: ['stripe']}, {id: 'svp', amount: 9000, currency: 'JPY', days: null, providers: ['stripe']}]});
  clock = Date.UTC(2026, 6, 1);
  const sign = async raw => { const t = Math.floor(clock / 1000); return new Request('https://x.invalid/', {method: 'POST', headers: {'stripe-signature': `t=${t},v1=${await hmacHex(STRIPE_WH, `${t}.${raw}`)}`}, body: raw}); };
  const paid = async (sku, evt, sub) => { const r = await svc.checkout({userId: U2, chatId: U2, skuId: sku, provider: 'stripe'});
    await svc.payWebhook('stripe', await sign(JSON.stringify({id: evt, type: 'checkout.session.completed', created: Math.floor(clock / 1000), data: {object: {client_reference_id: r.orderId, payment_status: 'paid', amount_total: (await svc.store.get(`order:${r.orderId}`)).amount, currency: 'jpy', payment_intent: `pi_${evt}`, subscription: sub, metadata: {order_id: r.orderId}}}})));
    return r.orderId; };
  const o = await paid('svm', 'e1', 'sub_1');
  assert.equal((await ent(svc, U2, 'sv')).expiresAt, Date.UTC(2026, 7, 1));
  await paid('svp', 'e2', undefined);
  await svc.payWebhook('stripe', await sign(JSON.stringify({id: 'e3', type: 'customer.subscription.deleted', created: Math.floor(clock / 1000), data: {object: {id: 'sub_1', metadata: {order_id: o}}}})));
  const e = await ent(svc, U2, 'sv');
  assert.equal(e.state, 'active'); assert.equal(e.expiresAt, null);
});

await test('round 3: re-applying a renewal after a partial failure does not rewrite its grant', async () => {
  const svc = make();
  await setup(svc);
  await svc.setPlan({id: 'm', title: 'M', goodsKind: 'digital', chats: [G1], skus: [{id: 'msub', amount: 300, currency: 'XTR', days: 30, recurring: true}]});
  const r = await svc.checkout({userId: U, chatId: U, skuId: 'msub', provider: 'telegram_stars'});
  const t0 = Math.floor(clock / 1000);
  const sp = (c, x) => ({message: {from: {id: U}, chat: {id: U, type: 'private'}, date: t0, successful_payment: {currency: 'XTR', total_amount: 300, invoice_payload: `o:${r.orderId}`, telegram_payment_charge_id: c, provider_payment_charge_id: '', is_recurring: true, ...x}}});
  await svc.handleUpdate(sp('k1', {is_first_recurring: true, subscription_expiration_date: t0 + 2592000}));
  await svc.handleUpdate(sp('k2', {subscription_expiration_date: t0 + 2 * 2592000}));
  const before = JSON.stringify((await ent(svc, U, 'm')).grants);
  await svc.store.delete('event:stars:pay:k2'); // as if the dedup marker had not been written
  await svc.handleUpdate(sp('k2', {subscription_expiration_date: t0 + 2 * 2592000}));
  assert.equal(JSON.stringify((await ent(svc, U, 'm')).grants), before);
});

console.log(JSON.stringify({suite: 'membership-review', passed: true, tests: pass, results}, null, 1));
