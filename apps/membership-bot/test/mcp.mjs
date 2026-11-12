// Telegram Harness MCP (POST /mcp): auth, protocol, every tool's input/output, and the safety contract —
// request_* tools only queue (no Bot API write, no rule/plan change) and the MCP key cannot reach the
// admin API. Telegram / Stripe are mock APIs; nothing here reaches the network.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const SECRET = 'test-webhook-secret-value';
const ADMIN = 'test-admin-token-NOT-REAL';
const MCPKEY = 'test-mcp-key-NOT-REAL-0123456789abcdef0123456789';
const STRIPE_KEY = 'stripe-secret-NOT-REAL', STRIPE_WH = 'stripe-webhook-NOT-REAL';
const GROUP = -1000000000001;
const BUYER = 70000101, BUYER2 = 70000103;
const DAY = 86400000;

const {ChatSession} = await import('../src/chat.mjs');
const worker = (await import('../src/index.mjs')).default;
const {TOOL_NAMES, QUEUE_TOOLS} = await import('../src/mcp/server.mjs');

// ---------- clock, mock APIs, log capture ----------
let clock = Date.UTC(2026, 10, 11, 0, 0, 0);
const realNow = Date.now;
Date.now = () => clock;
let api = [], stripeCalls = [], fail = {};
const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    stripeCalls.push({url: u, init});
    if (u.endsWith('/checkout/sessions')) return Response.json({id: 'cs_test_mock1', url: 'https://checkout.stripe.invalid/c/cs_test_mock1'});
    return Response.json({id: 're_mock', status: 'succeeded'});
  }
  if (!u.startsWith(`https://api.telegram.org/bot${TOKEN}/`)) throw Error('unexpected_host');
  const method = u.split('/').pop();
  const body = JSON.parse(init.body);
  api.push({method, body});
  if (fail[method]) { const code = fail[method]; delete fail[method]; return Response.json({ok: false, error_code: code, description: 'stub'}, {status: code}); }
  let result = true;
  if (method === 'createInvoiceLink') result = 'https://t.me/$TEST_INVOICE_LINK';
  else if (method === 'sendMessage' || method === 'sendInvoice') result = {message_id: 9000 + api.length, chat: {id: body.chat_id}};
  return Response.json({ok: true, result});
};

// ---------- Durable Object runtime stub (get/put/delete/list) ----------
function makeCtx(store, name) {
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async delete(k) { return store.delete(k); },
      async list({prefix = ''} = {}) { return new Map([...store.keys()].filter(k => k.startsWith(prefix)).sort().map(k => [k, structuredClone(store.get(k))])); },
    },
    blockConcurrencyWhile(fn) { const p = fn(); ctx._init = p; return p; },
    _init: Promise.resolve(), id: {name},
  };
  return ctx;
}
function makeNamespace(envRef) {
  const stores = new Map(), live = new Map();
  return {
    getByName(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      if (!live.has(name)) { const ctx = makeCtx(stores.get(name), name); live.set(name, {ctx, obj: new ChatSession(ctx, envRef.env)}); }
      const {ctx, obj} = live.get(name);
      return new Proxy({}, {get: (_, prop) => (...args) => ctx._init.then(() => obj[prop](...args))});
    },
    _store: name => stores.get(name),
    _names: () => [...stores.keys()],
  };
}
const ASSET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const envRef = {};
const env = {
  BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, ADMIN_TOKEN: ADMIN, MEMBERSHIP: '1', SEED_FILE_IDS: '{}', SEED_OPTINS: '{}',
  STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: STRIPE_WH,
  ASSETS: {async fetch(url) { const p = path.join(ASSET_DIR, new URL(String(url)).pathname.slice(1)); return fs.existsSync(p) ? new Response(fs.readFileSync(p)) : new Response('nf', {status: 404}); }},
};
envRef.env = env;
env.CHAT = makeNamespace(envRef);
const pending = [];
const ctx = {waitUntil: p => pending.push(p)};
const settle = async () => { while (pending.length) await pending.shift(); };

const ORIGIN = 'https://teleharness-bot.example.invalid';
let uid = 1000;
async function hook(update, e = env) {
  const r = await worker.fetch(new Request(`${ORIGIN}/webhook`, {method: 'POST', headers: {'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json'},
    body: JSON.stringify({update_id: ++uid, ...update})}), e, ctx);
  await settle();
  return r;
}
async function admin(op, body = {}, token = ADMIN) {
  const r = await worker.fetch(new Request(`${ORIGIN}/admin/membership/${op}`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env, ctx);
  return r.status === 200 ? (await r.json()).result : {httpStatus: r.status, ...(await r.json().catch(() => ({})))};
}

env.MCP_API_KEY = MCPKEY;
// Read-only Bot API answers the MCP status tools use.
const baseFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const method = String(url).split('/').pop();
  const READ = {getMe: {id: 1, is_bot: true, username: 'mock_bot', can_join_groups: true},
    getWebhookInfo: {url: 'https://secret.example/webhook', pending_update_count: 0, max_connections: 1, allowed_updates: ['message']},
    getMyCommands: [{command: 'start', description: 'ガイド'}]};
  if (String(url).startsWith(`https://api.telegram.org/bot${TOKEN}/`) && Object.hasOwn(READ, method)) {
    api.push({method, body: JSON.parse(init.body)});
    return Response.json({ok: true, result: READ[method]});
  }
  return baseFetch(url, init);
};
async function rawMcp(body, {token = MCPKEY, method = 'POST', headers = {}, e = env} = {}) {
  const h = {'content-type': 'application/json', ...headers};
  if (token !== null) h.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`${ORIGIN}/mcp`, {method, headers: h, ...(method === 'POST' ? {body: typeof body === 'string' ? body : JSON.stringify(body)} : {})}), e, ctx);
}
let rid = 0;
async function rpc(method, params) {
  const r = await rawMcp({jsonrpc: '2.0', id: ++rid, method, params});
  assert.equal(r.status, 200);
  return r.json();
}
async function call(name, args = {}) {
  const out = await rpc('tools/call', {name, arguments: args});
  if (out.error) return {rpcError: out.error};
  return {isError: out.result.isError, data: out.result.isError ? out.result.content[0].text : JSON.parse(out.result.content[0].text), structured: out.result.structuredContent};
}
const apiWrites = () => api.filter(c => !['getMe', 'getWebhookInfo', 'getMyCommands'].includes(c.method));
const noIds = (label, v) => {
  const s = JSON.stringify(v);
  for (const id of [BUYER, BUYER2, GROUP]) assert.ok(!s.includes(String(id)), `${label} leaks an id`);
};

const results = [];
async function test(name, fn) {
  try { api = []; stripeCalls = []; await fn(); results.push(name); }
  catch (err) { console.log = realLog; console.error(`FAIL: ${name}\n`, err); process.exit(1); }
}

// ---------- fixtures: a Stars subscription plan, the checkout rule, two paid orders, a ticket ----------
const mo = env.CHAT.getByName('membership:main');
async function buy(user, charge) {
  const r = await mo.membership('app_checkout', {userId: user, skuId: 's30'});
  assert.equal(r.status, 'created'); assert.match(r.url, /^https:\/\/t\.me\//);
  const order = [...env.CHAT._store('membership:main').values()].filter(v => v?.id && v.userId === user && v.state === 'awaiting_payment').pop();
  await hook({message: {message_id: 1, from: {id: user, is_bot: false, first_name: 'T'}, chat: {id: user, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 500, invoice_payload: `o:${order.id}`, telegram_payment_charge_id: charge, provider_payment_charge_id: '',
      is_recurring: true, is_first_recurring: true, subscription_expiration_date: Math.floor((clock + 30 * DAY) / 1000)}}});
  return order.id;
}
let ORDER1, ORDER2;
await test('fixtures', async () => {
  const plan = await admin('plan_set', {plan: {id: 'std', title: 'スタンダード', goodsKind: 'digital', chats: [GROUP], skus: [{id: 's30', amount: 500, currency: 'XTR', days: 30, recurring: true}]}});
  assert.equal(plan.id, 'std');
  assert.equal((await admin('rule_add', {preset: 'checkout'})).preset, 'checkout');
  ORDER1 = await buy(BUYER, 'stxMCP1');
  ORDER2 = await buy(BUYER2, 'stxMCP2');
  const orders = await admin('orders');
  assert.equal(orders.filter(o => o.state === 'paid').length, 2);
  assert.equal((await mo.membership('app_ticket', {userId: BUYER, text: '返金について'})).status, 'created');
});

await test('auth: no key 401, wrong key 403, admin token is not an MCP key, foreign Origin 403, GET 405', async () => {
  const init = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18'}};
  let r = await rawMcp(init, {token: null});
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /^Bearer/);
  assert.equal((await rawMcp(init, {token: 'wrong-key-wrong-key-wrong-key-wrong'})).status, 403);
  assert.equal((await rawMcp(init, {token: ADMIN})).status, 403);
  assert.equal((await rawMcp(init, {headers: {origin: 'https://evil.example'}})).status, 403);
  assert.equal((await rawMcp(null, {method: 'GET'})).status, 405);
  assert.equal((await rawMcp(init, {token: 'x', e: {...env, MCP_API_KEY: undefined}})).status, 403);
  assert.equal((await rawMcp(init, {token: MCPKEY, e: {...env, MCP_API_KEY: undefined}})).status, 403);
  assert.equal((await rawMcp(init, {token: 'short', e: {...env, MCP_API_KEY: 'short'}})).status, 403); // a weak key is never accepted
  // The MCP key does not open the owner's admin API (approve / rule_add / plan_set …).
  for (const op of ['approve', 'rule_add', 'plan_set', 'refund', 'approvals']) assert.equal((await admin(op, {}, MCPKEY)).httpStatus, 403);
  assert.equal(apiWrites().length, 0);
});

await test('protocol: initialize, ping, notification 202, batch / parse / unknown method / unknown tool errors', async () => {
  const init = await rpc('initialize', {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 't', version: '0'}});
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'telegram-harness');
  assert.ok(init.result.capabilities.tools);
  assert.equal((await rpc('initialize', {protocolVersion: '1999-01-01'})).result.protocolVersion, '2025-06-18');
  assert.deepEqual((await rpc('ping')).result, {});
  assert.equal((await rawMcp({jsonrpc: '2.0', method: 'notifications/initialized'})).status, 202);
  assert.equal((await rawMcp([{jsonrpc: '2.0', id: 1, method: 'ping'}])).status, 400);
  assert.equal((await rawMcp('{not json')).status, 400);
  assert.equal((await rpc('resources/list')).error.code, -32601);
  assert.equal((await call('approve', {id: 'a1'})).rpcError.code, -32602);
  assert.equal((await call('list_orders', {limit: 'x'})).rpcError.code, -32602);
  assert.equal((await call('list_orders', {bogus: 1})).rpcError.code, -32602);
  assert.equal((await call('request_send_message', {chatId: BUYER})).rpcError.code, -32602);
});

await test('tools/list: 36 tools, snake_case, no approve/reject tool, every write tool is request_* and not read-only', async () => {
  const {tools} = (await rpc('tools/list')).result;
  assert.equal(tools.length, 36);
  assert.deepEqual(tools.map(t => t.name), TOOL_NAMES);
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z_]+$/);
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.description.length > 10);
    assert.equal(t.annotations.readOnlyHint, !t.name.startsWith('request_'), t.name);
  }
  assert.ok(!tools.some(t => /approve|reject|execute|close/.test(t.name)));
  assert.deepEqual(QUEUE_TOOLS, TOOL_NAMES.filter(n => n.startsWith('request_')));
});

await test('read tools: each answers, with no user / chat id in the output', async () => {
  const reads = {
    account_summary: d => { assert.equal(d.membership, true); assert.equal(d.plans, 1); assert.equal(d.orders.byState.paid, 2); assert.equal(d.orders.paidStarsTotal, 1000);
      assert.equal(d.activeMembers, 2); assert.deepEqual(d.rules.enabled, ['checkout']); assert.equal(d.openTickets, 1); },
    get_bot_status: d => { assert.equal(d.isExpectedBot, false); assert.equal(d.webhook.pendingUpdateCount, 0); assert.ok(!('url' in d.webhook)); },
    list_commands: d => assert.ok(Array.isArray(d)),
    list_plans: d => { assert.equal(d.registered[0].id, 'std'); assert.equal(d.registered[0].memberGroups, 1); assert.equal(d.miniApp.length, 3); assert.equal(d.miniApp[0].sku, 'app-light'); },
    list_orders: d => { assert.equal(d.length, 2); assert.ok(d.every(o => o.state === 'paid' && !('userId' in o))); },
    list_payment_providers: d => assert.ok(d.some(p => p.id === 'telegram_stars')),
    get_terms: d => assert.match(d.text, /特定商取引法|特商法/),
    list_tickets: d => { assert.equal(d.length, 1); assert.equal(d[0].id, 'T1'); },
    list_rule_presets: d => assert.equal(d.length, 6),
    list_rules: d => { assert.equal(d.length, 1); assert.equal(d[0].enabled, true); },
    list_approvals: d => assert.ok(Array.isArray(d)),
    list_owner_requests: d => assert.deepEqual(d, []),
    get_audit_log: d => assert.ok(d.length > 3 && d.every(r => !('target' in r) && !('chatId' in r))),
    list_booking_catalog: d => { assert.equal(d.industries.length, 9); assert.equal(d.steps.length, 6); },
    list_widgets: d => { assert.equal(d.length, 13); assert.ok(d.every(w => w.name)); },
    list_guide_steps: d => assert.equal(d.length, 6),
    list_rich_templates: d => assert.ok(d.length >= 3 && d[0].templateId),
    list_auto_replies: d => assert.equal(d.length, 4),
    get_managed_bots_status: d => assert.equal(d.configured, false),
  };
  api = [];
  globalThis.__whi = true;
  for (const name of TOOL_NAMES.filter(n => !n.startsWith('request_'))) {
    assert.ok(reads[name], `no check for ${name}`);
    const out = await call(name);
    assert.equal(out.isError, false, `${name}: ${out.data}`);
    reads[name](out.data);
    noIds(name, out.data);
  }
  assert.equal((await call('list_rich_templates', {templateId: 'membership-open'})).data.templateId, 'membership-open');
  assert.equal((await call('list_rich_templates', {templateId: 'nope'})).isError, true);
  assert.deepEqual([...new Set(api.map(c => c.method))].sort(), ['getMe', 'getMyCommands', 'getWebhookInfo']);
});

await test('request_send_message / request_ticket_reply / request_kick only queue, even with every preset enabled', async () => {
  for (const p of ['join_verify', 'join_approve_paid', 'join_decline', 'expire_remove', 'member_notice']) await admin('rule_add', {preset: p});
  const before = (await admin('approvals')).length;
  const a = await call('request_send_message', {chatId: BUYER, text: 'こんにちは'});
  assert.equal(a.data.status, 'pending_approval');
  const b = await call('request_ticket_reply', {ticketId: 'T1', text: '確認します'});
  assert.equal(b.data.status, 'pending_approval');
  const c = await call('request_kick', {chatId: GROUP, userId: BUYER2});
  assert.equal(c.data.status, 'pending_approval');
  assert.equal(apiWrites().length, 0, 'nothing reached Telegram');
  const pend = await call('list_approvals');
  assert.equal(pend.data.length, before + 3);
  assert.ok(pend.data.every(x => x.state === 'pending'));
  assert.equal(pend.data.find(x => x.id === a.data.approvalId).textPreview, 'こんにちは');
  assert.equal(pend.data.find(x => x.id === a.data.approvalId).recipient, 'user');
  noIds('list_approvals', pend.data);
  assert.equal((await call('request_kick', {chatId: BUYER, userId: BUYER2})).isError, true); // a group id only
  // Only the owner's approval sends: approve the message through the admin API.
  const r = await admin('approve', {id: a.data.approvalId});
  assert.equal(r.status, 'executed');
  assert.deepEqual(apiWrites().map(x => x.method), ['sendMessage']);
  for (const id of [b.data.approvalId, c.data.approvalId]) await admin('reject', {id});
  assert.equal(apiWrites().length, 1);
});

await test('request_refund (Stars) queues refundStarPayment; the order stays paid until the owner approves', async () => {
  const r = await call('request_refund', {orderId: ORDER1});
  assert.equal(r.data.status, 'pending_approval');
  assert.equal(apiWrites().length, 0);
  assert.equal((await admin('orders')).find(o => o.id === ORDER1).state, 'paid');
  assert.equal((await call('request_refund', {orderId: 'o-none'})).isError, true);
  const ok = await admin('approve', {id: r.data.approvalId});
  assert.equal(ok.status, 'executed');
  assert.deepEqual(apiWrites().map(x => x.method), ['refundStarPayment']);
});

await test('broadcast / rule / plan / PAY_LIVE / subscription cancel become owner requests and change nothing', async () => {
  const rulesBefore = JSON.stringify(await admin('rules')), plansBefore = JSON.stringify(await admin('plans'));
  const outs = [
    await call('request_broadcast', {audience: 'active_members', text: '新しい勉強会のお知らせ'}),
    await call('request_rule_change', {action: 'enable', preset: 'join_approve_paid', chats: [GROUP]}),
    await call('request_rule_change', {action: 'disable', ruleId: 'r1'}),
    await call('request_plan_change', {plan: {id: 'std', title: '値上げ', goodsKind: 'digital', chats: [], skus: [{id: 's30', amount: 900, currency: 'XTR', days: 30, recurring: true}]}}),
    await call('request_pay_live_change', {enabled: false}),
    await call('request_subscription_cancel', {orderId: ORDER2}),
  ];
  for (const o of outs) { assert.equal(o.isError, false, o.data); assert.equal(o.data.status, 'pending_owner'); }
  assert.equal(apiWrites().length, 0);
  assert.equal(stripeCalls.length, 0);
  assert.equal(JSON.stringify(await admin('rules')), rulesBefore);
  assert.equal(JSON.stringify(await admin('plans')), plansBefore);
  assert.equal((await admin('orders')).find(o => o.id === ORDER2).state, 'paid');
  const reqs = await call('list_owner_requests');
  assert.equal(reqs.data.length, 6);
  noIds('list_owner_requests', reqs.data);
  assert.deepEqual(reqs.data.map(x => x.kind).reverse(), ['broadcast', 'rule_enable', 'rule_disable', 'plan_change', 'pay_live_change', 'subscription_cancel']);
  // Bad input is refused, not recorded.
  for (const [name, args] of [['request_rule_change', {action: 'enable', preset: 'nope'}], ['request_rule_change', {action: 'disable', ruleId: 'r999'}],
    ['request_broadcast', {audience: 'everyone', text: 'x'}], ['request_broadcast', {audience: 'active_members', text: '   '}],
    ['request_plan_change', {plan: {id: 'bad id!'}}], ['request_subscription_cancel', {orderId: 'o-none'}]]) {
    const o = await call(name, args);
    assert.ok(o.isError === true || o.rpcError?.code === -32602, name);
  }
  assert.equal((await call('list_owner_requests')).data.length, 6);
  // The owner closes requests through the admin API; the MCP key cannot.
  assert.equal((await admin('request_close', {id: reqs.data[0].id, state: 'done'})).state, 'done');
  assert.equal((await admin('request_close', {id: reqs.data[0].id, state: 'done'}, MCPKEY)).httpStatus, 403);
  assert.equal((await admin('requests')).length, 5);
  assert.equal((await call('list_owner_requests', {state: 'all'})).data.length, 6);
  const audit = await call('get_audit_log', {limit: 50});
  assert.ok(audit.data.some(r => r.kind === 'mcp_request') && audit.data.some(r => r.kind === 'queued' && r.via === 'mcp'));
  noIds('get_audit_log', audit.data);
});

await test('all eight catalogue workflows only record owner requests, including approval and invoice creation', async () => {
  const templates = (await call('list_rich_templates')).data;
  const industries = (await call('list_booking_catalog')).data.industries;
  const pending = await call('request_send_message', {chatId: BUYER, text: 'hold for owner'});
  const beforeApprovals = JSON.stringify(await admin('approvals'));
  const beforeOrders = JSON.stringify(await admin('orders'));
  const beforeRules = JSON.stringify(await admin('rules'));
  const beforePlans = JSON.stringify(await admin('plans'));
  const beforeRequests = (await call('list_owner_requests', {state: 'all'})).data.length;
  const inputs = [
    ['request_booking', {chatId: BUYER, action: 'start'}],
    ['request_widget', {chatId: BUYER, kind: 'bk'}],
    ['request_guide', {chatId: BUYER, step: 2}],
    ['request_rich_message', {chatId: BUYER, templateId: templates[0].templateId}],
    ['request_auto_reply_change', {question: '料金は？', answer: 'オーナー確認後に変更'}],
    ['request_managed_bot_creation', {industryId: industries[0].id}],
    ['request_invoice_link', {skuId: 's30'}],
    ['request_approval', {approvalId: pending.data.approvalId}],
  ];
  for (const [name, args] of inputs) {
    const result = await call(name, args);
    assert.equal(result.isError, false, name);
    assert.equal(result.data.status, 'pending_owner', name);
    noIds(name, result.data);
    const request = (await admin('requests')).find(r => r.id === result.data.requestId);
    assert.equal(request.state, 'pending');
    if (name === 'request_rich_message') assert.equal(request.payload.template.templateId, args.templateId);
    if (name === 'request_invoice_link') assert.equal(request.payload.buyerConfirmationRequired, true);
  }
  assert.equal((await call('list_owner_requests', {state: 'all'})).data.length, beforeRequests + inputs.length);
  noIds('workflow owner requests', (await call('list_owner_requests', {state: 'all'})).data);
  assert.equal(JSON.stringify(await admin('approvals')), beforeApprovals, 'no approval or rejection');
  assert.equal(JSON.stringify(await admin('orders')), beforeOrders, 'no invoice or payment created');
  assert.equal(JSON.stringify(await admin('rules')), beforeRules);
  assert.equal(JSON.stringify(await admin('plans')), beforePlans);
  assert.equal(apiWrites().length, 0, 'no Bot API writes including creation, send, refund or webhook');
  assert.equal(stripeCalls.length, 0);
  for (const [name, args] of [
    ['request_booking', {chatId: BUYER, action: 'execute'}],
    ['request_widget', {chatId: BUYER, kind: 'invalid'}],
    ['request_guide', {chatId: BUYER, step: 7}],
    ['request_rich_message', {chatId: BUYER, templateId: 'missing'}],
    ['request_auto_reply_change', {question: '  ', answer: 'x'}],
    ['request_managed_bot_creation', {industryId: 'missing'}],
    ['request_invoice_link', {skuId: 'missing'}],
    ['request_approval', {approvalId: 'a-missing'}],
  ]) {
    const result = await call(name, args);
    assert.ok(result.isError === true || result.rpcError?.code === -32602, name);
  }
  assert.equal((await call('list_owner_requests', {state: 'all'})).data.length, beforeRequests + inputs.length);
});

await test('every tool requires authentication before running; declared string and array constraints are enforced', async () => {
  for (const name of TOOL_NAMES) {
    const msg = {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: {}}};
    assert.equal((await rawMcp(msg, {token: null})).status, 401, name);
    assert.equal((await rawMcp(msg, {token: 'wrong-key-wrong-key-wrong-key-wrong'})).status, 403, name);
  }
  for (const [name, args] of [
    ['request_send_message', {chatId: BUYER, text: 'x'.repeat(4097)}],
    ['request_send_message', {chatId: BUYER, text: ''}],
    ['request_rule_change', {action: 'enable', preset: 'checkout', chats: ['invalid']}],
    ['request_pay_live_change', {enabled: true, note: 'x'.repeat(501)}],
    ['list_widgets', null],
  ]) assert.equal((await call(name, args)).rpcError?.code, -32602, name);
  assert.equal(apiWrites().length, 0);
});

await test('with MEMBERSHIP off the membership tools report it and the catalogue tools still answer', async () => {
  const off = {...env, MEMBERSHIP: '0'};
  const r = await rawMcp({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'list_orders', arguments: {}}}, {e: off});
  const j = await r.json();
  assert.equal(j.result.isError, true); assert.match(j.result.content[0].text, /membership_off/);
  const w = await (await rawMcp({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'list_widgets', arguments: {}}}, {e: off})).json();
  assert.equal(w.result.isError, false);
  const s = await (await rawMcp({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'account_summary', arguments: {}}}, {e: off})).json();
  assert.equal(JSON.parse(s.result.content[0].text).membership, false);
});

await test('list_approvals returns the newest first past a10 / a100; one person with two plans is one member', async () => {
  for (let i = 0; i < 12; i++) { clock += 1000; await call('request_send_message', {chatId: BUYER, text: `m${i}`}); }
  const top = (await call('list_approvals', {limit: 3})).data;
  assert.deepEqual(top.map(x => x.textPreview), ['m11', 'm10', 'm9']);
  await admin('plan_set', {plan: {id: 'extra', title: 'X', goodsKind: 'digital', chats: [], skus: [{id: 'x1', amount: 100, currency: 'XTR', days: 30}]}});
  const before = (await call('account_summary')).data.activeMembers;
  const r = await mo.membership('app_checkout', {userId: BUYER2, skuId: 'x1'});
  assert.equal(r.status, 'created');
  const order = [...env.CHAT._store('membership:main').values()].filter(v => v?.id && v.userId === BUYER2 && v.state === 'awaiting_payment').pop();
  await hook({message: {message_id: 2, from: {id: BUYER2, is_bot: false, first_name: 'T'}, chat: {id: BUYER2, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: 100, invoice_payload: `o:${order.id}`, telegram_payment_charge_id: 'stxMCP3', provider_payment_charge_id: ''}}});
  assert.equal((await admin('orders')).find(o => o.id === order.id).state, 'paid');
  assert.equal((await call('account_summary')).data.activeMembers, before);
});

await test('paidStarsTotal counts subscription renewals and leaves out a refunded charge', async () => {
  const before = (await call('account_summary')).data.orders.paidStarsTotal;
  clock += 30 * DAY;
  const order = (await admin('orders')).find(o => o.id === ORDER2);
  await hook({message: {message_id: 3, from: {id: BUYER2, is_bot: false, first_name: 'T'}, chat: {id: BUYER2, type: 'private'}, date: Math.floor(clock / 1000),
    successful_payment: {currency: 'XTR', total_amount: order.amount, invoice_payload: `o:${ORDER2}`, telegram_payment_charge_id: 'stxMCP2r', provider_payment_charge_id: '',
      is_recurring: true, is_first_recurring: false, subscription_expiration_date: Math.floor((clock + 30 * DAY) / 1000)}}});
  assert.equal((await call('account_summary')).data.orders.paidStarsTotal, before + 500);
  // Telegram confirms a refund of that renewal charge: the order stays paid, the total drops by one charge.
  await hook({message: {message_id: 4, from: {id: BUYER2, is_bot: false, first_name: 'T'}, chat: {id: BUYER2, type: 'private'}, date: Math.floor(clock / 1000),
    refunded_payment: {currency: 'XTR', total_amount: order.amount, invoice_payload: `o:${ORDER2}`, telegram_payment_charge_id: 'stxMCP2r'}}});
  assert.equal((await admin('orders')).find(o => o.id === ORDER2).state, 'paid');
  assert.equal((await call('account_summary')).data.orders.paidStarsTotal, before);
});

console.log = realLog;
Date.now = realNow;
console.log(`mcp: ${results.length} passed`);
for (const r of results) console.log(`  ✓ ${r}`);
