# Changelog

## 0.3.0

- `apps/membership-bot`: Cloudflare Workers bot for memberships, Telegram Stars payments (invoices, subscriptions, refunds), bookings, 13 widgets, Mini App (`/app/`, `/verify`), Managed Bots, `/terms` and `/paysupport`
- Its MCP has 36 tools: 19 reads and 17 `request_*` tools that only queue work for owner approval
- Stripe, KOMOJU and bank-transfer payment adapters. Every payment rule is off by default. `PAY_LIVE` gates the Mini App; the chat `/plans` checkout charges for real as soon as the checkout rule is enabled
- `pnpm check` also runs the membership-bot tests and a wrangler dry-run build
- The same features are available as a hosted service on The Harness Cloud (https://theharness.cloud)

- GramJS `requestRetries` is 1, so an MTProto call is sent once. 0 sent nothing
- `user-live` stores the queue in SQLite (mode 0600) and binds to 127.0.0.1 unless `HOST` is set
- Bot tokens are read from the secret store, then the environment
- The secret file stores only session ciphertext, login state, and bot tokens it saved

## 0.2.0

- Owner account via GramJS (MTProto), next to the Bot API
- Phone, code, and optional 2FA login. The string session is encrypted and stored only as a secret
- Create channels and supergroups, edit title, description, photo, and username, add or remove one admin
- Scripted BotFather create, profile fields, photo, token fetch, and token revoke. Token values stay in the secret store
- Own-channel list and message views via `messages.getMessagesViews` with `increment: false`
- Writes wait for the existing approval queue. Reads are rate limited. `FLOOD_WAIT` is not retried for writes
- Tests use a mocked GramJS socket. No live login and no deploy

## 0.1.0

First version of Telegram Harness.

- Multi-bot, multi-channel registration through the official Bot API only
- Drafts for text, photo, video, album, and inline buttons
- Approval queue. Publish, reply, edit, and delete wait for an explicit approve, then for the publisher
- Scheduled send of approved drafts
- Webhook storage and approved reply drafts
- Intake of cross-post drafts
- Channel member counts. Message views are reported as unavailable via Bot API
- MCP server and TypeScript SDK
- Tests against a mocked Bot API. No live sends
