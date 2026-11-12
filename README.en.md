🌐 [日本語](README.md) | **English** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

Manage Telegram channels and groups through the official Bot API, and operate the owner's own account through GramJS (MTProto, `api_id` / `api_hash` from https://my.telegram.org).

Posts, replies, edits, and deletes are drafts. Channel edits, admin changes, and BotFather changes are account actions. Approving one does not send it. The publisher runs only items that are already approved and due. The local worker is a dry-run and will not start with `TELEGRAM_ALLOW_NETWORK=true` or `TELEGRAM_USER_ALLOW_NETWORK=true`.

**Version**: v0.3.0 · MIT License · TypeScript / Cloudflare Workers + D1

## What it does

- Register many bots and channels. Only the environment variable name of a token is stored
- Draft text, photo, video, album, and inline buttons
- Approval queue, scheduled publishing, and approved edits and deletes
- Member count via `getChatMemberCount`. Bot API message views stay null. The owner-account route can read `messages.getMessagesViews` without incrementing them
- Owner login, own channel list, channel edits, one-at-a-time admin changes, and a scripted BotFather exchange. Tokens and the session stay in the secret store. See [docs/user-account.md](docs/user-account.md)
- Webhook storage and reply drafts that wait for approval
- `POST /api/intake/drafts` for cross-posts from other harnesses
- MCP server and TypeScript SDK

## Memberships, Stars payments, bookings, widgets, Mini App and MCP (36 tools)

`apps/membership-bot` is a Cloudflare Workers app (JavaScript, one Durable Object per chat) that turns a Telegram bot into a shop's front desk. It deploys as its own Worker, separate from the approval-queue worker above. Setup is in [apps/membership-bot/README.md](apps/membership-bot/README.md).

- **Memberships** (`MEMBERSHIP=1`): join-request approval, removal on expiry / grace / cancel, verification Mini App (`/verify`). Every rule is off by default
- **Stars payments**: three plans, Stars invoices and auto-renewing subscriptions. Nothing is sold until you register plans and enable the checkout rule. `PAY_LIVE=1` switches the Mini App to real invoices; the chat `/plans` checkout charges for real as soon as the checkout rule is on. Stripe, KOMOJU and bank-transfer adapters are pluggable
- **Bookings**: business → menu → staff → time → confirm inside one card (demo data, AI-generated fictional staff)
- **Widgets**: 13 rich-message widgets, a `/widgets` gallery, a 6-step `/start` tour, and Managed Bots (`/newbot`)
- **Mini App**: `/app/` (membership and payment) and `/verify` (verification)
- **MCP (36 tools)**: `POST /mcp`. 19 read tools answer at once; 17 `request_*` tools only queue sends, refunds, kicks and setting changes for owner approval. Output never includes user or chat ids

Before selling with Stars, fill in `/terms` (terms and the Japanese 特定商取引法 notice) and `/paysupport` (payment support desk) with your own seller details. See [apps/membership-bot/README.md](apps/membership-bot/README.md#stars-payments-before-going-live).

```bash
pnpm test:membership-bot     # Node-only tests
pnpm build:membership-bot    # wrangler dry-run build (no deploy)
```

### Self-host or use the cloud

The same features are available as a hosted service on **The Harness Cloud (https://theharness.cloud)**. Deploy this repository (OSS) to your own Cloudflare account if you want to run the servers and secrets yourself, or use the hosted version if you want it operated for you.

## Local

Limits that were checked, and limits that were left unknown, are in [docs/bot-api-limits.md](docs/bot-api-limits.md). The approval steps are in [docs/approval.md](docs/approval.md). Local setup is in [docs/manual/01-local.md](docs/manual/01-local.md).

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
