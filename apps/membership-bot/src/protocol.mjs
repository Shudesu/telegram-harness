export const VERSION = 1;
export const MAX_BYTES = 4096;
export const noncePattern = /^[a-f0-9]{32}$/;
export function validatePayload(raw, catalog, version, now = Date.now()) {
  const fail = () => { throw new Error('invalid_selection'); };
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) fail();
  let p; try { p = JSON.parse(raw); } catch { fail(); }
  if (JSON.stringify(p) !== raw) fail(); // Compact JSON only; duplicate keys are rejected.
  const keys = ['v','catalog','nonce','request','industry','staff','service','slot'];
  if (!p || Array.isArray(p) || Object.keys(p).length !== keys.length || keys.some(k => !Object.hasOwn(p,k))) fail();
  if (p.v !== VERSION || p.catalog !== version || typeof p.nonce !== 'string' || !noncePattern.test(p.nonce) || typeof p.request !== 'string' || !noncePattern.test(p.request)) fail();
  if (['industry','staff','service','slot'].some(k => typeof p[k] !== 'string')) fail();
  const c = catalog.find(c => c.id === p.industry);
  const staff = c?.staff.find(x => x.id === p.staff), service = c?.services.find(x => x.id === p.service);
  if (!c || !staff || !service || !c.slots.includes(p.slot)) fail();
  // Accept exact catalog timestamps only, not equivalent UTC or client timezone conversions.
  const start = Date.parse(p.slot), delta = start - now;
  if (!p.slot.endsWith('+09:00') || !Number.isFinite(start) || delta <= 0 || delta > 31 * 86400000) fail();
  return {payload:p, industry:c, staff, service, slot:p.slot};
}
export function slotText(slot) {
  return new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', weekday:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(slot)) + ' JST';
}
export function canonicalSummary(s) {
  return `${s.industry.label}\n${s.staff.name}（AI生成の架空成人）\n${s.service.name}・${s.service.minutes}分\n${slotText(s.slot)}\n架空総額 ${s.service.yen.toLocaleString('ja-JP')}円・実請求なし`;
}
