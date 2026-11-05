# Telegram Harness

[日本語](README.md) · [Capabilities (Japanese)](docs/capabilities.md) · [Architecture](docs/architecture.md) · [Definition of Done](docs/DOD.md)

A booking-focused CRM with customer identities independent of Telegram bots and channels. Unofficial project; not affiliated with Telegram or Cloudflare. MIT licensed.

Phase 1 stores customers, contacts, consent history and bookings in durable local SQLite. It exposes a management API, 14 CRM MCP tools and Kumo customer/booking pages. Losing access to a bot does not delete the ledger. Permission to message users does **not** transfer to a replacement bot: recovery candidates require a verified email/phone contact and current, explicit recontact consent.

## Implemented

- Customer create/list/detail/update, acquisition source and tags.
- Contacts, operator-recorded verification evidence and append-only purpose-specific consent/withdrawal.
- Booking slots, atomic capacity enforcement, idempotent booking and cancellation.
- Paginated customer JSON export and eligible recontact lists; no delivery.
- Kumo local operator UI; all CRM operations are available through MCP.
- Existing approval-gated publishing and encrypted owner-account session layer.

Mini Apps, Telegram Login, Stars processing, Cloud integration, public self-service booking and email delivery are later phases. Purchases have a schema only. Browser visual QA and screenshots remain pending; see [DoD](docs/DOD.md).

## Local setup

Requires Node.js >=22.13 and pnpm 9.15.4. Node SQLite is experimental.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set your own local API_KEY and TELEGRAM_LOCAL_UI=true in .env.
# Keep both ALLOW_NETWORK flags false. Real Telegram credentials are unnecessary.
set -a
source .env
set +a
pnpm dev:worker
```

Load the same environment in another terminal and run `pnpm dev:web`. Open `http://127.0.0.1:3005/crm/customers` or `/crm/bookings`. The existing publishing page is `/`.

Both servers bind to loopback (worker 8787, web 3005). The UI returns 403 unless explicitly enabled with `TELEGRAM_LOCAL_UI=true`. This is a local operator application, **not a multi-user authentication boundary**. Do not expose it to the internet or LAN. Cloud authentication and tenant isolation are future release gates.

The dry-run worker now persists to `.local/crm-dry-run.sqlite` relative to the worker directory, independently of the user-live database. Set `TELEGRAM_CRM_DB_PATH` to an absolute path to override it. Startup applies pending migrations. Follow the storage policy for your environment; this phase-2 task used internal storage only. No D1 deployment is performed.

## API and MCP

Management requests require `Authorization: Bearer <API_KEY>`. CRM endpoints start at `/api/crm/`; the intake key has no CRM access. See the [API/tool mapping](docs/architecture.md#mcp--api対応一覧).

```sh
export TELEGRAM_HARNESS_API_URL=http://127.0.0.1:8787
export TELEGRAM_HARNESS_API_KEY="$API_KEY"
pnpm --filter worker exec tsx ../../packages/mcp/src/index.ts
```

Typical tools: `crm_create_customer`, `crm_create_slot`, `crm_book`, `crm_cancel_booking`. Reuse the same `requestKey` when retrying a booking; use a new one for a new booking. Timestamps require explicit offsets, e.g. `2026-12-01T13:00:00+09:00`.

Contacts start unverified. `crm_verify_contact` records evidence of an actual operator verification; it does not send verification messages. `crm_record_consent` requires purpose, status, evidence, policy version and occurrence time. Never invent user consent. Recontact, booking and marketing purposes are independent. Withdrawals remain in the history.

`crm_export_customers` includes contacts, consents, bookings and purchases. Lists default to 50, maximum 100; continue with `after=nextCursor` until null. Exports contain personal information: keep them private and encrypted. Cross-page snapshots are not guaranteed, so pause writes or take a database backup for complete recovery. Recontact lists only identify eligible contacts; they never send messages.

## Verification

```sh
pnpm check
pnpm --filter web build
# If gitleaks is installed:
gitleaks git --redact --no-banner --log-opts=--all
```

Tests use fixtures and local SQLite, including authentication, consent withdrawal, capacity contention, replay protection, persistence and all CRM MCP operations. They do not prove live D1 or Telegram compatibility. Browser screenshots are a separate outstanding verification.

## Security and scope

Never commit `.env`, `.dev.vars`, `.local/`, databases, sessions, tokens or customer exports. Bot credentials are referenced by environment variable name. Keep management keys server-side, never in `NEXT_PUBLIC_` variables.

Spam, restriction evasion, member scraping and Japan-facing online casino promotion are unsupported. Stars requires business/product/jurisdiction/terms/refund readiness review before enablement. Phase 1 work does not send to Telegram, change channels, deploy, push or publish.

See [approval flow](docs/approval.md), [Bot API limits](docs/bot-api-limits.md), [owner-account layer](docs/user-account.md), and [security policy](SECURITY.md).

## Phase 2: local booking and phone intake

`/crm/booking-bot` provides an inline calendar, simulated `/book` and callback updates, group/topic bookings linked to CRM, staff phone intake, and mock confirmations/reminders. Five additional MCP tools use the same authenticated API. No live delivery or public Mini App is included. See [phase-2 scope and verification](docs/phase2.md), [bot capabilities](docs/bot-capabilities.md), [client research](docs/research-cn-clients.md), [npm audit](docs/security/npm-audit-20261105.md), and [SMS/phone design](docs/sms-phone.md).

Install with `pnpm install --frozen-lockfile --ignore-scripts`, run `pnpm check`, `pnpm --filter web build`, and `node scripts/phase2-http-smoke.mjs`. The latter uses localhost HTTP and synthetic data without a browser. GramJS (`telegram` on npm) is archived/deprecated; it remains isolated from the new booking path.
