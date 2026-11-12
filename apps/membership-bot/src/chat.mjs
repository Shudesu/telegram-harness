// One Durable Object per Telegram chat. It owns exactly the journal the Mac mini poller kept in
// journal.json, narrowed to this chat, and runs the unmodified engine against it.
//
// Three webhook-specific properties the poller got for free and this has to recreate:
//  1. Strict order per chat. Telegram may deliver the next update before the previous one finishes,
//     and an awaited Bot API call opens the DO's input gate, so updates are chained through a
//     per-object promise queue. Without it two presses overlap and the engine defers the second.
//  2. No silent drops. A poller left a deferred update in Telegram's queue and saw it again; a
//     webhook delivery is gone once we answer 200. A deferred result is therefore retried in place
//     (classify() returns 'continue' for an event already journaled as processing, and dispatch
//     resumes its remaining steps) instead of being abandoned.
//  3. Write-ahead durability. storage.put() is issued, not awaited, exactly where the handler wrote
//     journal.json; the Durable Object output gate holds back every outgoing Bot API request until
//     those writes are confirmed, which is the ordering the engine relies on.
import {DurableObject} from 'cloudflare:workers';
import {GENERATION, ANIMATIONS, STRIPS} from './schema.mjs';
import {fresh, migrate, pruneFileIds} from './engine.mjs';
import {recover, processBatch} from './miniapp.mjs';
import {MINIAPP_CONFIG} from './config.mjs';
import {makeCall} from './tg.mjs';
import {handleExtra, augment} from './extras.mjs';
import {openToken, managedReply, managedCall} from './managed.mjs';
import {isMembershipObject, runMembership} from './membership/http.mjs';
import {memberNo, until} from './studio/flow.mjs';

const JOURNAL = 'journal';
// A deferred step means the engine gave its send slot up: a cooldown, or a rolling per-user cap.
// RETRY_FLOOR_MS is simply longer than the engine's own inter-message spacing, so three tries always
// cover it even when the engine does not say when to come back.
const RETRIES = 3, MAX_WAIT_MS = 3000, RETRY_FLOOR_MS = 700;
// storage.put() rejects above 128 KiB; expire() already prunes, this is the backstop.
const MAX_JOURNAL_BYTES = 90000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Assets whose file_id the engine records and may pass back instead of re-uploading.
const CACHEABLE = new Set([...ANIMATIONS, ...STRIPS]);

function trim(g) {
  if (JSON.stringify(g).length <= MAX_JOURNAL_BYTES) return;
  const live = new Set(['processing', 'pending']);
  const stale = Object.entries(g.events).filter(([, e]) => !live.has(e.state)).sort((a, b) => a[1].at - b[1].at);
  for (const [id] of stale) {
    delete g.events[id];
    if (JSON.stringify(g).length <= MAX_JOURNAL_BYTES) return;
  }
}

export class ChatSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
    this.put = Promise.resolve();
    this.tag = 'unknown';
    // A managed bot's record lives in its own object, named mbot:<botId>; it holds no chat journal.
    this.mbot = /^mbot:\d+$/.test(ctx.id.name ?? '');
    if (this.mbot) return;
    // Phase 1 membership: one object (membership:<tenant>) owns rules, orders, entitlements, join
    // requests and the audit log. It holds no chat journal either.
    this.member = isMembershipObject(ctx.id.name);
    if (this.member) return;
    // The object's own name carries the chat it belongs to, which is how it can pick its own
    // opt-in record out of the imported consent without anything having to pre-create it.
    this.chatId = Number(/^chat:(-?\d+)$/.exec(ctx.id.name ?? '')?.[1]);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(JOURNAL);
      this.g = stored ? migrate(stored) : fresh();
      this.g.startedAt = new Date().toISOString();
      pruneFileIds(this.g, [...ANIMATIONS, ...STRIPS]);
      this.#seedFileIds();
      this.#seedOptins();
      // A cold start is a restart: an action that was mid-flight when the object was evicted is
      // quarantined rather than replayed, which is what the handler did on every boot.
      recover(this.g, {persist: s => this.#persist(s)});
    });
  }

  // file_ids Telegram returned for uploads the Mac mini poller already made. Applied once per
  // distinct seed value so an id the engine drops after a 4xx is not immediately put back.
  #seedFileIds() {
    let seed;
    try { seed = JSON.parse(this.env.SEED_FILE_IDS ?? '{}'); } catch { return; }
    const stamp = JSON.stringify(seed);
    if (!seed || typeof seed !== 'object' || this.g.seedApplied === stamp) return;
    this.g.fileIds ??= {};
    for (const [name, id] of Object.entries(seed)) {
      if (CACHEABLE.has(name) && typeof id === 'string' && !this.g.fileIds[name]) this.g.fileIds[name] = id;
    }
    this.g.seedApplied = stamp;
  }

  // The opt-in consent the Mac mini poller had already recorded, imported on this chat's first
  // cold start rather than pushed in ahead of time: a Durable Object is created where its first
  // request arrives, so pre-creating them from Japan would pin every chat far away from the colo
  // Telegram actually delivers to. Only this chat's own entry is read; sessions, receipts and
  // handoff summaries are not imported, so a press on an older button re-renders through the
  // engine's own __refresh path.
  #seedOptins() {
    if (!Number.isSafeInteger(this.chatId)) return;
    let seed;
    try { seed = JSON.parse(this.env.SEED_OPTINS ?? '{}'); } catch { return; }
    const stamp = JSON.stringify(seed);
    if (!seed || typeof seed !== 'object' || this.g.optinSeedApplied === stamp) return;
    this.g.optinSeedApplied = stamp;
    for (const [key, value] of Object.entries(seed)) {
      const m = /^(-?\d+):(\d+)$/.exec(key);
      if (!m || Number(m[1]) !== this.chatId || this.g.optins[key]) continue;
      this.g.optins[key] = {
        since: Number.isSafeInteger(value?.since) ? value.since : Date.now(),
        ...(Number.isSafeInteger(value?.lastStartAt) ? {lastStartAt: value.lastStartAt} : {}),
      };
    }
  }

  #persist(g) {
    trim(g);
    this.put = this.ctx.storage.put(JOURNAL, g);
  }

  // The one integration a synthetic test cannot reach: the assets binding as seen from inside a
  // Durable Object, which is where the 600 KB headers and the collages are actually read before an
  // upload. Reports sizes only, sends nothing, and is only ever called on a non-chat object.
  async assetProbe() {
    const out = {};
    for (const name of CACHEABLE) {
      try {
        const r = await this.env.ASSETS.fetch(`https://assets.invalid/${name}`);
        out[name] = r.ok ? (await r.arrayBuffer()).byteLength : null;
      } catch (err) {
        out[name] = String(err?.message ?? err);
      }
    }
    return out;
  }

  // t63u Managed Bots: the encrypted token and template of one created bot.
  async storeManagedBot(rec) {
    if (!this.mbot) throw Error('not_a_managed_bot_object');
    await this.ctx.storage.put('managed', rec);
  }

  async managedOwner() {
    if (!this.mbot) throw Error('not_a_managed_bot_object');
    return (await this.ctx.storage.get('managed'))?.owner ?? null;
  }

  // A delivery to /<botId>/webhook, already checked against that bot's derived secret_token.
  async managedWebhook(update) {
    if (!this.mbot) throw Error('not_a_managed_bot_object');
    const run = this.queue.then(async () => {
      const rec = await this.ctx.storage.get('managed');
      const botId = Number(this.ctx.id.name.slice(5));
      if (!rec) return {handled: 'unknown_bot'};
      const plan = managedReply(rec, update);
      if (!plan) return {handled: 'ignored'};
      // Durable per-bot dedup: a redelivered update is not answered twice, even after eviction.
      const now = Date.now(), seen = (await this.ctx.storage.get('seen')) ?? {};
      if (!Number.isSafeInteger(update?.update_id) || seen[update.update_id]) return {handled: 'duplicate'};
      for (const [k, at] of Object.entries(seen)) if (now - at > 48 * 3600000) delete seen[k];
      seen[update.update_id] = now;
      await this.ctx.storage.put('seen', seen);
      const token = await openToken(this.env, rec.sealed, botId);
      for (const st of plan.steps) {
        // Messages to the creator are spaced 1.1 s apart; a fast press waits instead of being lost.
        if (st.method === 'sendMessage') {
          const wait = 1100 - (Date.now() - (this.lastSend ?? 0));
          if (wait > 0) await new Promise(r => setTimeout(r, wait));
          this.lastSend = Date.now();
        }
        await managedCall(token, st.method, st.body);
      }
      return {handled: 'replied'};
    });
    this.queue = run.then(() => {}, () => {});
    const r = await run.catch(err => ({handled: 'error', code: err?.code ?? null}));
    console.log(JSON.stringify({ev: 'managed_update', gen: GENERATION, handled: r.handled, ...(r.code ? {code: r.code} : {})}));
    return r;
  }

  // Phase 1 membership entry point. Every call is serialised through the same per-object queue, so a
  // join request, its verification answer and a cron sweep never interleave on the same records.
  async membership(op, ...args) {
    if (!this.member) throw Error('not_a_membership_object');
    const run = this.queue.then(() => runMembership(this.ctx.storage, this.env, op, args));
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  // t79u Mini App (/app/): read the member record, or record a TEST registration. The caller has
  // already verified the Mini App initData for this very user; nothing is sent to Telegram here.
  async studioApp(op, data) {
    if (!Number.isSafeInteger(this.chatId)) throw Error('not_a_chat_object');
    const run = this.queue.then(async () => {
      const s = this.g.studio ??= {};
      if (op === 'member') return s.member ?? null;
      if (op !== 'test_join') throw Error('unknown_op');
      const now = Date.now();
      s.member = {no: memberNo(this.chatId), pl: String(data?.plan ?? '').slice(0, 16), until: until(now), via: 'app_test', invoice: data?.invoice ?? null, at: now};
      this.#persist(this.g);
      await this.put;
      return s.member;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async handle(update, receivedAt, tag, origin) {
    this.tag = tag ?? this.tag;
    this.origin = origin ?? this.origin;
    const run = this.queue.then(() => this.#run(update, receivedAt));
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  // Runs one update, retrying while the engine is still holding its send slot back. A poller would
  // simply have been handed the same update again on the next getUpdates; a webhook delivery has
  // already been answered with 200 and will never be repeated, so the retry has to happen here.
  async #feed(g, update, io) {
    let result = {blocked: 1}, attempts = 0;
    for (; attempts < RETRIES; attempts++) {
      result = await processBatch(g, [update], io, MINIAPP_CONFIG);
      if (!result.blocked) break;
      const until = Math.max(g.deferUntil ?? 0, g.cooldownUntil ?? 0) - Date.now();
      if (attempts + 1 >= RETRIES || until > MAX_WAIT_MS) break;
      await sleep(Math.min(MAX_WAIT_MS, Math.max(RETRY_FLOOR_MS, until)));
    }
    return {result, attempts: attempts + 1};
  }

  // Finishes any action still journaled as in-flight. The engine resumes an action from its own
  // journal — classify() reports an update it already recorded as 'continue' and dispatch picks the
  // remaining steps back up — so all it needs is the update_id. Without this a press whose second
  // message was held back would stay 'processing' and block every later press in the chat until the
  // 24 h session expiry, because nothing redelivers a webhook update.
  async #drain(g, io) {
    let drained = 0;
    for (const id of Object.keys(g.events)) {
      if (g.events[id]?.state !== 'processing') continue;
      const update_id = Number(id);
      if (!Number.isSafeInteger(update_id)) continue;
      await this.#feed(g, {update_id, message: {}}, io);
      drained++;
    }
    return drained;
  }

  async #run(update, receivedAt) {
    const g = this.g;
    const t = {recv: receivedAt ?? Date.now()};
    const calls = [];
    const inflight = [];
    let ackAt = null;
    const inner = makeCall(this.env, () => g);
    const io = {
      now: () => Date.now(),
      // The engine spaces its own messages out and asks the caller for the wait, so it can be
      // cancelled or fast-forwarded. Here it is a real timer; the test suite advances a clock.
      wait: ms => sleep(ms),
      persist: s => this.#persist(s),
      stopping: () => false,
      event: () => {},
      failure: kind => { calls.push({failure: kind}); },
      // Every call is tracked, because the engine deliberately does NOT await the callback answer:
      // it fires it and moves on so the spinner stops first. A Durable Object invocation that
      // returned while that request was still in flight would have it cancelled, so the run waits
      // for all of them at the end.
      call: (method, body) => {
        body = augment(method, body);
        const started = Date.now();
        const p = (async () => {
          try {
            return await inner(method, body);
          } finally {
            calls.push({m: method, ms: Date.now() - started});
            if (method === 'answerCallbackQuery' && ackAt === null) ackAt = Date.now();
          }
        })();
        inflight.push(p);
        return p;
      },
    };
    let result = {blocked: null}, attempts = 0, drained = 0, extra = null;
    try {
      drained = await this.#drain(g, io);
      extra = await handleExtra(g, update, io, {
        env: this.env, origin: this.origin,
        storeManagedBot: (botId, rec) => this.env.CHAT.getByName(`mbot:${botId}`).storeManagedBot(rec),
        ownerOf: botId => this.env.CHAT.getByName(`mbot:${botId}`).managedOwner(),
      });
      if (!extra) ({result, attempts} = await this.#feed(g, update, io));
      else if (extra.legacy) ({result, attempts} = await this.#feed(g, extra.legacy, io));
      await Promise.allSettled(inflight);
      await this.put;
    } finally {
      // No chat id, no user id, no message text: only the hashed chat tag and timings.
      console.log(JSON.stringify({
        ev: 'update', gen: GENERATION, chat: this.tag,
        kind: update?.callback_query ? 'callback' : update?.widget_query ? 'widget_query' : update?.managed_bot ? 'managed_bot' : 'message',
        ...(extra ? {extra: extra.handled} : {}),
        blocked: result.blocked ?? null, attempts, drained,
        msToAck: ackAt === null ? null : ackAt - t.recv,
        msTotal: Date.now() - t.recv,
        calls,
      }));
    }
    return {blocked: result.blocked ?? null};
  }
}

