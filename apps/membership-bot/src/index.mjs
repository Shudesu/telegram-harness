// teleharness-bot — webhook front door. Everything it does before answering Telegram is: check the
// secret token, find the chat, hand the update to that chat's Durable Object. The reply is 200 at
// once; the conversation runs in waitUntil so Telegram's queue is never held open by our work.
import {GENERATION, BOT, ANIMATIONS, STRIPS} from './schema.mjs';
import {MINIAPP_CONFIG} from './config.mjs';
import {makeCall} from './tg.mjs';
import {webhookSecret, managedConfigured} from './managed.mjs';
import {appFetch} from './studio/app.mjs';
import {routeMembershipUpdate, membershipFetch, membershipScheduled} from './membership/http.mjs';
import {mcpFetch} from './mcp/server.mjs';
export {ChatSession} from './chat.mjs';

const ASSETS = [...new Set([...ANIMATIONS, ...STRIPS])];
const OK = () => new Response('ok', {status: 200, headers: {'content-type': 'text/plain'}});

// Telegram's own header, compared without leaking length or position through timing.
function secretOk(request, env, expected = env.WEBHOOK_SECRET) {
  const got = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const want = expected ?? '';
  if (!want) return false;
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function chatIdOf(update) {
  // t63u: widget_query carries its chat; a managed_bot update carries the creator, whose private
  // chat with this bot has the same id.
  const id = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id
    ?? update?.widget_query?.chat?.id ?? update?.managed_bot?.user?.id;
  return Number.isSafeInteger(id) ? id : null;
}

// Logs and health output never carry a chat id. This is the only identifier they get.
async function tagOf(chatId) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`teleharness:${chatId}`));
  return [...new Uint8Array(d).slice(0, 4)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Reports how many consent records were imported, never which.
function countSeed(raw) {
  try { return Object.keys(JSON.parse(raw ?? '{}')).length; } catch { return -1; }
}

// Read-only identity check. It proves the stored token is usable and measures the one round trip
// that dominates a reply, without sending anything to anybody. getMe carries no chat and is on the
// transport's allowlist; nothing else here can reach a person.
async function botCheck(env, repeat = 1) {
  const call = makeCall(env, () => ({sessions: {}, optins: {}, fileIds: {}}));
  const ms = [];
  let ok = null, username = null, error;
  for (let i = 0; i < repeat; i++) {
    const started = Date.now();
    try {
      const me = await call('getMe', {});
      ok = me?.id === BOT; username = me?.username ?? null;
    } catch (err) {
      ok = false; error = String(err?.message ?? err);
    }
    ms.push(Date.now() - started);
  }
  // The first entry pays TLS setup; the rest show what a second Bot API call in the same reply costs.
  return {ok, username, ms, ...(error ? {error} : {})};
}

async function assetReport(env) {
  const out = {};
  for (const name of ASSETS) {
    const r = await env.ASSETS.fetch(`https://assets.invalid/${name}`, {method: 'GET'});
    out[name] = r.ok ? Number(r.headers.get('content-length')) || (await r.arrayBuffer()).byteLength : null;
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      let seeded = 0;
      try { seeded = Object.keys(JSON.parse(env.SEED_FILE_IDS ?? '{}')).length; } catch { seeded = -1; }
      const body = {
        ok: true, service: 'teleharness-bot', mode: 'webhook', bot: 'teleharness_bot',
        generation: GENERATION, miniappGeneration: MINIAPP_CONFIG.generation,
        at: new Date().toISOString(),
        assets: ASSETS.length, seededFileIds: seeded, seededOptins: countSeed(env.SEED_OPTINS),
        secretConfigured: Boolean(env.WEBHOOK_SECRET), tokenConfigured: Boolean(env.BOT_TOKEN),
      };
      if (url.searchParams.get('deep') === '1') {
        if (!secretOk(request, env)) return new Response('forbidden', {status: 403});
        body.assetBytes = await assetReport(env);
        // Same read, but performed by a Durable Object, because that is where an upload reads it.
        body.assetBytesFromDurableObject = await env.CHAT.getByName('probe:assets').assetProbe();
        body.botApi = await botCheck(env, Math.min(5, Math.max(1, Number(url.searchParams.get('n')) || 1)));
        body.colo = request.cf?.colo ?? null;
      }
      return Response.json(body);
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!secretOk(request, env)) return new Response('forbidden', {status: 403});
      let update;
      try { update = await request.json(); } catch { return OK(); }
      // Phase 1 membership (MEMBERSHIP=1): join requests, payments, verification answers.
      const member = await routeMembershipUpdate(update, env, url.origin, o => console.log(JSON.stringify({gen: GENERATION, ...o})));
      if (member) return member;
      const chatId = chatIdOf(update);
      if (chatId === null) return OK(); // Nothing addressable; consume it as the poller did.
      const tag = await tagOf(chatId);
      const stub = env.CHAT.getByName(`chat:${chatId}`);
      ctx.waitUntil(stub.handle(update, Date.now(), tag, url.origin).catch(err => {
        console.log(JSON.stringify({ev: 'error', gen: GENERATION, chat: tag, msg: String(err?.message ?? err)}));
      }));
      return OK();
    }

    // t63u: webhook of a bot created through Managed Bots. Its secret_token is derived per bot from
    // MANAGED_BOT_KEY, so a guessed bot id alone reaches nothing.
    const mb = request.method === 'POST' && /^\/(\d{1,20})\/webhook$/.exec(url.pathname);
    if (mb) {
      if (!managedConfigured(env) || !secretOk(request, env, await webhookSecret(env, mb[1]))) return new Response('forbidden', {status: 403});
      let update;
      try { update = await request.json(); } catch { return OK(); }
      ctx.waitUntil(env.CHAT.getByName(`mbot:${mb[1]}`).managedWebhook(update).catch(err => {
        console.log(JSON.stringify({ev: 'error', gen: GENERATION, scope: 'managed', msg: String(err?.message ?? err)}));
      }));
      return OK();
    }

    // Telegram Harness MCP (POST /mcp, Bearer MCP_API_KEY): reads, and requests that only queue.
    const mcp = await mcpFetch(request, env);
    if (mcp) return mcp;

    // t79u: the payment / membership Mini App (GET /app/, POST /app/api/*).
    const app = await appFetch(request, env);
    if (app) return app;

    const member = await membershipFetch(request, env);
    if (member) return member;

    return new Response('not_found', {status: 404});
  },

  // Cron Trigger: expiry, end of grace, removal retries and verification time-outs.
  async scheduled(event, env, ctx) {
    membershipScheduled(env, ctx, o => console.log(JSON.stringify({gen: GENERATION, ...o})));
  },
};
