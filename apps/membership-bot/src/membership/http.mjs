// Worker-facing glue for the membership feature, shared by the teleharness-bot Worker and the OSS
// teleharness tree so both carry the same routes:
//   POST /webhook (membership updates only)  → membership object, op 'update'
//   POST /admin/membership/<op>              → owner API (ADMIN_TOKEN)
//   GET  /verify, POST /verify/(start|answer) → guard-bot verification Mini App
//   POST /pay/(stripe|komoju|bank_gmo)        → external payment webhooks
//   scheduled()                               → op 'cron'
// The feature is off unless MEMBERSHIP=1. Even when on, nothing is written to Telegram until the
// owner enables a rule or approves a queued item, and Telegram only delivers chat_join_request /
// pre_checkout_query / subscription once the webhook's allowed_updates is widened.
import {makeService, isMembershipUpdate} from './service.mjs';
import {doStore} from './store.mjs';
import {verifyPage} from './verify.mjs';
import {newNonce, pageResponse, apiJson} from './webapp.mjs';
import {safeEqual} from './providers/contract.mjs';
import {PRESETS} from './gate.mjs';
import {MCP_OPS, listOwnerRequests, closeOwnerRequest} from '../mcp/ops.mjs';
import {makeAppLock, appLockAvailable} from './applock.mjs';

export {isMembershipUpdate};
export const membershipOn = env => env?.MEMBERSHIP === '1';
const objectOf = env => env.CHAT.getByName(`membership:${env.TENANT_ID ?? 'main'}`);
export const isMembershipObject = name => /^membership:[a-z0-9_-]{1,32}$/.test(name ?? '');

const ADMIN = {
  presets: () => PRESETS,
  rules: svc => svc.gate.listRules(),
  rule_add: (svc, a) => svc.gate.addRule(a.preset, {chats: a.chats ?? [], by: 'owner'}),
  rule_disable: (svc, a) => svc.gate.disableRule(a.id, {by: 'owner'}),
  approvals: (svc, a) => svc.gate.listApprovals(a.state ?? 'pending'),
  approve: (svc, a) => svc.gate.decide(a.id, true),
  reject: (svc, a) => svc.gate.decide(a.id, false),
  audit: async (svc, a) => (await svc.gate.auditLog()).slice(-Math.min(Number(a.limit) || 200, 1000)),
  plan_set: (svc, a) => svc.setPlan(a.plan),
  plans: svc => svc.store.list('plan:'),
  providers: svc => svc.providers(),
  orders: (svc, a) => svc.ordersForOwner(a.limit),
  tickets: (svc, a) => svc.ticketsForOwner(a.limit),
  ticket_reply: (svc, a) => svc.ticketReply(a.id, a.text),
  // Full Stars refund of one paid order (refundStarPayment). No preset covers it: the call is queued
  // and runs only when the owner approves that item (/admin/membership/approve).
  refund: (svc, a) => svc.refund(a.orderId),
  cancel: (svc, a) => svc.cancel(a.orderId, {atPeriodEnd: a.atPeriodEnd !== false}),
  // Requests an MCP client queued (broadcast, rule / plan / PAY_LIVE changes, …). Nothing applies them:
  // the owner does the change with the ops above, then closes the request.
  requests: (svc, a) => listOwnerRequests(svc.store, a.state === 'all' ? null : (a.state ?? 'pending')),
  request_close: (svc, a) => closeOwnerRequest(svc, String(a.id ?? ''), a.state),
  // v0.3.4 app lock (APP_LOCK=1 only): counts and pending resets (no user ids), and the approval of
  // an owner account's self-service reset once its 72 hours are over.
  lock_stats: (svc, a, env) => lockOf(svc, env).stats(),
  lock_rescue_approve: (svc, a, env) => lockOf(svc, env).approveOwnerRescue(String(a.ref ?? '')),
};

// The app lock runs in this same object, on the same store and audit log.
const LOCK_OPS = new Set(['state', 'setup', 'confirmRecovery', 'unlock', 'bioEnroll', 'bioUnlock', 'bioDelete', 'recover', 'rescueRequest', 'rescueAnnounce', 'rescueCancel', 'disable']);
function lockOf(svc, env) {
  if (!appLockAvailable(env)) throw Error('app_lock_not_available');
  return makeAppLock({store: svc.store, env, audit: svc.gate.audit});
}
// Member requests that the lock guards: written as a support ticket for the owner (nothing is
// cancelled or refunded here; the owner does that with the existing queued operations).
const REQUEST_KINDS = {cancel: '解約申請', refund: '返金申請'};

// Runs inside the membership Durable Object (already serialised by the caller's queue).
export async function runMembership(storage, env, op, args) {
  const svc = makeService({store: doStore(storage), env, origin: op === 'update' ? (args[1]?.origin ?? '') : ''});
  switch (op) {
    case 'update': return svc.handleUpdate(args[0]);
    case 'cron': return svc.cron();
    case 'verify': return svc.verifyApi(args[0], args[1]);
    // t79u Mini App (PAY_LIVE=1 only): a Stars invoice link for openInvoice, through the normal order.
    case 'app_checkout': {
      const r = await svc.checkout({userId: args[0].userId, chatId: null, deliverTo: args[0].userId, silent: true, skuId: args[0].skuId, provider: 'telegram_stars'});
      return {status: r.status, ...(r.result?.url ? {url: r.result.url} : {})};
    }
    case 'app_member': {
      const e = await svc.liveMember(args[0].userId);
      const plan = e && await svc.store.get(`plan:${e.planId}`);
      return e ? {planId: e.planId, title: plan?.title ?? e.planId, expiresAt: e.expiresAt, state: e.state, autoRenew: Boolean(e.autoRenew),
        links: (e.chats ?? []).map(c => plan?.links?.[c]).filter(u => typeof u === 'string' && u.startsWith('https://t.me/'))} : null;
    }
    case 'app_orders': return svc.ordersOf(args[0].userId);
    case 'app_ticket': return svc.supportTicket(args[0].userId, args[0].text);
    // v0.3.4 app lock: args = [operation, userId, body].
    case 'app_lock': {
      if (!LOCK_OPS.has(args[0])) throw Error('unknown_lock_op');
      return lockOf(svc, env)[args[0]](args[1], args[2] ?? {});
    }
    // A cancellation / refund request from the Mini App. With the member's lock on, a fresh unlock
    // (step-up token, single use) is required first.
    case 'app_request': {
      const {userId, kind, text, stepUp} = args[0];
      if (!Object.hasOwn(REQUEST_KINDS, kind)) return {status: 'bad_kind'};
      const body = String(text ?? '').trim();
      if (body.length > 800) return {status: 'too_long'};
      const gate = await lockOf(svc, env).requireStepUp(userId, stepUp, kind);
      if (!gate.ok) return {status: gate.error};
      const r = await svc.supportTicket(userId, `【${REQUEST_KINDS[kind]}】${body ? ` ${body}` : ''}（Mini App から${gate.locked ? '・アプリロック解錠済み' : ''}）`);
      return r.status === 'created' ? {status: 'created', id: r.id} : {status: r.status};
    }
    case 'pay': return svc.payWebhook(args[0], new Request('https://pay.invalid/', {method: 'POST', headers: args[1], body: args[2]}));
    // Telegram Harness MCP (src/mcp): reads and queue-only requests, never approve / rule_add / plan_set.
    case 'mcp': {
      if (!Object.hasOwn(MCP_OPS, args[0])) throw Error('unknown_mcp_op');
      return MCP_OPS[args[0]](svc, args[1] ?? {});
    }
    case 'admin': {
      if (!Object.hasOwn(ADMIN, args[0])) throw Error('unknown_admin_op');
      return ADMIN[args[0]](svc, args[1] ?? {}, env);
    }
    default: throw Error('unknown_op');
  }
}

// Webhook side: null when the update is not for the membership feature; otherwise the response for
// Telegram. A membership update is processed before answering (payments and join requests must not
// be lost after a 200): if the object fails, Telegram gets a 503 and redelivers, and payment events
// are deduplicated by their charge id, so a redelivery never grants twice.
export async function routeMembershipUpdate(update, env, origin, log = () => {}) {
  if (!membershipOn(env) || !isMembershipUpdate(update)) return null;
  try {
    await objectOf(env).membership('update', update, {origin});
    return new Response('ok', {status: 200, headers: {'content-type': 'text/plain'}});
  } catch (err) {
    log({ev: 'error', scope: 'membership', msg: String(err?.message ?? err)});
    return new Response('retry', {status: 503});
  }
}

// Everything else over HTTP. Returns null when the request is not a membership route.
export async function membershipFetch(request, env) {
  if (!membershipOn(env)) return null;
  const url = new URL(request.url);
  const adm = request.method === 'POST' && /^\/admin\/membership\/([a-z_]{1,20})$/.exec(url.pathname);
  if (adm) {
    const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!env.ADMIN_TOKEN || !safeEqual(got, env.ADMIN_TOKEN)) return new Response('forbidden', {status: 403});
    if (!Object.hasOwn(ADMIN, adm[1])) return new Response('not_found', {status: 404});
    let body = {};
    try { body = await request.json(); } catch {}
    try { return Response.json({ok: true, result: await objectOf(env).membership('admin', adm[1], body)}); }
    catch (err) { return Response.json({ok: false, error: String(err?.message ?? err)}, {status: 400}); }
  }
  if (request.method === 'GET' && url.pathname === '/verify') {
    const nonce = newNonce();
    return pageResponse(verifyPage(nonce), nonce, {cache: 'no-store'});
  }
  const ver = request.method === 'POST' && /^\/verify\/(start|answer)$/.exec(url.pathname);
  if (ver) {
    let body = {};
    try { body = await request.json(); } catch {}
    return apiJson(await objectOf(env).membership('verify', ver[1], body));
  }
  const pay = request.method === 'POST' && /^\/pay\/(stripe|komoju|bank_gmo)$/.exec(url.pathname);
  if (pay) {
    const raw = await request.text();
    const headers = Object.fromEntries([...request.headers].filter(([k]) => /signature|content-type/i.test(k)));
    try {
      const r = await objectOf(env).membership('pay', pay[1], headers, raw);
      return Response.json({ok: r.status === 'ok'}, {status: r.status === 'not_configured' ? 404 : 200});
    } catch { return new Response('bad_request', {status: 400}); } // bad signature: nothing applied, the PSP retries
  }
  return null;
}

export function membershipScheduled(env, ctx, log = () => {}) {
  if (!membershipOn(env)) return;
  ctx.waitUntil(objectOf(env).membership('cron').then(r => log({ev: 'membership_cron', ...r}), err => log({ev: 'membership_cron_error', msg: String(err?.message ?? err)})));
}
