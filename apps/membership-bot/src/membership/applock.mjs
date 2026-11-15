// App lock (P1, v0.3.4): an opt-in passcode / biometrics / recovery code that a member turns on for
// themselves. Nobody is forced into it and it is off by default twice over: the switch APP_LOCK must
// be "1" (with MEMBERSHIP=1 and the secret APP_LOCK_PEPPER set), and then each member decides.
//
// What it guards: only the risky actions of this bot's own Mini App — a cancellation or refund
// request, and owner operations (requireStepUp(..., 'owner') for an owner page; none exists yet).
// Opening the Mini App, looking at the card or paying never asks for it. It is an in-app lock and
// has nothing to do with the 2FA / password of the Telegram account, which this project never touches.
//
// Everything is decided here, on the server, inside the membership Durable Object (one request at a
// time, so attempt counters cannot be raced). The page's own word (isAccessGranted, deviceId, …) is
// never trusted. Nothing secret is stored in the clear:
//   passcode      PBKDF2-SHA256(HMAC(pepper, passcode), per-user 16-byte salt, 100 000 rounds)
//   recovery code HMAC(pepper, code)   (100 random bits: brute force is not a concern)
//   bio token     not stored: HMAC(pepper, device ‖ random seed ‖ generation), replaced on every use
//   step-up token HMAC(pepper, token)  (short-lived proof of a recent unlock)
// The pepper lives only in the Worker secret, never in the Durable Object.
//
// Keys in the existing membership:<tenant> Durable Object (no new class, no migration; an older
// version simply never reads them):
//   lock:<userId>        the lock record (see newRecord)
//   bio:<userId>:<id>    one per device with biometrics enrolled
//   rescue:<userId>      a self-service reset waiting out its 72 hours
// No message is ever pushed from here. The only Bot message about a reset is the reply to the
// member's own /applock_reset or /applock_cancel in their private chat (studio/flow.mjs).
const enc = new TextEncoder();

export const APP_LOCK_SWITCH = 'APP_LOCK';
export const APP_LOCK_PEPPER = 'APP_LOCK_PEPPER';
// Optional: Telegram user ids (comma-separated) whose lock counts as an owner's. An owner's
// self-service reset still waits 72 hours and then also needs the owner approval queue
// (/admin/membership/lock_rescue_approve). Unset = nobody.
export const APP_LOCK_OWNERS = 'APP_LOCK_OWNER_IDS';

export const APP_LOCK_KEYS = Object.freeze({
  lock: userId => `lock:${userId}`,
  bio: (userId, deviceId) => `bio:${userId}:${deviceId}`,
  rescue: userId => `rescue:${userId}`,
});
export const APP_LOCK_PREFIXES = Object.freeze(['lock:', 'bio:', 'rescue:']);

// Every route takes the Mini App initData in a JSON body, so each one is a POST (DELETE for removals).
export const APP_LOCK_ROUTES = Object.freeze([
  'POST /app/api/lock',
  'POST /app/api/lock/setup',
  'POST /app/api/lock/confirm-recovery',
  'POST /app/api/lock/unlock',
  'POST /app/api/lock/bio/enroll',
  'POST /app/api/lock/bio/unlock',
  'DELETE /app/api/lock/bio/:id',
  'POST /app/api/lock/recover',
  'POST /app/api/lock/rescue',
  'DELETE /app/api/lock/rescue',
  'POST /app/api/lock/disable',
]);

export const isAppLockPath = pathname => /^\/app\/api\/lock(\/|$)/.test(pathname);
// The switch alone: with it off every lock route answers 501 and the page shows nothing new.
export const appLockOn = env => env?.APP_LOCK === '1';
// Usable: switch on, membership on and a pepper of at least 32 characters.
export const appLockAvailable = env => appLockOn(env) && env?.MEMBERSHIP === '1'
  && typeof env?.APP_LOCK_PEPPER === 'string' && env.APP_LOCK_PEPPER.length >= 32;

// Cloudflare Workers' WebCrypto refuses PBKDF2 above 100 000 iterations. The record keeps algo/iter
// so a later version can raise them and re-hash at the next successful unlock.
export const PBKDF2_ITER = 100000;
export const STEP_UP_MS = 5 * 60 * 1000;          // an unlock is good for 5 minutes
export const RESCUE_WAIT_MS = 72 * 3600 * 1000;   // a self-service reset waits 72 hours
export const PENDING_MS = 30 * 60 * 1000;         // a set-up must be confirmed within 30 minutes
export const MAX_DEVICES = 5;
export const HARD_FAILS = 10;
// Consecutive wrong passcodes → how long the passcode is refused. 1–4: count only; 10: the passcode
// no longer opens it at all (recovery code or the 72-hour reset). The same ladder counts wrong
// recovery codes, separately.
const LADDER = {5: 60e3, 6: 5 * 60e3, 7: 15 * 60e3, 8: 3600e3, 9: 6 * 3600e3};
export const lockoutFor = fails => LADDER[fails] ?? 0;

// Recovery code: THR- + 20 characters from 32 symbols without the look-alikes 0/O and 1/I (100 bits).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_PREFIX = 'THR-';
export const RECOVERY_RE = /^THR-([A-HJ-NP-Z2-9]{5})-([A-HJ-NP-Z2-9]{5})-([A-HJ-NP-Z2-9]{5})-([A-HJ-NP-Z2-9]{5})$/;
export function normalizeRecovery(s) {
  const t = String(s ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/^THR/, '');
  return /^[A-HJ-NP-Z2-9]{20}$/.test(t) ? t : null;
}

// 6 digits, and not a pattern anyone would try first: one digit repeated, a run up or down, or a
// repeated pair / triple (121212, 123123).
export function passcodeProblem(p) {
  if (typeof p !== 'string' || !/^[0-9]{6}$/.test(p)) return 'passcode_format';
  const d = [...p].map(Number), step = d[1] - d[0];
  if (new Set(d).size === 1) return 'passcode_too_simple';
  if (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return 'passcode_too_simple';
  if (p === p.slice(0, 2).repeat(3) || p === p.slice(0, 3).repeat(2)) return 'passcode_too_simple';
  return null;
}

const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hexOf = u8 => [...u8].map(x => x.toString(16).padStart(2, '0')).join('');
function sameStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function makeAppLock({store, env = {}, now = () => Date.now(), random = n => crypto.getRandomValues(new Uint8Array(n)), audit = async () => {}}) {
  const pepper = env.APP_LOCK_PEPPER ?? '';
  const owners = new Set(String(env[APP_LOCK_OWNERS] ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isSafeInteger(n) && n > 0));
  const isOwner = userId => owners.has(userId);
  let hk;
  async function mac(label, value) {
    hk ??= await crypto.subtle.importKey('raw', enc.encode(pepper), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hk, enc.encode(`${label}:${value}`)));
  }
  const macB64 = async (label, value) => b64(await mac(label, value));
  async function passHash(passcode, salt, iter) {
    const key = await crypto.subtle.importKey('raw', await mac('passcode', passcode), 'PBKDF2', false, ['deriveBits']);
    return b64(new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter}, key, 256)));
  }
  const newToken = () => hexOf(random(32));
  const bioToken = async (id, seed, gen) => `${id}.${gen}.${hexOf(await mac('bio', `${id}:${seed}:${gen}`))}`;
  function newRecovery() {
    const r = random(20);
    const s = [...r].map(x => ALPHABET[x & 31]).join('');
    return {code: `${RECOVERY_PREFIX}${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15)}`, plain: s};
  }
  const log = (ev, extra = {}) => audit({kind: 'app_lock', ev, ...extra}); // never a code, token or user id

  // ---------- records ----------
  const ACTIVE = ['waiting', 'awaiting_owner_approval'];
  const K = APP_LOCK_KEYS;
  async function devices(userId) { return store.list(`bio:${userId}:`); }
  async function dropDevices(userId) { for (const d of await devices(userId)) await store.delete(K.bio(userId, d.id)); }
  async function dropAll(userId) { await store.delete(K.lock(userId)); await dropDevices(userId); }

  // Loads the lock, first applying a reset whose 72 hours are over (an owner's goes to the approval
  // queue instead) and dropping a set-up that was never confirmed.
  async function load(userId) {
    let rec = await store.get(K.lock(userId));
    const t = now();
    if (rec?.state === 'pending' && t - rec.createdAt > PENDING_MS) { await dropAll(userId); rec = undefined; }
    const rs = await store.get(K.rescue(userId));
    if (rs?.state === 'waiting' && t >= rs.executeAfter) {
      // Owner status is checked again now: an id added to APP_LOCK_OWNER_IDS meanwhile still needs approval.
      if (rs.owner || isOwner(userId)) { rs.owner = true; rs.state = 'awaiting_owner_approval'; await store.put(K.rescue(userId), rs); await log('rescue_to_owner_queue', {ref: rs.ref}); }
      else { await dropAll(userId); rs.state = 'done'; rs.doneAt = t; await store.put(K.rescue(userId), rs); await log('rescue_done', {ref: rs.ref}); rec = undefined; }
    }
    return rec;
  }
  async function cancelRescue(userId, why) {
    const rs = await store.get(K.rescue(userId));
    if (!rs || ![...ACTIVE, 'unannounced'].includes(rs.state)) return false;
    const was = rs.state;
    Object.assign(rs, {state: 'cancelled', cancelledAt: now(), cancelledBy: why});
    await store.put(K.rescue(userId), rs);
    await log('rescue_cancelled', {ref: rs.ref, why});
    return was !== 'unannounced'; // an unannounced row was never a live request
  }
  const save = (userId, rec) => store.put(K.lock(userId), {...rec, updatedAt: now()});

  async function issueStepUp(userId, rec) {
    const token = newToken(), t = now();
    rec.stepUps = [...(rec.stepUps ?? []).filter(s => s.exp > t).slice(-2), {h: await macB64('stepup', token), exp: t + STEP_UP_MS}];
    return {stepUp: token, stepUpExpiresAt: t + STEP_UP_MS};
  }
  // True when `token` is a live step-up of this user; `consume` makes it single-use.
  async function checkStepUp(userId, rec, token, {consume = false} = {}) {
    if (!rec || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
    const h = await macB64('stepup', token), t = now();
    const live = (rec.stepUps ?? []).filter(s => s.exp > t);
    const hit = live.find(s => sameStr(s.h, h));
    if (!hit) return false;
    rec.stepUps = consume ? live.filter(s => s !== hit) : live;
    await save(userId, rec);
    return true;
  }

  function lockView(rec, t) {
    if (!rec) return {on: false, pending: false};
    const locked = rec.lockedUntil > t ? rec.lockedUntil : null;
    return {on: rec.state === 'on', pending: rec.state === 'pending', fails: rec.fails, lockedUntil: locked, hard: Boolean(rec.hard),
      remaining: rec.fails < 5 ? 5 - rec.fails : 0, recoveryLockedUntil: rec.rlockedUntil > t ? rec.rlockedUntil : null, recoveryHard: Boolean(rec.rhard)};
  }

  // A wrong passcode (or recovery code: field prefix 'r') moves one step down the ladder.
  function fail(rec, f = '') {
    rec[`${f}fails`] = (rec[`${f}fails`] ?? 0) + 1;
    const n = rec[`${f}fails`];
    if (n >= HARD_FAILS) rec[`${f}hard`] = true;
    rec[`${f}lockedUntil`] = n >= HARD_FAILS ? 0 : (lockoutFor(n) ? now() + lockoutFor(n) : 0);
  }

  async function setPasscode(rec, passcode) {
    const salt = random(16);
    rec.algo = 'pbkdf2-sha256/hmac-pepper'; rec.iter = PBKDF2_ITER; rec.salt = b64(salt);
    rec.hash = await passHash(passcode, salt, PBKDF2_ITER);
    rec.fails = 0; rec.lockedUntil = 0; rec.hard = false;
  }
  async function setRecovery(rec) {
    const {code, plain} = newRecovery();
    rec.recoveryHash = await macB64('recovery', plain);
    rec.recoveryTail = await macB64('recovery-tail', plain.slice(-4));
    rec.recoveryConfirmed = false; rec.tailTries = 0;
    rec.rfails = 0; rec.rlockedUntil = 0; rec.rhard = false;
    return code;
  }

  // ---------- operations (each returns a plain object; `error` marks a refusal) ----------
  const ops = {
    async state(userId) {
      const rec = await load(userId), t = now();
      const rs = await store.get(K.rescue(userId));
      const devs = rec ? await devices(userId) : [];
      return {available: true, ...lockView(rec, t),
        devices: devs.map(d => ({id: d.id, label: d.label, type: d.type, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt})),
        rescue: rs && ACTIVE.includes(rs.state) ? {state: rs.state, requestedAt: rs.requestedAt, executeAfter: rs.executeAfter} : null};
    },

    // First set-up (or a set-up left unconfirmed): stores the passcode and returns the recovery code
    // once. With the lock already on it only changes the passcode, and needs a step-up.
    async setup(userId, {passcode, stepUp} = {}) {
      const problem = passcodeProblem(passcode);
      if (problem) return {error: problem};
      const rec = await load(userId), t = now();
      if (rec?.state === 'on') {
        if (!await checkStepUp(userId, rec, stepUp)) return {error: 'unlock_required'};
        await setPasscode(rec, passcode);
        await save(userId, rec);
        await log('passcode_changed');
        return {ok: true, changed: true};
      }
      // A reset requested for an earlier lock must never remove this new one.
      await cancelRescue(userId, 'new_lock');
      const fresh = {v: 1, state: 'pending', createdAt: t, owner: isOwner(userId), stepUps: []};
      await setPasscode(fresh, passcode);
      const code = await setRecovery(fresh);
      await save(userId, fresh);
      await log('setup_started');
      return {ok: true, recoveryCode: code};
    },

    // The member types the last 4 characters of the code just shown: proof it was written down.
    async confirmRecovery(userId, {last4} = {}) {
      const rec = await load(userId);
      if (!rec || rec.recoveryConfirmed) return {error: 'nothing_to_confirm'};
      if (rec.state === 'on' && (rec.tailTries ?? 0) >= 5) return {error: 'too_many_tries'};
      const tail = String(last4 ?? '').toUpperCase().replace(/\s/g, '');
      if (!/^[A-HJ-NP-Z2-9]{4}$/.test(tail) || !sameStr(await macB64('recovery-tail', tail), rec.recoveryTail)) {
        rec.tailTries = (rec.tailTries ?? 0) + 1;
        if (rec.state === 'pending' && rec.tailTries >= 5) { await dropAll(userId); return {error: 'setup_abandoned'}; }
        await save(userId, rec);
        return {error: 'wrong_last4'};
      }
      const first = rec.state === 'pending';
      rec.state = 'on'; rec.recoveryConfirmed = true; rec.tailTries = 0;
      // Only the first set-up's confirmation proves presence (the member just chose the passcode).
      // After a recovery the member already holds the step-up recover() issued; confirming the new
      // code must not mint another one, or its 4 characters would become a way in.
      const su = first ? await issueStepUp(userId, rec) : {};
      await save(userId, rec);
      await log(first ? 'enabled' : 'recovery_confirmed');
      return {ok: true, ...su};
    },

    async unlock(userId, {passcode} = {}) {
      const rec = await load(userId), t = now();
      if (rec?.state !== 'on') return {error: 'not_enabled'};
      if (rec.hard) return {error: 'locked_hard'};
      // While locked nothing is computed, so timing tells nothing about the guess.
      if (rec.lockedUntil > t) return {error: 'locked', lockedUntil: rec.lockedUntil};
      if (typeof passcode !== 'string' || !/^[0-9]{6}$/.test(passcode)) return {error: 'passcode_format'};
      if (sameStr(await passHash(passcode, unb64(rec.salt), rec.iter), rec.hash)) {
        rec.fails = 0; rec.lockedUntil = 0;
        const su = await issueStepUp(userId, rec);
        await save(userId, rec);
        await log('unlocked', {via: 'passcode'});
        return {ok: true, ...su};
      }
      fail(rec);
      await save(userId, rec);
      await log('unlock_failed', {fails: rec.fails});
      return {error: rec.hard ? 'locked_hard' : 'wrong_passcode', ...lockView(rec, now())};
    },

    // Biometrics: a token kept by Telegram in the device's secure storage behind Face ID /
    // fingerprint, enrolled only right after an unlock. The token is `<deviceId>.<generation>.<mac>`
    // where mac = HMAC(pepper, deviceId ‖ per-device random seed ‖ generation). Each use moves the
    // device to the next generation and hands out that token, so any earlier generation — however
    // many rotations ago — is recognised as a copy, with nothing but the seed and a counter stored.
    async bioEnroll(userId, {stepUp, type, label} = {}) {
      const rec = await load(userId);
      if (rec?.state !== 'on') return {error: 'not_enabled'};
      if (!await checkStepUp(userId, rec, stepUp)) return {error: 'unlock_required'};
      const devs = await devices(userId);
      if (devs.length >= MAX_DEVICES) return {error: 'too_many_devices'};
      const id = hexOf(random(6)), seed = hexOf(random(32)), t = now();
      await store.put(K.bio(userId, id), {id, seed, gen: 0,
        type: ['face', 'finger'].includes(type) ? type : 'unknown', label: String(label ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 24) || '端末',
        createdAt: t, lastUsedAt: null});
      await log('bio_enrolled');
      return {ok: true, id, token: await bioToken(id, seed, 0)};
    },

    // Unlock with the token Telegram released after Face ID / fingerprint. An earlier generation
    // coming back means a copy exists somewhere else: that device's enrolment and every live step-up
    // are removed, and the passcode is required.
    async bioUnlock(userId, {token} = {}) {
      const rec = await load(userId);
      if (rec?.state !== 'on') return {error: 'not_enabled'};
      const m = /^([0-9a-f]{12})\.(0|[1-9][0-9]{0,8})\.([0-9a-f]{64})$/.exec(String(token ?? ''));
      const dev = m && await store.get(K.bio(userId, m[1]));
      if (!dev?.seed) return {error: 'bio_invalid'};
      const gen = Number(m[2]);
      if (gen > dev.gen || !sameStr(token, await bioToken(dev.id, dev.seed, gen))) return {error: 'bio_invalid'};
      if (gen < dev.gen) {
        await store.delete(K.bio(userId, dev.id));
        rec.stepUps = [];
        await save(userId, rec);
        await log('bio_replay_revoked');
        return {error: 'bio_revoked'};
      }
      dev.gen = gen + 1; dev.lastUsedAt = now();
      await store.put(K.bio(userId, dev.id), dev);
      // The member proved presence on an enrolled device: the passcode counter starts over.
      rec.fails = 0; rec.lockedUntil = 0; rec.hard = false;
      const su = await issueStepUp(userId, rec);
      await save(userId, rec);
      await log('unlocked', {via: 'bio'});
      return {ok: true, token: await bioToken(dev.id, dev.seed, dev.gen), ...su};
    },

    async bioDelete(userId, {id, stepUp} = {}) {
      const rec = await load(userId);
      if (rec?.state !== 'on') return {error: 'not_enabled'};
      if (!await checkStepUp(userId, rec, stepUp)) return {error: 'unlock_required'};
      if (!/^[0-9a-f]{12}$/.test(String(id ?? '')) || !await store.get(K.bio(userId, id))) return {error: 'unknown_device'};
      await store.delete(K.bio(userId, id));
      // The removed device may have unlocked minutes ago: every live proof goes with it, so the next
      // risky action needs a fresh unlock from a device still trusted.
      rec.stepUps = [];
      await save(userId, rec);
      await log('bio_deleted');
      return {ok: true};
    },

    // Forgotten passcode: the recovery code opens the lock once. The code is spent, every device's
    // biometrics are removed, a new passcode is set and a new code is shown once.
    async recover(userId, {code, passcode} = {}) {
      const rec = await load(userId), t = now();
      if (rec?.state !== 'on') return {error: 'not_enabled'};
      if (rec.rhard) return {error: 'recovery_locked_hard'};
      if (rec.rlockedUntil > t) return {error: 'recovery_locked', recoveryLockedUntil: rec.rlockedUntil};
      const problem = passcodeProblem(passcode);
      if (problem) return {error: problem};
      const plain = normalizeRecovery(code);
      if (!plain || !sameStr(await macB64('recovery', plain), rec.recoveryHash)) {
        fail(rec, 'r');
        await save(userId, rec);
        await log('recovery_failed', {fails: rec.rfails});
        return {error: rec.rhard ? 'recovery_locked_hard' : 'wrong_recovery_code', ...lockView(rec, now())};
      }
      await setPasscode(rec, passcode);
      const fresh = await setRecovery(rec);
      await dropDevices(userId);
      await cancelRescue(userId, 'recovered');
      rec.stepUps = []; // proofs from before the recovery no longer count
      const su = await issueStepUp(userId, rec);
      await save(userId, rec);
      await log('recovered');
      return {ok: true, recoveryCode: fresh, ...su};
    },

    // Self-service reset when both passcode and recovery code are lost. Started only by the member's
    // own /applock_reset in their private chat, whose reply is the notice (with the time and how to
    // cancel); it becomes active only once that reply was delivered (rescueAnnounce). After 72 hours the lock is removed the next time it is looked at; an owner's lock goes
    // to the approval queue instead. Membership and orders are never touched.
    async rescueRequest(userId) {
      const rec = await load(userId);
      if (rec?.state !== 'on') return {status: 'no_lock'};
      const rs = await store.get(K.rescue(userId));
      if (rs && ACTIVE.includes(rs.state)) return {status: 'already_requested', executeAfter: rs.executeAfter, owner: Boolean(rs.owner)};
      const t = now(), n = ((await store.get('seq:lockrescue')) ?? 0) + 1;
      await store.put('seq:lockrescue', n);
      // Stored as 'unannounced': it does nothing until rescueAnnounce() confirms that the reply
      // carrying the notice was delivered. A lost reply (or a lost answer to this call) leaves an
      // inactive row that the next /applock_reset simply replaces.
      const row = {ref: `LR${n}`, userId, state: 'unannounced', requestedAt: t, executeAfter: t + RESCUE_WAIT_MS, owner: Boolean(rec.owner || isOwner(userId))};
      await store.put(K.rescue(userId), row);
      await log('rescue_requested', {ref: row.ref});
      return {status: 'requested', executeAfter: row.executeAfter, owner: row.owner};
    },

    // Called by the chat handler once Telegram accepted the reply with the notice: from here the
    // 72 hours count (from the request) and /applock_cancel can stop it.
    async rescueAnnounce(userId) {
      const rs = await store.get(K.rescue(userId));
      if (rs?.state !== 'unannounced') return {status: 'nothing_to_announce'};
      Object.assign(rs, {state: 'waiting', announcedAt: now()});
      await store.put(K.rescue(userId), rs);
      await log('rescue_announced', {ref: rs.ref});
      return {status: 'waiting', executeAfter: rs.executeAfter};
    },

    async rescueCancel(userId) {
      await load(userId);
      return {status: await cancelRescue(userId, 'member') ? 'cancelled' : 'nothing_to_cancel'};
    },

    async disable(userId, {stepUp} = {}) {
      const rec = await load(userId);
      if (!rec) return {error: 'not_enabled'};
      // An unconfirmed set-up can simply be abandoned; a working lock needs a fresh unlock.
      if (rec.state === 'on' && !await checkStepUp(userId, rec, stepUp)) return {error: 'unlock_required'};
      await dropAll(userId);
      await cancelRescue(userId, 'disabled');
      await log('disabled');
      return {ok: true};
    },
  };

  // The guard in front of a risky action. No lock (or not yet confirmed) → allowed. A lock → a live
  // step-up token is required and is spent, so one unlock covers exactly one risky action.
  async function requireStepUp(userId, token, action) {
    const rec = await load(userId);
    if (rec?.state !== 'on') return {ok: true, locked: false};
    if (!await checkStepUp(userId, rec, token, {consume: true})) return {ok: false, error: 'unlock_required'};
    await log('step_up_used', {action: String(action).slice(0, 20)});
    return {ok: true, locked: true};
  }

  // Owner side (/admin/membership/*): counts only, and the approval of an owner's reset.
  // Owner-side reads first move every reset whose 72 hours are over, so nothing waits on the member
  // opening the Mini App again.
  async function advanceRescues() {
    for (const r of await store.list('rescue:')) if (r.state === 'waiting' && now() >= r.executeAfter && Number.isSafeInteger(r.userId)) await load(r.userId);
  }
  async function stats() {
    await advanceRescues();
    const recs = await store.list('lock:');
    const rescues = await store.list('rescue:');
    return {on: recs.filter(r => r.state === 'on').length, pending: recs.filter(r => r.state === 'pending').length,
      hard: recs.filter(r => r.hard || r.rhard).length,
      rescues: rescues.filter(r => ACTIVE.includes(r.state)).map(r => ({ref: r.ref, state: r.state, requestedAt: r.requestedAt, executeAfter: r.executeAfter}))};
  }
  async function approveOwnerRescue(ref) {
    await advanceRescues();
    const rs = (await store.list('rescue:')).find(r => r.ref === ref);
    if (!rs) throw Error('unknown_rescue');
    if (rs.state !== 'awaiting_owner_approval') throw Error('not_awaiting_approval');
    await dropAll(rs.userId);
    Object.assign(rs, {state: 'done', doneAt: now(), approvedBy: 'owner'});
    await store.put(K.rescue(rs.userId), rs);
    await log('rescue_done', {ref, via: 'owner_approval'});
    return {status: 'done'};
  }

  return {...ops, requireStepUp, stats, approveOwnerRescue, isOwner};
}
