# Isolated read-only cloud demo

This optional deployment is separate from the regular local UI and publishing
worker. It is not a release or merge of the phase 3 branch.

- `apps/worker/wrangler.demo.jsonc` deploys only the demo gateway. It has its own
  D1 database, routing KV namespace and login rate limiter, no cron triggers,
  bot tokens, Telegram sessions or production database bindings.
- The mobile, server-rendered UI, REST reads and restricted MCP endpoint share
  server-side authorization. A dedicated owner-only login code is hashed with
  SHA-256; the code is generated with 192 bits of randomness. The password
  grants only read access to this demo. It is not the original admin API key.
- Signed `__Host-` cookies expire after 12 hours and are Secure, HttpOnly,
  SameSite=Strict. Cross-origin POSTs are rejected. HTML and JSON are no-store,
  with a restrictive CSP, no third-party assets and no client JavaScript.
- REST allows only the enumerated GET routes. MCP exposes only two read tools.
  All publishing, webhook, login-to-Telegram, CRM mutation and invite routes are
  rejected before reaching any Telegram adapter.
- `packages/user-account/src/readonly.ts` uses the existing GramJS adapter and
  project session cryptography/SecretStore. It invokes `users.GetUsers` with
  `InputUserSelf` and the existing bounded owner/admin dialog mapper. It drops
  phone numbers, access hashes, ordinary members, private users and messages.
  Telegram's dialogs response may carry last-message metadata in memory, but
  this is never returned, persisted, imported to CRM or used as synthetic data.
- The dedicated loopback Mac bridge exposes only signed GET `/snapshot`.
  Signatures bind method, path, timestamp and nonce; duplicate/concurrent replay
  and requests outside a 30-second clock window are rejected. The read result
  lives only in process memory for up to 30 seconds. Stale reads are not served
  on error; the UI explicitly shows unavailable.
- A separate Cloudflare Quick Tunnel transports only this restricted endpoint.
  A user launchd job runs the bridge and tunnel, restarts failed processes and
  registers a changed tunnel hostname through an authenticated Worker route.
  KV stores only the hostname, expires after 15 minutes and refreshes every five
  minutes. Restart routing can take about a minute to propagate. There is no
  shell busy loop. This temporary tunnel has no uptime guarantee; the Mac must
  stay online.
- CRM uses the project's `CrmRepo` over an empty isolated D1 database with the
  existing migrations. No production data or fabricated account connection is
  seeded. Customer/booking creation and notifications are disabled.

## Private deployment files

Runtime material belongs outside this public repository, under the task's
private directory (0600 files / 0700 directory). `login.txt` contains the
owner's dedicated demo code. `runtime.json` contains the bridge credential and
Worker URL; `worker-secrets.json` is passed directly to `wrangler secret bulk`.
Never display these values or add them to git. Original Telegram credentials
stay in the existing user-live environment and FileSecretStore.

## Operations

Deploy with `wrangler deploy --config apps/worker/wrangler.demo.jsonc`.
Apply migrations only to the explicitly named demo D1 database. Do not use the
production worker config. The task creates a dedicated LaunchAgent named
`local.telegram-harness.cloud-demo` with a plist under the private task folder
and a symlink in `~/Library/LaunchAgents/`.

To stop the demo bridge reversibly:

```sh
launchctl bootout gui/$(id -u)/local.telegram-harness.cloud-demo
```

To start it again, bootstrap that task's plist. Remove only its LaunchAgents
symlink to stop automatic launch at login. Stopping this job does not stop the
original loopback services on ports 8787 and 3005. The cloud UI remains gated
and displays bridge unavailability. Rotate the demo login hash and cookie key
together to invalidate all existing demo cookies.

## Verification and limits

`pnpm check` covers the original suite plus authentication, expiry, CSRF,
read-only allowlists, bridge replay, minimal adapter output and disconnect on
error/timeout. `pnpm --filter web build` validates the unchanged Next UI; the
actual demo bundle is built by Wrangler. A temporary authenticated smoke Worker
checks the real HTTPS URL from Cloudflare, including login, protected pages,
REST, MCP and denial of writes; it is deleted after the run.

Browser automation is prohibited for this task. Mobile verification uses the
actual server HTML, an iPhone User-Agent and a non-browser WeasyPrint 390px
layout approximation (including a single-column fallback for unsupported CSS
features). This does not establish real iPhone/Safari rendering or interactions.
The final private STATUS.md is the source of truth for the deployed revision,
observed results and remaining verification limits.
