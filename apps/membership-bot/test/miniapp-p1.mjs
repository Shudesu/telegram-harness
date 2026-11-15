// v0.3.4 Mini App P1: the opt-in app lock (passcode, biometrics, recovery code, 72-hour self-service
// reset) and the risky actions it guards. Stubs only: no network, no real token, no real pepper, no
// real chat id, nothing is sent, charged, cancelled or refunded.
import assert from 'node:assert/strict';

const TOKEN = '000000:TEST-TOKEN-NOT-REAL';
const PEPPER = 'x'.repeat(48); // a stand-in: low entropy on purpose, never a real value
const U = 70000601, V = 70000602, OWNER = 70000699;
const W = await import('../src/membership/webapp.mjs');
const L = await import('../src/membership/applock.mjs');
const {appFetch, appHtml} = await import('../src/studio/app.mjs');
const {runMembership} = await import('../src/membership/http.mjs');
const {memoryStore} = await import('../src/membership/store.mjs');
const {makeStudio, studioMatch, lockReplyText} = await import('../src/studio/flow.mjs');

const NOW = Date.UTC(2026, 10, 16, 3);
const MIN = 60e3, HOUR = 3600e3;
const sec = ms => String(Math.floor(ms / 1000));

const results = [], failures = [];
async function test(name, fn) {
  try { await fn(); results.push(name); }
  catch (err) { failures.push(name); console.error(`FAIL: ${name}\n  ${String(err?.stack ?? err).split('\n').slice(0, 8).join('\n  ')}`); }
}

// A lock on an in-memory store with a hand-moved clock; audit rows are kept to be inspected.
function rig({env = {}} = {}) {
  const store = memoryStore(), audits = [];
  const clock = {t: NOW};
  const lock = L.makeAppLock({store, env: {APP_LOCK_PEPPER: PEPPER, ...env}, now: () => clock.t, audit: async r => { audits.push(r); }});
  return {store, audits, clock, lock};
}
// A reset as the chat handler makes it: requested, then announced once the reply was delivered.
async function announced(lock, userId) { const q = await lock.rescueRequest(userId); await lock.rescueAnnounce(userId); return q; }
async function enabled(r, userId = U, passcode = '482913') {
  const s = await r.lock.setup(userId, {passcode});
  const code = s.recoveryCode;
  const c = await r.lock.confirmRecovery(userId, {last4: code.slice(-4)});
  assert.equal(c.ok, true);
  return {code, stepUp: c.stepUp};
}

// ---------------------------------------------------------------- 1. switch and passcode rules
await test('1a. off by default: APP_LOCK unset, or no MEMBERSHIP, or a short / missing pepper → not available', () => {
  assert.equal(L.appLockOn({}), false);
  assert.equal(L.appLockAvailable({}), false);
  assert.equal(L.appLockAvailable({APP_LOCK: '1', MEMBERSHIP: '1'}), false, 'no pepper');
  assert.equal(L.appLockAvailable({APP_LOCK: '1', MEMBERSHIP: '1', APP_LOCK_PEPPER: 'short'}), false, 'short pepper');
  assert.equal(L.appLockAvailable({APP_LOCK: '1', APP_LOCK_PEPPER: PEPPER}), false, 'membership off');
  assert.equal(L.appLockAvailable({APP_LOCK: '0', MEMBERSHIP: '1', APP_LOCK_PEPPER: PEPPER}), false);
  assert.equal(L.appLockAvailable({APP_LOCK: '1', MEMBERSHIP: '1', APP_LOCK_PEPPER: PEPPER}), true);
});

await test('1b. passcode: 6 digits, and not one digit repeated, a run, or a repeated pair / triple', () => {
  for (const p of ['12345', '1234567', 'abcdef', '12 456', 123456, undefined]) assert.equal(L.passcodeProblem(p), 'passcode_format', String(p));
  for (const p of ['000000', '111111', '123456', '654321', '012345', '987654', '121212', '123123', '909090']) assert.equal(L.passcodeProblem(p), 'passcode_too_simple', p);
  for (const p of ['482913', '102938', '135790', '112233']) assert.equal(L.passcodeProblem(p), null, p);
});

await test('1c. PBKDF2 stays within the Workers limit of 100 000 iterations; the ladder is 5→1m, 6→5m, 7→15m, 8→1h, 9→6h', () => {
  assert.equal(L.PBKDF2_ITER, 100000);
  assert.deepEqual([1, 4, 5, 6, 7, 8, 9].map(L.lockoutFor), [0, 0, MIN, 5 * MIN, 15 * MIN, HOUR, 6 * HOUR]);
  assert.equal(L.HARD_FAILS, 10);
});

// ---------------------------------------------------------------- 2. set-up and the recovery code
await test('2a. set-up returns a THR- recovery code once; only hashes are stored (no passcode, no code, no pepper)', async () => {
  const r = rig();
  const s = await r.lock.setup(U, {passcode: '482913'});
  assert.match(s.recoveryCode, L.RECOVERY_RE);
  assert.ok(!s.recoveryCode.startsWith('PRC-'));
  const st = await r.lock.state(U);
  assert.equal(st.on, false); assert.equal(st.pending, true);
  const dump = JSON.stringify([...r.store._map.entries()]);
  assert.ok(!dump.includes('482913'), 'passcode in clear');
  for (const part of s.recoveryCode.split('-').slice(1)) assert.ok(!dump.includes(part), 'recovery code in clear');
  assert.ok(!dump.includes(PEPPER), 'pepper stored');
  const rec = r.store._map.get(`lock:${U}`);
  assert.equal(rec.algo, 'pbkdf2-sha256/hmac-pepper'); assert.equal(rec.iter, 100000);
  assert.equal(Buffer.from(rec.salt, 'base64').length, 16);
  // A second user gets a different salt and code.
  const s2 = await r.lock.setup(V, {passcode: '482913'});
  assert.notEqual(s2.recoveryCode, s.recoveryCode);
  assert.notEqual(r.store._map.get(`lock:${V}`).hash, rec.hash);
});

await test('2b. the lock turns on only after the last 4 characters are typed back; 5 wrong tries abandon the set-up', async () => {
  const r = rig();
  const s = await r.lock.setup(U, {passcode: '482913'});
  assert.equal((await r.lock.unlock(U, {passcode: '482913'})).error, 'not_enabled', 'pending is not on');
  assert.equal((await r.lock.confirmRecovery(U, {last4: 'ZZZZ'})).error, 'wrong_last4');
  const ok = await r.lock.confirmRecovery(U, {last4: s.recoveryCode.slice(-4).toLowerCase()});
  assert.equal(ok.ok, true); assert.match(ok.stepUp, /^[0-9a-f]{64}$/);
  assert.equal((await r.lock.state(U)).on, true);
  const r2 = rig();
  await r2.lock.setup(U, {passcode: '482913'});
  for (let i = 0; i < 4; i++) assert.equal((await r2.lock.confirmRecovery(U, {last4: 'ZZZZ'})).error, 'wrong_last4');
  assert.equal((await r2.lock.confirmRecovery(U, {last4: 'ZZZZ'})).error, 'setup_abandoned');
  assert.equal(r2.store._map.has(`lock:${U}`), false);
});

await test('2c. expiry: an unconfirmed set-up is dropped after 30 minutes', async () => {
  const r = rig();
  await r.lock.setup(U, {passcode: '482913'});
  r.clock.t += 31 * MIN;
  assert.equal((await r.lock.state(U)).pending, false);
  assert.equal(r.store._map.has(`lock:${U}`), false);
});

await test('2d. with the lock on, set-up only changes the passcode and needs a fresh unlock', async () => {
  const r = rig();
  await enabled(r);
  assert.equal((await r.lock.setup(U, {passcode: '730215'})).error, 'unlock_required');
  const u = await r.lock.unlock(U, {passcode: '482913'});
  assert.deepEqual(await r.lock.setup(U, {passcode: '730215', stepUp: u.stepUp}), {ok: true, changed: true});
  assert.equal((await r.lock.unlock(U, {passcode: '482913'})).error, 'wrong_passcode');
  assert.equal((await r.lock.unlock(U, {passcode: '730215'})).ok, true);
});

// ---------------------------------------------------------------- 3. brute force
await test('3a. brute force: 1–4 wrong show what is left, 5 locks 1 min, then 5m/15m/1h/6h, 10 → passcode no longer opens it', async () => {
  const r = rig();
  await enabled(r);
  const wrong = () => r.lock.unlock(U, {passcode: '000001'});
  for (let i = 1; i <= 4; i++) { const x = await wrong(); assert.equal(x.error, 'wrong_passcode'); assert.equal(x.remaining, 5 - i); assert.equal(x.lockedUntil, null); }
  const fifth = await wrong();
  assert.equal(fifth.lockedUntil, NOW + MIN);
  // While locked even the right passcode is refused, nothing is computed and nothing is counted.
  const before = structuredClone(r.store._map.get(`lock:${U}`));
  assert.deepEqual(await r.lock.unlock(U, {passcode: '482913'}), {error: 'locked', lockedUntil: NOW + MIN});
  assert.equal(r.store._map.get(`lock:${U}`).fails, before.fails);
  const waits = [5 * MIN, 15 * MIN, HOUR, 6 * HOUR];
  for (const w of waits) {
    r.clock.t = r.store._map.get(`lock:${U}`).lockedUntil;
    const x = await wrong();
    assert.equal(x.lockedUntil, r.clock.t + w);
  }
  r.clock.t = r.store._map.get(`lock:${U}`).lockedUntil;
  const tenth = await wrong();
  assert.equal(tenth.error, 'locked_hard'); assert.equal(tenth.hard, true);
  r.clock.t += 30 * 24 * HOUR;
  assert.equal((await r.lock.unlock(U, {passcode: '482913'})).error, 'locked_hard', 'no time heals a hard lock');
  assert.equal(r.audits.filter(a => a.ev === 'unlock_failed').length, 10);
});

await test('3b. a correct passcode before the 5th miss resets the counter', async () => {
  const r = rig();
  await enabled(r);
  for (let i = 0; i < 4; i++) await r.lock.unlock(U, {passcode: '000001'});
  assert.equal((await r.lock.unlock(U, {passcode: '482913'})).ok, true);
  assert.equal((await r.lock.unlock(U, {passcode: '000001'})).remaining, 4);
});

await test('3c. the pepper is part of the hash: the same record with another pepper does not open', async () => {
  const r = rig();
  await enabled(r);
  const other = L.makeAppLock({store: r.store, env: {APP_LOCK_PEPPER: 'y'.repeat(48)}, now: () => r.clock.t});
  assert.equal((await other.unlock(U, {passcode: '482913'})).error, 'wrong_passcode');
});

// ---------------------------------------------------------------- 4. step-up tokens
await test('4a. replay: a step-up opens exactly one risky action, and only for the user it was issued to', async () => {
  const r = rig();
  await enabled(r); await enabled(r, V);
  const u = await r.lock.unlock(U, {passcode: '482913'});
  assert.deepEqual(await r.lock.requireStepUp(V, u.stepUp, 'refund'), {ok: false, error: 'unlock_required'}, 'other user');
  assert.deepEqual(await r.lock.requireStepUp(U, u.stepUp, 'refund'), {ok: true, locked: true});
  assert.deepEqual(await r.lock.requireStepUp(U, u.stepUp, 'refund'), {ok: false, error: 'unlock_required'}, 'replayed');
  assert.deepEqual(await r.lock.requireStepUp(U, undefined, 'cancel'), {ok: false, error: 'unlock_required'});
  assert.deepEqual(await r.lock.requireStepUp(U, 'f'.repeat(64), 'cancel'), {ok: false, error: 'unlock_required'});
});

await test('4b. expiry: a step-up is good for 5 minutes', async () => {
  const r = rig();
  await enabled(r);
  const u = await r.lock.unlock(U, {passcode: '482913'});
  assert.equal(u.stepUpExpiresAt, NOW + 5 * MIN);
  r.clock.t += 5 * MIN;
  assert.equal((await r.lock.requireStepUp(U, u.stepUp, 'cancel')).ok, false);
});

await test('4c. no lock (never set, or set-up not confirmed) → risky actions pass without a step-up', async () => {
  const r = rig();
  assert.deepEqual(await r.lock.requireStepUp(U, undefined, 'cancel'), {ok: true, locked: false});
  await r.lock.setup(U, {passcode: '482913'});
  assert.deepEqual(await r.lock.requireStepUp(U, undefined, 'cancel'), {ok: true, locked: false});
});

// ---------------------------------------------------------------- 5. biometrics
await test('5a. biometrics: enrolment needs an unlock; each use returns a new token; the replaced one coming back removes the device', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  assert.equal((await r.lock.bioEnroll(U, {type: 'face', label: 'iPhone'})).error, 'unlock_required');
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face', label: 'iPhone<script>'});
  assert.match(e.token, /^[0-9a-f]{12}\.0\.[0-9a-f]{64}$/);
  assert.equal(e.token.split('.')[0], e.id);
  const st = await r.lock.state(U);
  assert.deepEqual(st.devices.map(d => [d.label, d.type]), [['iPhonescript', 'face']]);
  assert.ok(!JSON.stringify([...r.store._map.values()]).includes(e.token.split('.')[2]), 'token stored in clear');
  r.clock.t += MIN;
  const u1 = await r.lock.bioUnlock(U, {token: e.token});
  assert.equal(u1.ok, true); assert.notEqual(u1.token, e.token); assert.match(u1.stepUp, /^[0-9a-f]{64}$/);
  const u2 = await r.lock.bioUnlock(U, {token: u1.token});
  assert.equal(u2.ok, true);
  // u1.token was just replaced: a copy of it is a replay → that device's enrolment is gone.
  assert.equal((await r.lock.bioUnlock(U, {token: u1.token})).error, 'bio_revoked');
  assert.equal((await r.lock.state(U)).devices.length, 0);
  assert.equal((await r.lock.bioUnlock(U, {token: u2.token})).error, 'bio_invalid', 'nothing left to open');
  assert.ok(r.audits.some(a => a.ev === 'bio_replay_revoked'));
});

await test('5b. a token works only for its own device and user; garbage is refused', async () => {
  const r = rig();
  const a = await enabled(r), b = await enabled(r, V);
  const ta = await r.lock.bioEnroll(U, {stepUp: a.stepUp, type: 'finger'});
  const tb = await r.lock.bioEnroll(V, {stepUp: b.stepUp, type: 'finger'});
  assert.equal((await r.lock.bioUnlock(V, {token: ta.token})).error, 'bio_invalid', 'another user');
  assert.equal((await r.lock.bioUnlock(U, {token: `${ta.id}.0.${tb.token.split('.')[2]}`})).error, 'bio_invalid', 'another device secret');
  assert.equal((await r.lock.bioUnlock(U, {token: ta.token.replace(/\.0\./, '.5.')})).error, 'bio_invalid', 'a future generation');
  for (const t of ['', 'x', `${ta.id}.`, 'zz.zz', null]) assert.equal((await r.lock.bioUnlock(U, {token: t})).error, 'bio_invalid');
  assert.equal((await r.lock.bioUnlock(U, {token: ta.token})).ok, true);
});

await test('5c. device change: a new phone has no token, so it unlocks with the passcode and can enrol; the old one can be removed', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const old = await r.lock.bioEnroll(U, {stepUp, type: 'face', label: 'iPhone'});
  // New phone: no biometric token there → passcode → enrol the new phone.
  const u = await r.lock.unlock(U, {passcode: '482913'});
  const neu = await r.lock.bioEnroll(U, {stepUp: u.stepUp, type: 'finger', label: 'Android'});
  assert.equal((await r.lock.state(U)).devices.length, 2);
  assert.equal((await r.lock.bioDelete(U, {id: old.id})).error, 'unlock_required');
  assert.deepEqual(await r.lock.bioDelete(U, {id: old.id, stepUp: u.stepUp}), {ok: true});
  assert.equal((await r.lock.bioUnlock(U, {token: old.token})).error, 'bio_invalid', 'lost phone no longer opens');
  assert.equal((await r.lock.bioUnlock(U, {token: neu.token})).ok, true);
});

await test('5d. at most 5 devices', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  for (let i = 0; i < 5; i++) assert.equal((await r.lock.bioEnroll(U, {stepUp, type: 'face'})).ok, true);
  assert.equal((await r.lock.bioEnroll(U, {stepUp, type: 'face'})).error, 'too_many_devices');
});

await test('5e. an enrolled device still opens after the passcode is hard-locked, and starts the counter over', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  const rec = r.store._map.get(`lock:${U}`); rec.fails = 10; rec.hard = true; r.store._map.set(`lock:${U}`, rec);
  assert.equal((await r.lock.bioUnlock(U, {token: e.token})).ok, true);
  assert.equal((await r.lock.state(U)).hard, false);
});

// ---------------------------------------------------------------- 6. recovery code
await test('6a. recovery: opens once, sets a new passcode, removes every device, shows a new code; the old code is spent', async () => {
  const r = rig();
  const {code, stepUp} = await enabled(r);
  await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  for (let i = 0; i < 10; i++) { await r.lock.unlock(U, {passcode: '000001'}); r.clock.t += 7 * HOUR; }
  assert.equal((await r.lock.state(U)).hard, true);
  assert.equal((await r.lock.recover(U, {code, passcode: '111111'})).error, 'passcode_too_simple', 'checked before the code is spent');
  const out = await r.lock.recover(U, {code: code.toLowerCase().replace(/-/g, ' '), passcode: '730215'});
  assert.equal(out.ok, true); assert.match(out.recoveryCode, L.RECOVERY_RE); assert.notEqual(out.recoveryCode, code);
  const st = await r.lock.state(U);
  assert.equal(st.hard, false); assert.equal(st.devices.length, 0);
  assert.equal((await r.lock.unlock(U, {passcode: '730215'})).ok, true);
  // Reuse of the spent code fails and counts as a wrong code.
  const again = await r.lock.recover(U, {code, passcode: '582014'});
  assert.equal(again.error, 'wrong_recovery_code');
  assert.equal(r.store._map.get(`lock:${U}`).rfails, 1);
  assert.equal((await r.lock.recover(U, {code: out.recoveryCode, passcode: '582014'})).ok, true, 'the new code works once');
});

await test('6b. wrong recovery codes climb their own ladder up to a hard stop', async () => {
  const r = rig();
  const {code} = await enabled(r);
  const bad = 'THR-AAAAA-AAAAA-AAAAA-AAAAA';
  for (let i = 1; i <= 4; i++) assert.equal((await r.lock.recover(U, {code: bad, passcode: '730215'})).error, 'wrong_recovery_code');
  const fifth = await r.lock.recover(U, {code: bad, passcode: '730215'});
  assert.equal(fifth.recoveryLockedUntil, NOW + MIN);
  assert.equal((await r.lock.recover(U, {code, passcode: '730215'})).error, 'recovery_locked', 'even the right code waits');
  const rec = r.store._map.get(`lock:${U}`); rec.rfails = 9; rec.rlockedUntil = 0; r.store._map.set(`lock:${U}`, rec);
  assert.equal((await r.lock.recover(U, {code: bad, passcode: '730215'})).error, 'recovery_locked_hard');
  assert.equal((await r.lock.recover(U, {code, passcode: '730215'})).error, 'recovery_locked_hard');
  assert.equal((await r.lock.unlock(U, {passcode: '482913'})).ok, true, 'the passcode is a separate counter');
});

// ---------------------------------------------------------------- 7. 72-hour reset
await test('7a. rescue: waits 72 hours, the lock keeps working meanwhile, then it is removed (membership untouched)', async () => {
  const r = rig();
  await enabled(r);
  await r.store.put(`ent:${U}:gold`, {userId: U, planId: 'gold', state: 'active'});
  const q = await announced(r.lock, U);
  assert.deepEqual(q, {status: 'requested', executeAfter: NOW + 72 * HOUR, owner: false});
  assert.equal((await r.lock.rescueRequest(U)).status, 'already_requested');
  r.clock.t = NOW + 72 * HOUR - 1;
  assert.equal((await r.lock.state(U)).on, true);
  assert.equal((await r.lock.state(U)).rescue.state, 'waiting');
  r.clock.t = NOW + 72 * HOUR;
  const st = await r.lock.state(U);
  assert.equal(st.on, false); assert.equal(st.rescue, null);
  assert.equal(r.store._map.has(`lock:${U}`), false);
  assert.deepEqual(await r.store.get(`ent:${U}:gold`), {userId: U, planId: 'gold', state: 'active'});
});

await test('7b. rescue cancelled within 72 hours: the lock stays; a recovery also cancels a waiting rescue', async () => {
  const r = rig();
  const {code} = await enabled(r);
  await announced(r.lock, U);
  r.clock.t += 10 * HOUR;
  assert.deepEqual(await r.lock.rescueCancel(U), {status: 'cancelled'});
  assert.deepEqual(await r.lock.rescueCancel(U), {status: 'nothing_to_cancel'});
  r.clock.t += 100 * HOUR;
  assert.equal((await r.lock.state(U)).on, true);
  await announced(r.lock, U);
  await r.lock.recover(U, {code, passcode: '730215'});
  r.clock.t += 80 * HOUR;
  assert.equal((await r.lock.state(U)).on, true);
  assert.ok(r.audits.some(a => a.ev === 'rescue_cancelled'));
});

await test('7c. an owner\'s rescue goes to the approval queue after 72 hours; the owner approves it by reference', async () => {
  const r = rig({env: {APP_LOCK_OWNER_IDS: ` ${OWNER} , junk`}});
  await enabled(r, OWNER);
  assert.equal((await announced(r.lock, OWNER)).owner, true);
  r.clock.t += 73 * HOUR;
  const st = await r.lock.state(OWNER);
  assert.equal(st.on, true); assert.equal(st.rescue.state, 'awaiting_owner_approval');
  const stats = await r.lock.stats();
  assert.equal(stats.rescues.length, 1);
  assert.ok(!JSON.stringify(stats).includes(String(OWNER)), 'no user id for the owner side');
  await assert.rejects(r.lock.approveOwnerRescue('LR999'), /unknown_rescue/);
  assert.deepEqual(await r.lock.approveOwnerRescue(stats.rescues[0].ref), {status: 'done'});
  assert.equal((await r.lock.state(OWNER)).on, false);
  await assert.rejects(r.lock.approveOwnerRescue(stats.rescues[0].ref), /not_awaiting_approval/);
});

await test('7d. no lock → nothing to reset', async () => {
  const r = rig();
  assert.deepEqual(await r.lock.rescueRequest(U), {status: 'no_lock'});
});

await test('7e. disable needs a fresh unlock; an unconfirmed set-up can be dropped without one', async () => {
  const r = rig();
  await r.lock.setup(V, {passcode: '482913'});
  assert.deepEqual(await r.lock.disable(V, {}), {ok: true});
  const {stepUp} = await enabled(r);
  await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  assert.equal((await r.lock.disable(U, {})).error, 'unlock_required');
  assert.deepEqual(await r.lock.disable(U, {stepUp}), {ok: true});
  assert.equal([...r.store._map.keys()].filter(k => k.startsWith(`bio:${U}:`) || k === `lock:${U}`).length, 0);
});

await test('7f. audit rows never hold a passcode, code, token or user id', async () => {
  const r = rig();
  const {code, stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  await r.lock.unlock(U, {passcode: '000001'});
  await r.lock.bioUnlock(U, {token: e.token});
  await announced(r.lock, U);
  await r.lock.recover(U, {code, passcode: '730215'});
  const dump = JSON.stringify(r.audits);
  for (const s of ['482913', '730215', '000001', code, e.token.split('.')[2], stepUp, String(U)]) assert.ok(!dump.includes(s), s);
  assert.ok(r.audits.every(a => a.kind === 'app_lock'));
});

await test('7g. (review) confirming a code after a recovery gives no step-up and stops after 5 wrong tries', async () => {
  const r = rig();
  const {code} = await enabled(r);
  const out = await r.lock.recover(U, {code, passcode: '730215'});
  const bad = out.recoveryCode.endsWith('AAAA') ? 'BBBB' : 'AAAA';
  for (let i = 0; i < 5; i++) assert.equal((await r.lock.confirmRecovery(U, {last4: bad})).error, 'wrong_last4');
  assert.equal((await r.lock.confirmRecovery(U, {last4: out.recoveryCode.slice(-4)})).error, 'too_many_tries');
  assert.equal((await r.lock.state(U)).on, true, 'the lock stays');
  const r2 = rig();
  const e2 = await enabled(r2);
  const o2 = await r2.lock.recover(U, {code: e2.code, passcode: '730215'});
  const c2 = await r2.lock.confirmRecovery(U, {last4: o2.recoveryCode.slice(-4)});
  assert.deepEqual(c2, {ok: true});
});

await test('7h. (review) a recovery revokes every step-up issued before it', async () => {
  const r = rig();
  const {code, stepUp} = await enabled(r);
  const out = await r.lock.recover(U, {code, passcode: '730215'});
  assert.equal((await r.lock.requireStepUp(U, stepUp, 'refund')).ok, false);
  assert.equal((await r.lock.requireStepUp(U, out.stepUp, 'refund')).ok, true);
});

await test('7i. (review) a reset requested for an old lock never removes a newer one (disable / new set-up cancel it)', async () => {
  const r = rig();
  const e = await enabled(r);
  await announced(r.lock, U);
  await r.lock.disable(U, {stepUp: e.stepUp});
  await enabled(r);
  r.clock.t += 73 * HOUR;
  assert.equal((await r.lock.state(U)).on, true);
  // Expired pending set-up path: the rescue is cancelled by the new set-up too.
  const r2 = rig();
  await enabled(r2);
  await announced(r2.lock, U);
  const rec = r2.store._map.get(`lock:${U}`); r2.store._map.delete(`lock:${U}`);
  await enabled(r2);
  r2.clock.t += 73 * HOUR;
  assert.equal((await r2.lock.state(U)).on, true);
  assert.ok(rec);
});

await test('7j. (review) an owner: recovery cancels a queued reset; the owner side sees a due reset without the member reopening', async () => {
  const r = rig({env: {APP_LOCK_OWNER_IDS: String(OWNER)}});
  const e = await enabled(r, OWNER);
  await announced(r.lock, OWNER);
  r.clock.t += 73 * HOUR;
  // Nobody opened the Mini App: stats still moves it to the queue and approval works.
  const st = await r.lock.stats();
  assert.equal(st.rescues[0].state, 'awaiting_owner_approval');
  assert.deepEqual(await r.lock.approveOwnerRescue(st.rescues[0].ref), {status: 'done'});
  const r2 = rig({env: {APP_LOCK_OWNER_IDS: String(OWNER)}});
  const e2 = await enabled(r2, OWNER);
  await announced(r2.lock, OWNER);
  r2.clock.t += 73 * HOUR;
  await r2.lock.state(OWNER);
  await r2.lock.recover(OWNER, {code: e2.code, passcode: '730215'});
  assert.deepEqual((await r2.lock.stats()).rescues, []);
  assert.ok(e);
});

await test('7k. (review) a replayed biometric token also withdraws the step-ups already issued', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  const thief = await r.lock.bioUnlock(U, {token: e.token});      // the copy is used first
  assert.equal((await r.lock.bioUnlock(U, {token: e.token})).error, 'bio_revoked'); // the real device comes back
  assert.equal((await r.lock.requireStepUp(U, thief.stepUp, 'cancel')).ok, false);
  assert.equal((await r.lock.disable(U, {stepUp: thief.stepUp})).error, 'unlock_required');
});

await test('7l. (review) replaying any earlier token of a device (not only the last one) revokes it', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  const a = await r.lock.bioUnlock(U, {token: e.token});
  const b = await r.lock.bioUnlock(U, {token: a.token});       // the copy rotated twice
  assert.equal((await r.lock.bioUnlock(U, {token: e.token})).error, 'bio_revoked');
  assert.equal((await r.lock.bioUnlock(U, {token: b.token})).error, 'bio_invalid', 'the copy\'s successor is dead too');
  assert.equal((await r.lock.requireStepUp(U, b.stepUp, 'cancel')).ok, false);
});

await test('7m. (review) removing a device withdraws the step-ups already issued', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  const lost = await r.lock.bioUnlock(U, {token: e.token});       // the lost phone unlocked minutes ago
  const mine = await r.lock.unlock(U, {passcode: '482913'});
  assert.deepEqual(await r.lock.bioDelete(U, {id: e.id, stepUp: mine.stepUp}), {ok: true});
  assert.equal((await r.lock.disable(U, {stepUp: lost.stepUp})).error, 'unlock_required');
  assert.equal((await r.lock.requireStepUp(U, mine.stepUp, 'cancel')).ok, false, 'a fresh unlock is needed');
});

await test('7n. (review) a copy rotated 100 times is still caught when the original comes back', async () => {
  const r = rig();
  const {stepUp} = await enabled(r);
  const e = await r.lock.bioEnroll(U, {stepUp, type: 'face'});
  let t = e.token;
  for (let i = 0; i < 100; i++) t = (await r.lock.bioUnlock(U, {token: t})).token;
  assert.equal((await r.lock.bioUnlock(U, {token: e.token})).error, 'bio_revoked');
  assert.equal((await r.lock.bioUnlock(U, {token: t})).error, 'bio_invalid');
  const dump = JSON.stringify([...r.store._map.values()]);
  assert.ok(dump.length < 4000, 'nothing grows with rotations');
});

await test('7o. (review) an id made an owner while its reset waits still goes through owner approval', async () => {
  const store = memoryStore(), clock = {t: NOW};
  const before = L.makeAppLock({store, env: {APP_LOCK_PEPPER: PEPPER}, now: () => clock.t});
  const s = await before.setup(OWNER, {passcode: '482913'});
  await before.confirmRecovery(OWNER, {last4: s.recoveryCode.slice(-4)});
  await announced(before, OWNER);
  clock.t += 73 * HOUR;
  const after = L.makeAppLock({store, env: {APP_LOCK_PEPPER: PEPPER, APP_LOCK_OWNER_IDS: String(OWNER)}, now: () => clock.t});
  const st = await after.state(OWNER);
  assert.equal(st.on, true); assert.equal(st.rescue.state, 'awaiting_owner_approval');
});

await test('7p. (review) a reset whose notice was never confirmed stays inactive; the next request replaces it', async () => {
  const r = rig();
  await enabled(r);
  const q = await r.lock.rescueRequest(U);          // reply lost: no rescueAnnounce
  assert.equal(q.status, 'requested');
  assert.equal((await r.lock.state(U)).rescue, null);
  r.clock.t += 100 * HOUR;
  assert.equal((await r.lock.state(U)).on, true, 'never runs');
  assert.deepEqual(await r.lock.rescueCancel(U), {status: 'nothing_to_cancel'});
  const q2 = await announced(r.lock, U);
  assert.equal(q2.executeAfter, r.clock.t + 72 * HOUR, 'counted from the new request');
  assert.deepEqual(await r.lock.rescueAnnounce(U), {status: 'nothing_to_announce'}, 'idempotent');
  r.clock.t += 72 * HOUR;
  assert.equal((await r.lock.state(U)).on, false);
});

// ---------------------------------------------------------------- 8. HTTP routes (/app/api/lock*, /app/api/request)
// A CHAT namespace whose membership object runs the real runMembership on a Map-backed storage.
function objects(env) {
  const storage = new Map();
  const ds = {get: async k => structuredClone(storage.get(k)), put: async (k, v) => { storage.set(k, structuredClone(v)); },
    delete: async k => storage.delete(k), list: async ({prefix}) => new Map([...storage.entries()].filter(([k]) => k.startsWith(prefix)).sort())};
  const calls = [];
  env.CHAT = {getByName: name => ({
    membership: async (op, ...args) => { calls.push({name, op, args}); return runMembership(ds, env, op, args); },
    studioApp: async () => null,
  })};
  return {storage, calls};
}
const ON = () => ({BOT_TOKEN: TOKEN, MEMBERSHIP: '1', APP_LOCK: '1', APP_LOCK_PEPPER: PEPPER});
const init = (userId = U, at = Date.now()) => W.signInitData({auth_date: sec(at), user: JSON.stringify({id: userId, first_name: 'T'})}, TOKEN);
const call = async (env, path, body = {}, method = 'POST', {now = Date.now()} = {}) => {
  const r = await appFetch(new Request(`https://w.invalid${path}`, {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), env, {now});
  return {status: r.status, body: await r.json().catch(() => null), headers: r.headers};
};

await test('8a. switch off: lock routes answer 501 as in v0.3.3, /app/api/request does not exist, /state has no lock field', async () => {
  const env = {BOT_TOKEN: TOKEN, MEMBERSHIP: '1', APP_LOCK_PEPPER: PEPPER};
  const {calls} = objects(env);
  for (const [m, p] of [['POST', '/app/api/lock'], ['POST', '/app/api/lock/setup'], ['DELETE', '/app/api/lock/bio/aaaaaaaaaaaa'], ['DELETE', '/app/api/lock/rescue']]) {
    const r = await call(env, p, {initData: await init()}, m);
    assert.equal(r.status, 501); assert.deepEqual(r.body, {error: 'app_lock_not_available'});
  }
  assert.equal((await call(env, '/app/api/request', {initData: await init(), kind: 'cancel'})).status, 404);
  const st = await call(env, '/app/api/state', {initData: await init()});
  assert.equal(st.status, 200); assert.equal('lock' in st.body, false);
  assert.equal(calls.filter(c => ['app_lock', 'app_request'].includes(c.op)).length, 0);
});

await test('8b. switch on without a usable pepper → 503 app_lock_not_configured, nothing stored', async () => {
  const env = {BOT_TOKEN: TOKEN, MEMBERSHIP: '1', APP_LOCK: '1'};
  const {storage} = objects(env);
  const r = await call(env, '/app/api/lock', {initData: await init()});
  assert.equal(r.status, 503); assert.deepEqual(r.body, {error: 'app_lock_not_configured'});
  assert.equal(storage.size, 0);
});

await test('8c. the whole flow over HTTP: set-up → confirm → biometrics → request guarded by a single-use unlock', async () => {
  const env = ON();
  const {storage} = objects(env);
  const id = await init();
  const st0 = await call(env, '/app/api/state', {initData: id});
  assert.deepEqual(st0.body.lock, {available: true});
  assert.equal((await call(env, '/app/api/lock', {initData: id})).body.on, false);
  // Without a lock a request goes straight through (a support ticket).
  const free = await call(env, '/app/api/request', {initData: id, kind: 'refund', text: '二重に払いました'});
  assert.equal(free.status, 200); assert.match(free.body.id, /^T\d+$/);
  const s = await call(env, '/app/api/lock/setup', {initData: id, passcode: '482913'});
  assert.equal(s.status, 200); assert.match(s.body.recoveryCode, L.RECOVERY_RE);
  assert.equal(s.headers.get('cache-control'), 'no-store');
  const c = await call(env, '/app/api/lock/confirm-recovery', {initData: id, last4: s.body.recoveryCode.slice(-4)});
  assert.equal(c.status, 200);
  const e = await call(env, '/app/api/lock/bio/enroll', {initData: id, stepUp: c.body.stepUp, type: 'face', label: 'iPhone'});
  assert.equal(e.status, 200);
  // Locked now: a request without an unlock is refused with 403.
  const no = await call(env, '/app/api/request', {initData: id, kind: 'cancel'});
  assert.equal(no.status, 403); assert.deepEqual(no.body, {error: 'unlock_required'});
  const b = await call(env, '/app/api/lock/bio/unlock', {initData: id, token: e.body.token});
  assert.equal(b.status, 200);
  const yes = await call(env, '/app/api/request', {initData: id, kind: 'cancel', text: '来月から不要です', stepUp: b.body.stepUp});
  assert.equal(yes.status, 200);
  const replay = await call(env, '/app/api/request', {initData: id, kind: 'cancel', stepUp: b.body.stepUp});
  assert.equal(replay.status, 403, 'the same unlock cannot be used twice');
  const tickets = [...storage.entries()].filter(([k]) => k.startsWith('ticket:')).map(([, v]) => v.text);
  assert.deepEqual(tickets, ['【返金申請】 二重に払いました（Mini App から）', '【解約申請】 来月から不要です（Mini App から・アプリロック解錠済み）']);
  assert.equal((await call(env, '/app/api/request', {initData: id, kind: 'transfer', stepUp: 'x'})).status, 400, 'unknown kind');
});

await test('8d. the user is the one initData was signed for: a userId in the body is ignored; expired initData → 401', async () => {
  const env = ON();
  const {calls} = objects(env);
  await call(env, '/app/api/lock/setup', {initData: await init(U), passcode: '482913', userId: V});
  const c = calls.find(x => x.op === 'app_lock');
  assert.equal(c.args[0], 'setup');
  assert.equal(c.args[1], U);
  assert.deepEqual(Object.keys(c.args[2]).sort(), ['passcode']);
  const old = await call(env, '/app/api/lock/unlock', {initData: await init(U, Date.now() - 2 * HOUR), passcode: '482913'});
  assert.equal(old.status, 401);
  assert.equal((await call(env, '/app/api/lock', {})).status, 401);
});

await test('8e. status codes: wrong → 400 with what is left, locked → 423, the reset only from the chat → 409', async () => {
  const env = ON();
  objects(env);
  const id = await init();
  const s = await call(env, '/app/api/lock/setup', {initData: id, passcode: '482913'});
  await call(env, '/app/api/lock/confirm-recovery', {initData: id, last4: s.body.recoveryCode.slice(-4)});
  for (let i = 0; i < 4; i++) assert.equal((await call(env, '/app/api/lock/unlock', {initData: id, passcode: '000001'})).status, 400);
  const fifth = await call(env, '/app/api/lock/unlock', {initData: id, passcode: '000001'});
  assert.equal(fifth.status, 400); assert.ok(fifth.body.lockedUntil > Date.now());
  assert.equal((await call(env, '/app/api/lock/unlock', {initData: id, passcode: '482913'})).status, 423);
  const r = await call(env, '/app/api/lock/rescue', {initData: id});
  assert.equal(r.status, 409); assert.deepEqual(r.body, {error: 'use_chat_command', command: '/applock_reset'});
  assert.equal((await call(env, '/app/api/lock/bio/zz', {initData: id}, 'DELETE')).status, 404);
  assert.equal((await call(env, '/app/api/lock/nothing', {initData: id})).status, 404);
});

await test('8f. admin side: lock_stats are counts without user ids; lock ops are refused with the switch off', async () => {
  const env = ON();
  const {storage} = objects(env);
  const id = await init();
  const s = await call(env, '/app/api/lock/setup', {initData: id, passcode: '482913'});
  await call(env, '/app/api/lock/confirm-recovery', {initData: id, last4: s.body.recoveryCode.slice(-4)});
  const ds = {get: async k => storage.get(k), put: async (k, v) => storage.set(k, v), delete: async k => storage.delete(k), list: async ({prefix}) => new Map([...storage.entries()].filter(([k]) => k.startsWith(prefix)))};
  const stats = await runMembership(ds, env, 'admin', ['lock_stats', {}]);
  assert.deepEqual(stats, {on: 1, pending: 0, hard: 0, rescues: []});
  await assert.rejects(runMembership(ds, {...env, APP_LOCK: '0'}, 'admin', ['lock_stats', {}]), /app_lock_not_available/);
  await assert.rejects(runMembership(ds, {...env, APP_LOCK: '0'}, 'app_lock', ['state', U, {}]), /app_lock_not_available/);
});

// ---------------------------------------------------------------- 9. chat: /applock_reset and /applock_cancel
await test('9a. the reset commands are recognised only while the lock is available; otherwise they go where they always went', () => {
  const u = text => ({update_id: 1, message: {message_id: 1, date: 1, chat: {id: U, type: 'private'}, from: {id: U, is_bot: false}, text}});
  const g = {optins: {}, sessions: {}};
  assert.equal(studioMatch(u('/applock_reset'), {}, g), false);
  assert.equal(studioMatch(u('/applock_reset'), {}, g, {lock: false}), false);
  assert.equal(studioMatch(u('/applock_reset'), {}, g, {lock: true}), true);
  assert.equal(studioMatch(u('/applock_cancel@teleharness_bot'), {}, g, {lock: true}), true);
  assert.equal(studioMatch(u('/applock_resetx'), {}, g, {lock: true}), false);
});

await test('9b. the only Bot message is the reply to the member\'s own command, with the time and how to cancel', async () => {
  const sent = [];
  const g = {optins: {}, sessions: {}}, t = {last: {}};
  const io = {now: () => NOW, call: async (method, params) => { sent.push({method, params}); return {message_id: 9, chat: {id: params.chat_id}}; }, persist: () => {}};
  const asked = [];
  const h = {BOT: 1, keyOf: id => `${id}:${id}`, bind: () => {}, appLock: async (op, userId) => { asked.push([op, userId]); return op === 'rescueRequest' ? {status: 'requested', executeAfter: NOW + 72 * HOUR, owner: false} : {status: 'cancelled'}; }};
  const studio = makeStudio(g, t, io, h);
  const msg = text => ({message_id: 5, date: Math.floor(NOW / 1000), chat: {id: U, type: 'private'}, from: {id: U, is_bot: false}, text});
  assert.deepEqual(await studio.onText(msg('/applock_reset')), {handled: 'applock_reset'});
  assert.deepEqual(await studio.onText(msg('/applock_cancel')), {handled: 'applock_cancel'});
  assert.deepEqual(asked, [['rescueRequest', U], ['rescueAnnounce', U], ['rescueCancel', U]]);
  assert.ok(g.optins[`${U}:${U}`], 'the command itself is consent to the reply (also after /stop)');
  assert.equal(sent.length, 2);
  assert.ok(sent.every(s => s.method === 'sendMessage' && s.params.chat_id === U));
  assert.match(sent[0].params.text, /2026\/11\/19 12:00（日本時間） 以降/);
  assert.match(sent[0].params.text, /\/applock_cancel/);
  assert.match(sent[0].params.text, /会員資格・注文はそのまま/);
  assert.match(sent[1].params.text, /取り消しました/);
  // Switch off: the studio never receives these commands (9a), so nothing about a reset is sent.
});

await test('9d. (review) if the notice cannot be sent, the reset is never announced (so it never runs)', async () => {
  const g = {optins: {}, sessions: {}}, t = {last: {}};
  const io = {now: () => NOW, call: async () => { throw Object.assign(Error('bot_api_error'), {code: 429}); }, persist: () => {}};
  const asked = [];
  const h = {BOT: 1, keyOf: id => `${id}:${id}`, bind: () => {}, appLock: async op => { asked.push(op); return op === 'rescueRequest' ? {status: 'requested', executeAfter: NOW + 72 * HOUR} : {status: 'cancelled'}; }};
  const studio = makeStudio(g, t, io, h);
  const msg = {message_id: 5, date: Math.floor(NOW / 1000), chat: {id: U, type: 'private'}, from: {id: U, is_bot: false}, text: '/applock_reset'};
  await assert.rejects(studio.onText(msg), /bot_api_error/);
  assert.deepEqual(asked, ['rescueRequest']);
  // An earlier reset (already_requested) is left alone: it was announced when it was made.
  asked.length = 0;
  const h2 = {...h, appLock: async op => { asked.push(op); return {status: 'already_requested', executeAfter: NOW}; }};
  await assert.rejects(makeStudio(g, t, io, h2).onText(msg), /bot_api_error/);
  assert.deepEqual(asked, ['rescueRequest']);
  // The request itself failing → "not accepted", and an earlier announced reset is not touched.
  asked.length = 0;
  const sent = [];
  const io3 = {...io, call: async (m, p) => { sent.push(p.text); return {}; }};
  const h3 = {...h, appLock: async op => { asked.push(op); if (op === 'rescueRequest') throw Error('storage'); return {status: 'cancelled'}; }};
  assert.deepEqual(await makeStudio(g, t, io3, h3).onText(msg), {handled: 'applock_reset'});
  assert.deepEqual(asked, ['rescueRequest']);
  assert.match(sent[0], /受け付けられませんでした/);
});

await test('9e. (review) rescueRequest writes the reset last: a failure before it leaves nothing active', async () => {
  const r = rig();
  await enabled(r);
  const lock = L.makeAppLock({store: r.store, env: {APP_LOCK_PEPPER: PEPPER}, now: () => r.clock.t, audit: async () => { throw Error('audit down'); }});
  await assert.rejects(lock.rescueRequest(U), /audit down/);
  assert.equal(r.store._map.get(`rescue:${U}`).state, 'unannounced', 'stored but inactive');
  r.clock.t += 73 * HOUR;
  assert.equal((await r.lock.state(U)).on, true);
});

await test('9f. (review) activation failing twice: the member is told the outcome is unknown, where to check, how to resend or cancel', async () => {
  const g = {optins: {}, sessions: {}}, t = {last: {}}, sent = [], asked = [];
  const io = {now: () => NOW, call: async (m, p) => { sent.push(p.text); return {}; }, persist: () => {}};
  const h = {BOT: 1, keyOf: id => `${id}:${id}`, bind: () => {}, appLock: async op => { asked.push(op); if (op === 'rescueAnnounce') throw Error('rpc'); return {status: 'requested', executeAfter: NOW + 72 * HOUR}; }};
  const msg = {message_id: 5, date: Math.floor(NOW / 1000), chat: {id: U, type: 'private'}, from: {id: U, is_bot: false}, text: '/applock_reset'};
  await makeStudio(g, t, io, h).onText(msg);
  assert.deepEqual(asked, ['rescueRequest', 'rescueAnnounce', 'rescueAnnounce']);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /確認できませんでした/);
  assert.match(sent[1], /\/applock_reset/);
  assert.match(sent[1], /\/applock_cancel/);
});

await test('9c. reply texts for every outcome', () => {
  assert.match(lockReplyText('applock_reset', {status: 'requested', executeAfter: NOW, owner: true}), /運営の承認を経てから/);
  assert.match(lockReplyText('applock_reset', {status: 'already_requested', executeAfter: NOW}), /受付済み/);
  assert.equal(lockReplyText('applock_reset', {status: 'no_lock'}), 'アプリロックは設定されていません。');
  assert.equal(lockReplyText('applock_cancel', {status: 'nothing_to_cancel'}), '取り消す申請はありません。');
  assert.match(lockReplyText('applock_reset', null), /受け付けられませんでした/);
});

// ---------------------------------------------------------------- 10. the page
await test('10a. the page carries the lock screens behind lock.available, own wording, the THR- prefix and no PRC-', () => {
  const html = appHtml('n0nce');
  for (const s of ['BiometricManager', 'updateBiometricToken', 'lock/bio/unlock', 'lock/confirm-recovery', 'showConfirm', 'S.data.lock', '/applock_reset', 'THR-']) assert.ok(html.includes(s), s);
  assert.ok(!/PRC-|Pintopay/i.test(html));
  // The passcode and codes are never written to storage on the page; only the device id is.
  assert.ok(!/localStorage\.setItem\([^)]*(passcode|code|token|stepUp)/i.test(html));
  assert.ok(!/CloudStorage\.setItem\([^)]*(passcode|code|token)/i.test(html));
  const js = html.split('<script nonce="n0nce">')[1].split('</script>')[0];
  new Function(js); // parses
  assert.ok(!js.includes('\\'), 'no backslash escapes lost in the template literal');
});

console.log(JSON.stringify({suite: 'miniapp-p1', passed: results.length, failed: failures}, null, 1));
if (failures.length) process.exit(1);
