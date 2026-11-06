export async function digest(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
export async function sign(key: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value)));
}
function hex(buffer: ArrayBuffer): string { return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function issueSession(secret: string, now = Date.now()): Promise<string> {
  const payload = `shuichi.${Math.floor(now / 1000) + 43200}.${crypto.randomUUID()}`;
  return `${payload}.${await sign(secret, payload)}`;
}
export async function validSession(secret: string, value: string, now = Date.now()): Promise<boolean> {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "shuichi" || !/^\d+$/.test(parts[1] ?? "")) return false;
  const exp = Number(parts[1]);
  if (exp <= now / 1000 || exp > now / 1000 + 43201) return false;
  return equal(await sign(secret, parts.slice(0, 3).join(".")), parts[3] ?? "");
}
export function tunnelUrl(value: string): boolean { return /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(value); }
export function escapeHtml(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }

// Per-process nonce memory plus a short signed timestamp window prevents replay
// at the Mac origin, which never receives the browser cookie or admin API key.
export async function authorizeBridge(request: Request, key: string, nonces: Map<string, number>, now = Date.now()): Promise<boolean> {
  const url = new URL(request.url);
  const stamp = request.headers.get("x-demo-time") ?? "", nonce = request.headers.get("x-demo-nonce") ?? "";
  const signature = request.headers.get("x-demo-signature") ?? "";
  for (const [k, t] of nonces) if (now - t > 60000) nonces.delete(k);
  if (request.method !== "GET" || url.pathname !== "/snapshot" || url.search || !/^\d{13}$/.test(stamp) || Math.abs(now - Number(stamp)) > 30000 || !/^[a-f0-9-]{36}$/.test(nonce) || nonces.has(nonce) || !equal(await sign(key, `GET\n/snapshot\n${stamp}\n${nonce}`), signature)) return false;
  // Recheck after the async signature operation to reject simultaneous replay.
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, now); return true;
}
