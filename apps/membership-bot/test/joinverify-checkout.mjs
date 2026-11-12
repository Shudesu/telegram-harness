// Regression tests for the two OSS "known issues" left after v0.3.1:
//   1. with the join_verify rule off, a verification Mini App the owner approves one by one answered
//      `unknown_request` (the approved send was never linked to its join request);
//   2. a Mini App purchase did not match a checkout rule scoped to the buyer (the chat /plans path did).
// Service-level, in-memory store, mock Telegram; no network, no real charge, approval or message.
import assert from 'node:assert/strict';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const ORIGIN = 'https://bot.example.invalid';
const G1 = -1000000000401;
const U = 70000401, U2 = 70000402;
const DAY = 86400000, MIN = 60000;
const {makeService} = await import('../src/membership/service.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const {signInitData} = await import('../src/membership/verify.mjs');

let clock = Date.UTC(2026, 10, 12);
let api = [];
const fetchMock = async (url, init = {}) => {
  const method = String(url).split('/').pop();
  api.push({method, body: JSON.parse(init.body)});
  return Response.json({ok: true, result: method === 'createInvoiceLink' ? 'https://t.me/$TEST_LINK' : method.startsWith('send') ? {message_id: 1} : true});
};
const env = {BOT_TOKEN: TOKEN};
const make = (store = memoryStore()) => makeService({store, env, fetch: fetchMock, now: () => clock, rng: () => 0, origin: ORIGIN});
const calls = m => api.filter(c => c.method === m).map(c => c.body);
const sec = () => Math.floor(clock / 1000);
const initFor = (user, queryId) => signInitData({auth_date: String(sec()), user: JSON.stringify({id: user, first_name: 'T'}), chat_join_request_query_id: queryId}, TOKEN);

async function plan(svc) {
  await svc.setPlan({id: 'm', title: 'M', goodsKind: 'digital', chats: [G1], skus: [{id: 'm30', amount: 100, currency: 'XTR', days: 30}]});
}
async function member(svc, user) {
  const r = await svc.checkout({userId: user, chatId: user, skuId: 'm30', provider: 'telegram_stars'});
  assert.equal(r.status, 'created');
  await svc.applyEvent({id: `pay:${user}`, provider: 'telegram_stars', type: 'paid', orderId: r.orderId, paymentRef: `ch-${user}`, occurredAt: sec()});
}
const joinRequest = (svc, user, queryId) => svc.handleUpdate({chat_join_request: {chat: {id: G1, type: 'supergroup', title: 'G'}, from: {id: user}, user_chat_id: user, date: sec(), query_id: queryId}});
const pendingOf = async (svc, method) => (await svc.gate.listApprovals('pending')).filter(a => a.method === method);

const results = [], failures = [];
async function test(name, fn) {
  try { api = []; clock = Date.UTC(2026, 10, 12); await fn(); results.push(name); }
  catch (err) { failures.push(name); console.error(`FAIL: ${name}\n  ${String(err?.message ?? err).split('\n').slice(0, 6).join('\n  ')}`); }
}

// ---- 1. join_verify off: the owner approves the verification Mini App by hand ----
async function joinVerifyOff() {
  const svc = make(); await plan(svc);
  for (const p of ['checkout', 'join_approve_paid', 'join_decline', 'member_notice']) await svc.gate.addRule(p); // no join_verify
  await member(svc, U);
  api = [];
  const out = await joinRequest(svc, U, 'jrq-a1');
  assert.equal(out.mode, 'webapp_pending');
  assert.deepEqual(calls('sendChatJoinRequestWebApp'), [], 'nothing is shown before the owner approves');
  const [a] = await pendingOf(svc, 'sendChatJoinRequestWebApp');
  assert.ok(a, 'the Mini App is queued for the owner');
  return {svc, a};
}

await test('1a. after the owner approves it, the Mini App recognises the join request and the right answer approves it', async () => {
  const {svc, a} = await joinVerifyOff();
  assert.equal((await svc.gate.decide(a.id, true)).status, 'executed');
  assert.deepEqual(calls('sendChatJoinRequestWebApp'), [{chat_join_request_query_id: 'jrq-a1', web_app_url: `${ORIGIN}/verify`}]);
  const init = await initFor(U, 'jrq-a1');
  const s = await svc.verifyApi('start', {initData: init});
  assert.equal(s.ok, true, `start: ${JSON.stringify(s)}`);
  assert.ok(typeof s.q === 'string' && Array.isArray(s.choices));
  const r = await svc.verifyApi('answer', {initData: init, choice: 1}); // rng 0 → question 0, answer index 1
  assert.deepEqual(r, {ok: true, approved: true});
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [{chat_join_request_query_id: 'jrq-a1', result: 'approve'}]);
});

await test('1b. the verification window starts when the owner approves, not when the request arrived', async () => {
  const {svc, a} = await joinVerifyOff();
  clock += 10 * MIN;                       // the owner looks at the queue ten minutes later
  await svc.cron();
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [], 'not declined while it waits for the owner');
  assert.equal((await svc.gate.decide(a.id, true)).status, 'executed');
  clock += 2 * MIN;                        // the buyer answers within the 3 minutes after it was shown
  const init = await initFor(U, 'jrq-a1');
  assert.equal((await svc.verifyApi('start', {initData: init})).ok, true);
  assert.deepEqual(await svc.verifyApi('answer', {initData: init, choice: 1}), {ok: true, approved: true});
});

await test('1c. once shown, the normal 3-minute limit applies; a wrong answer declines', async () => {
  const {svc, a} = await joinVerifyOff();
  await svc.gate.decide(a.id, true);
  const init = await initFor(U, 'jrq-a1');
  assert.equal((await svc.verifyApi('start', {initData: init})).ok, true);
  assert.deepEqual(await svc.verifyApi('answer', {initData: init, choice: 0}), {ok: true, approved: false});
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [{chat_join_request_query_id: 'jrq-a1', result: 'decline'}]);
  const {svc: svc2, a: a2} = await joinVerifyOff();
  await svc2.gate.decide(a2.id, true);
  clock += 4 * MIN; api = [];
  assert.equal((await svc2.verifyApi('start', {initData: await initFor(U, 'jrq-a1')})).error, 'closed');
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [{chat_join_request_query_id: 'jrq-a1', result: 'decline'}]);
});

await test('1d. another user cannot use the approved Mini App; a request still waiting for the owner is not open', async () => {
  const {svc, a} = await joinVerifyOff();
  assert.equal((await svc.verifyApi('start', {initData: await initFor(U, 'jrq-a1')})).ok, false, 'not open before approval');
  await svc.gate.decide(a.id, true);
  assert.equal((await svc.verifyApi('start', {initData: await initFor(U2, 'jrq-a1')})).error, 'unknown_request');
});

await test('1e. an approval that arrives after the join request was already decided is skipped as stale', async () => {
  const {svc, a} = await joinVerifyOff();
  await svc.store.put(`jr:${G1}:${U}`, {...(await svc.store.get(`jr:${G1}:${U}`)), state: 'declined'});
  api = [];
  assert.equal((await svc.gate.decide(a.id, true)).status, 'stale');
  assert.deepEqual(calls('sendChatJoinRequestWebApp'), []);
  assert.equal(await svc.store.get('jrq:jrq-a1'), undefined);
});

await test('1f. a request the owner never approves is still declined in the end (no join request waits forever)', async () => {
  const {svc} = await joinVerifyOff();
  clock += 2 * DAY;
  await svc.cron();
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [{chat_join_request_query_id: 'jrq-a1', result: 'decline'}]);
});

await test('1f2. when the owner rejects the queued Mini App, the join request is declined at the next cron', async () => {
  const {svc, a} = await joinVerifyOff();
  assert.equal((await svc.gate.decide(a.id, false)).status, 'rejected');
  assert.deepEqual(calls('sendChatJoinRequestWebApp'), []);
  assert.equal(await svc.store.get('jrq:jrq-a1'), undefined);
  clock += 1000;
  await svc.cron();
  assert.deepEqual(calls('answerChatJoinRequestQuery'), [{chat_join_request_query_id: 'jrq-a1', result: 'decline'}]);
});

await test('1g. with join_verify on, the Mini App still runs immediately (unchanged)', async () => {
  const svc = make(); await plan(svc);
  for (const p of ['checkout', 'join_verify', 'join_approve_paid', 'join_decline', 'member_notice']) await svc.gate.addRule(p);
  await member(svc, U);
  assert.equal((await joinRequest(svc, U, 'jrq-b1')).mode, 'webapp');
  const init = await initFor(U, 'jrq-b1');
  assert.equal((await svc.verifyApi('start', {initData: init})).ok, true);
  assert.deepEqual(await svc.verifyApi('answer', {initData: init, choice: 1}), {ok: true, approved: true});
});

// ---- 2. the Mini App purchase and the chat /plans purchase match the same checkout rule ----
// The same arguments src/membership/http.mjs passes for op 'app_checkout'.
const appCheckout = (svc, user, skuId) => svc.checkout({userId: user, chatId: null, deliverTo: user, silent: true, skuId, provider: 'telegram_stars'});

await test('2a. a checkout rule scoped to the buyer covers the Mini App purchase just like /plans', async () => {
  const svc = make(); await plan(svc);
  await svc.gate.addRule('checkout', {chats: [U]});
  const chat = await svc.checkout({userId: U, chatId: U, skuId: 'm30', provider: 'telegram_stars'});
  assert.equal(chat.status, 'created', '/plans path');
  api = [];
  const app = await appCheckout(svc, U, 'm30');
  assert.equal(app.status, 'created', `Mini App path: ${JSON.stringify(app)}`);
  assert.equal(app.result.url, 'https://t.me/$TEST_LINK');
  assert.equal(calls('createInvoiceLink').length, 1, 'the Mini App gets an invoice link');
  assert.deepEqual(calls('sendInvoice'), [], 'no invoice message is sent to the chat');
  assert.deepEqual(calls('sendMessage'), [], 'silent: the page opens the link itself');
  assert.equal((await svc.gate.listApprovals('pending')).length, 0);
  // pre-checkout of that order is covered by the same rule
  const o = await svc.store.get(`order:${app.orderId}`);
  assert.equal(await svc.preCheckout({id: 'pcq1', from: {id: U}, currency: 'XTR', total_amount: 100, invoice_payload: `o:${o.id}`}), 'executed');
});

await test('2b. the rule stays scoped: another buyer is still queued for the owner on both paths', async () => {
  const svc = make(); await plan(svc);
  await svc.gate.addRule('checkout', {chats: [U]});
  assert.equal((await svc.checkout({userId: U2, chatId: U2, skuId: 'm30', provider: 'telegram_stars'})).status, 'pending_approval');
  assert.equal((await appCheckout(svc, U2, 'm30')).status, 'pending_approval');
  assert.deepEqual(calls('createInvoiceLink'), []);
  assert.deepEqual(calls('sendInvoice'), []);
});

await test('2c. an unscoped checkout rule still covers the Mini App (unchanged)', async () => {
  const svc = make(); await plan(svc);
  await svc.gate.addRule('checkout');
  const app = await appCheckout(svc, U2, 'm30');
  assert.equal(app.status, 'created');
  assert.equal(calls('createInvoiceLink').length, 1);
});

console.log(JSON.stringify({suite: 'joinverify-checkout', passed: failures.length === 0, tests: results.length + failures.length, failed: failures, results}, null, 1));
if (failures.length) process.exit(1);
