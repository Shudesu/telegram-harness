import { describe, expect, it, vi, afterEach } from "vitest";
import worker, { type Env } from "./index.js";
import { authorizeBridge, digest, escapeHtml, issueSession, sign, tunnelUrl, validSession } from "./security.js";
const origin = "https://demo.example.test";
const env = () => ({
  SESSION_KEY: "test-cookie-signing-key-only", BRIDGE_KEY: "test-bridge-signing-key-only", LOGIN_HASH: "",
  DB: { prepare: vi.fn(() => ({ bind: () => ({ all: async () => ({ results: [] }) }) })) },
  ROUTING: { get: vi.fn(async () => "https://test-read-only.trycloudflare.com"), put: vi.fn() },
  LOGIN_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
}) as unknown as Env;
async function req(path: string, options: RequestInit = {}, authenticated = false, runtime = env()) {
  const headers = new Headers(options.headers);
  if (authenticated) headers.set("cookie", `__Host-demo=${await issueSession(runtime.SESSION_KEY)}`);
  return worker.fetch(new Request(origin + path, { ...options, headers }), runtime);
}
afterEach(() => { vi.unstubAllGlobals(); });
describe("isolated demo authorization and least privilege", () => {
  it.each(["/", "/account", "/chats", "/crm/customers", "/crm/bookings", "/api/health", "/api/account", "/api/chats", "/api/crm/customers", "/mcp"])("protects %s without touching data", async path => {
    const runtime = env(); const response = await req(path, {}, false, runtime);
    expect(response.status).toBe(401); expect(runtime.ROUTING.get).not.toHaveBeenCalled(); expect(runtime.DB.prepare).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("sets a secure HttpOnly session; never returns credentials", async () => {
    const runtime = env(); runtime.LOGIN_HASH = await digest("dedicated-demo-code");
    const response = await req("/login", { method: "POST", headers: { origin }, body: "code=dedicated-demo-code" }, false, runtime);
    expect(response.status).toBe(303); expect(response.headers.get("set-cookie")).toMatch(/__Host-demo=.*HttpOnly; Secure; SameSite=Strict/);
    expect(await response.text()).not.toContain("dedicated-demo-code");
  });
  it("rejects a bad login and applies rate limiting", async () => {
    const runtime = env(); runtime.LOGIN_HASH = await digest("correct");
    expect((await req("/login", { method: "POST", headers: { origin }, body: "code=bad" }, false, runtime)).status).toBe(401);
    runtime.LOGIN_LIMIT.limit = async () => ({ success: false });
    expect((await req("/login", { method: "POST", headers: { origin }, body: "code=correct" }, false, runtime)).status).toBe(429);
  });
  it("rejects forged, expired and overly long sessions", async () => {
    expect(await validSession("key", await issueSession("key"))).toBe(true);
    expect(await validSession("wrong", await issueSession("key"))).toBe(false);
    expect(await validSession("key", await issueSession("key", Date.now() - 43300000))).toBe(false);
    expect(await validSession("key", await issueSession("key", Date.now() + 60000))).toBe(false);
    expect(await validSession("key", "shuichi.NaN.x.y")).toBe(false);
  });
  it.each(["/api/drafts", "/api/telegram/webhook/test", "/api/user/login", "/api/crm/bookings", "/mcp"])("rejects cross-origin POST %s", async path => {
    const response = await req(path, { method: "POST", headers: { origin: "https://evil.example" } }, true);
    expect(response.status).toBe(403); expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("blocks %s even for authorized users", async method => {
    expect((await req("/api/crm/customers", { method, headers: { origin } }, true)).status).toBe(403);
  });
  it("MCP exposes only read tools and refuses mutation calls", async () => {
    const response = await req("/mcp", { method: "POST", headers: { origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, true);
    const data = await response.json(); expect(data.result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    expect((await req("/mcp", { method: "POST", headers: { origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sendMessage" } }) }, true)).status).toBe(403);
  });
  it("requires separate bridge credential and restricts tunnel hosts", async () => {
    expect((await req("/internal/bridge", { method: "POST", body: "https://bad.test" }, false)).status).toBe(401);
    const runtime = env();
    expect((await req("/internal/bridge", { method: "POST", body: "https://bad.test", headers: { authorization: `Bearer ${runtime.BRIDGE_KEY}` } }, false, runtime)).status).toBe(400);
    expect(runtime.ROUTING.put).not.toHaveBeenCalled();
    for (const bad of ["http://a.trycloudflare.com", "https://a.trycloudflare.com/secret", "https://a.trycloudflare.com@evil.test", "https://127.0.0.1"]) expect(tunnelUrl(bad)).toBe(false);
  });
  it("signs only the fixed bridge read endpoint, does not forward client headers", async () => {
    const runtime = env();
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe("manual");
      const h = options.headers as Record<string, string>;
      expect(h.authorization).toBeUndefined(); expect(h.cookie).toBeUndefined();
      expect(h["x-demo-signature"]).toBe(await sign(runtime.BRIDGE_KEY, `GET\n/snapshot\n${h["x-demo-time"]}\n${h["x-demo-nonce"]}`));
      return Response.json({ source: "live-mtproto", checkedAt: new Date().toISOString(), readOnly: true, chats: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await req("/api/account", {}, true, runtime)).status).toBe(200);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://test-read-only.trycloudflare.com/snapshot");
  });
  it("does not present stale or fake responses as live", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ source: "live-mtproto", checkedAt: "2020-01-01T00:00:00Z", readOnly: true, chats: [] }));
    expect((await req("/api/account", {}, true)).status).toBe(503);
  });
  it("renders Japanese mobile HTML without script or secret injection", async () => {
    const response = await req("/", {}, true); const body = await response.text();
    expect(body).toContain('name="viewport"'); expect(body).toContain("@media(max-width:480px)"); expect(body).not.toContain("<script"); expect(body).not.toContain(env().BRIDGE_KEY);
    expect(escapeHtml('<img src=x onerror="bad">')).toBe("&lt;img src=x onerror=&quot;bad&quot;&gt;");
  });
});


describe("Mac bridge authentication", () => {
  async function signed(method = "GET", path = "/snapshot", now = Date.now(), key = "bridge-only") {
    const nonce = crypto.randomUUID(), stamp = String(now);
    return new Request(`https://tunnel.example${path}`, { method, headers: {
      "x-demo-time": stamp, "x-demo-nonce": nonce,
      "x-demo-signature": await sign(key, `GET\n/snapshot\n${stamp}\n${nonce}`),
    } });
  }
  it("accepts a fresh signed read once, rejecting concurrent replays", async () => {
    const request = await signed(), nonces = new Map<string, number>();
    const results = await Promise.all([authorizeBridge(request, "bridge-only", nonces), authorizeBridge(request, "bridge-only", nonces)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await authorizeBridge(request, "bridge-only", nonces)).toBe(false);
  });
  it("rejects expired, modified and unsigned requests", async () => {
    for (const request of [await signed("POST"), await signed("GET", "/snapshot?send=true"), await signed("GET", "/send"), await signed("GET", "/snapshot", Date.now() - 31000), await signed("GET", "/snapshot", Date.now(), "wrong-key"), new Request("https://tunnel.example/snapshot")]) {
      expect(await authorizeBridge(request, "bridge-only", new Map())).toBe(false);
    }
  });
});
