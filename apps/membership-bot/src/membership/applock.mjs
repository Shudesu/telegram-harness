// App lock (opt-in passcode / biometrics / recovery code) — RESERVED NAMES ONLY.
//
// Nothing in this file stores, checks or unlocks anything. It fixes the names a later version will
// use so that version needs no migration and nothing else claims them:
//   * the API under /app/api/lock*, which answers 501 app_lock_not_available until then;
//   * the keys in the existing membership:<tenant> Durable Object (no new class, no migration);
//   * the switch APP_LOCK and the secret APP_LOCK_PEPPER (names only; neither is read yet).
// The app lock is an in-app lock for risky actions on this bot's own pages. It is not the 2FA /
// password of the Telegram account, which this project never touches.

export const APP_LOCK_SWITCH = 'APP_LOCK';
export const APP_LOCK_PEPPER = 'APP_LOCK_PEPPER';

export const APP_LOCK_KEYS = Object.freeze({
  // {v, algo, iter, salt, hash, fails, lockedUntil, recoveryHash, recoveryConfirmed, createdAt, updatedAt}
  lock: userId => `lock:${userId}`,
  // {tokenHash, label, type, createdAt, lastUsedAt} — one per enrolled device
  bio: (userId, deviceId) => `bio:${userId}:${deviceId}`,
  // {requestedAt, executeAfter, state} — self-service reset after a waiting period
  rescue: userId => `rescue:${userId}`,
});
export const APP_LOCK_PREFIXES = Object.freeze(['lock:', 'bio:', 'rescue:']);

export const APP_LOCK_ROUTES = Object.freeze([
  'GET /app/api/lock',
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
// Not built yet, whatever APP_LOCK says.
export const appLockAvailable = () => false;
