# Changelog

## 0.3.4

`apps/membership-bot`: opt-in app lock for the Mini App (off by default)

- With `APP_LOCK=1` and the secret `APP_LOCK_PEPPER`, a member can turn on an app lock in the Mini App: a 6-digit passcode (simple patterns refused), an optional Face ID / fingerprint shortcut through Telegram's BiometricManager, and a `THR-` recovery code shown once and confirmed by its last 4 characters
- The lock is asked only before a cancellation or refund request (new `/app/api/request`, written as a support ticket for the owner), never when the app is opened. One unlock is good for 5 minutes and is spent by one such request
- Server-side attempt limits (5 → 1 min, then 5 min / 15 min / 1 h / 6 h, 10 → passcode refused), only hashes stored (PBKDF2 with the pepper; HMAC for codes and tokens), biometric tokens replaced on every use (derived per generation, so a replay of any earlier one is detected and revokes the device and live step-ups), single-use recovery codes
- Self-service reset when everything is lost: `/applock_reset` in the private chat (its reply is the notice), 72 hours, cancellable with `/applock_cancel`; owner ids (`APP_LOCK_OWNER_IDS`) also need `/admin/membership/lock_rescue_approve`. `lock_stats` for the owner (counts only)
- With `APP_LOCK` unset nothing changes: `/app/api/lock*` still answers 501, the page shows nothing new and the chat commands are not recognised

## 0.3.3

`apps/membership-bot`: Mini App security and UX groundwork

- One initData check for `/app/` and `/verify` (`src/membership/webapp.mjs`). Both now accept initData signed within the last hour and at most 300 s in the future (before: `/app/` 24 hours, `/verify` 1 hour with no future bound). A repeated field or a malformed hash / `auth_date` is refused
- `/app/` and `/verify` are served with a per-response CSP nonce for scripts (no `unsafe-inline` for scripts), `object-src 'none'`, `frame-ancestors` limited to Telegram Web, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a `Permissions-Policy` and HSTS. Their JSON APIs also send nosniff and `no-store`
- New `/app/` layout: home screen (member status, four round shortcuts, swipeable notices), bottom tabs (home / plans / member card / more), a bottom sheet (closes with ×, the backdrop, a swipe down or the Telegram BackButton), BackButton on sub-screens, SettingsButton, haptics, theme and safe-area following, a one-time notice and home-screen offer remembered in CloudStorage. Payment rules are unchanged
- `/verify` follows the Telegram theme and gives haptic feedback
- Reserved for a later opt-in app lock (nothing is stored or checked yet): `/app/api/lock*` answers `501 app_lock_not_available`; Durable Object keys `lock:` / `bio:` / `rescue:`; names `APP_LOCK` and `APP_LOCK_PEPPER`

## 0.3.2

`apps/membership-bot`: the two remaining known issues

- With the `join_verify` rule off, a verification Mini App the owner approves one by one now works (it answered `unknown_request`). The 3-minute answer window starts at the approval; a request left unapproved for 24 hours, or whose Mini App the owner rejects, is declined
- A Mini App purchase now matches a checkout rule scoped to the buyer, the same as the chat `/plans` purchase

## 0.3.1

`apps/membership-bot`: refund and billing-period fixes for external payments and subscriptions

- Refunding one charge of a subscription (including the first) no longer stops later renewals; a replayed payment of a refunded charge is ignored
- A refund takes back only the unused part of that charge. Used-up charges (for example after a renewal during grace) no longer shorten a newer period
- Monthly and yearly terms clamp to the last day of the month (Jan 31 → Feb 28, Feb 29 → Feb 28)
- Partial Stripe/KOMOJU refunds keep the membership and are recorded for owner review; the full refund revokes it
- Stripe payments recorded under an invoice id now also store the PaymentIntent/charge, so metadata-free refunds and disputes find the order
- Only a paid subscription of that membership starts renewal-failure grace, and repeated failures do not extend it

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
