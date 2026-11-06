import { serve } from "@hono/node-server";
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeSessionKey, decryptSession, SESSION_ENV_NAME } from "@telegram-harness/user-account";
import { FileSecretStore } from "@telegram-harness/user-account/file";
import { readOnlyAccountSnapshot } from "@telegram-harness/user-account/readonly";
import { authorizeBridge } from "./security.js";

// Load credentials only into the normal SecretStore/session adapter; never print
// secrets, Telegram identities, dialogs, response bodies or exception messages.
loadEnvFile(process.env.DEMO_LIVE_ENV!);
const runtime = JSON.parse(readFileSync(process.env.DEMO_RUNTIME!, "utf8")) as { bridgeKey: string; workerUrl: string; statePath: string };
const store = new FileSecretStore(process.env.TELEGRAM_SECRET_STORE_PATH!, { ...process.env });
const nonces = new Map<string, number>();
let last: Awaited<ReturnType<typeof readOnlyAccountSnapshot>> | undefined;
let pending: Promise<Awaited<ReturnType<typeof readOnlyAccountSnapshot>>> | undefined;
async function readLive() {
  if (last && Date.now() - Date.parse(last.checkedAt) < 30000) return last;
  if (pending) return pending;
  pending = (async () => {
    const encrypted = await store.get(SESSION_ENV_NAME);
    if (!encrypted) throw new Error("session_missing");
    const session = await decryptSession(encrypted, decodeSessionKey(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY));
    const value = await readOnlyAccountSnapshot({ apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH!, session });
    last = value; return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}
const server = serve({ hostname: "127.0.0.1", port: 8798, fetch: async request => {
  if (!await authorizeBridge(request, runtime.bridgeKey, nonces)) return new Response("Unauthorized", { status: 401 });
  try { return Response.json(await readLive(), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "live_read_unavailable" }, { status: 503 }); }
} });
// Quick Tunnel is a transport only. Its origin accepts just signed GET /snapshot.
// No tunnel output (which may include diagnostics) is persisted to logs.
const tunnel = spawn("/opt/homebrew/bin/cloudflared", ["tunnel", "--config", "/dev/null", "--no-autoupdate", "--url", "http://127.0.0.1:8798", "--protocol", "http2", "--metrics", "127.0.0.1:48798"], { stdio: ["ignore", "ignore", "pipe"], env: { HOME: process.env.HOME, PATH: process.env.PATH } });
let tunnelOrigin = "", buffer = "";
async function register() {
  if (!tunnelOrigin) return;
  try {
    const response = await fetch(`${runtime.workerUrl}/internal/bridge`, { method: "POST", headers: { authorization: `Bearer ${runtime.bridgeKey}` }, body: tunnelOrigin, signal: AbortSignal.timeout(15000) });
    writeFileSync(runtime.statePath, JSON.stringify({ tunnelOrigin, registered: response.ok, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    if (!response.ok) console.error("bridge registration failed");
  } catch { console.error("bridge registration unavailable"); }
}
tunnel.stderr.on("data", chunk => {
  buffer = (buffer + String(chunk)).slice(-8000);
  const match = buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/);
  if (match && !tunnelOrigin) { tunnelOrigin = match[0]; void register(); }
});
const interval = setInterval(() => { void register(); }, 300000);
let stopping = false;
function stop() { if (stopping) return; stopping = true; clearInterval(interval); tunnel.kill("SIGTERM"); server.close(); setTimeout(() => process.exit(0), 500).unref(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
tunnel.on("exit", () => { if (!stopping) { console.error("tunnel stopped; launchd will restart this service"); process.exit(1); } });
console.error("read-only demo bridge listening on loopback:8798");
