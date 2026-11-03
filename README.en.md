🌐 [日本語](README.md) | **English** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

Manage Telegram channels and groups through the official Bot API, and operate the owner's own account through GramJS (MTProto, `api_id` / `api_hash` from https://my.telegram.org).

Posts, replies, edits, and deletes are drafts. Channel edits, admin changes, and BotFather changes are account actions. Approving one does not send it. The publisher runs only items that are already approved and due. The local worker is a dry-run and will not start with `TELEGRAM_ALLOW_NETWORK=true` or `TELEGRAM_USER_ALLOW_NETWORK=true`.

**Version**: v0.2.0 · MIT License · TypeScript / Cloudflare Workers + D1

## What it does

- Register many bots and channels. Only the environment variable name of a token is stored
- Draft text, photo, video, album, and inline buttons
- Approval queue, scheduled publishing, and approved edits and deletes
- Member count via `getChatMemberCount`. Bot API message views stay null. The owner-account route can read `messages.getMessagesViews` without incrementing them
- Owner login, own channel list, channel edits, one-at-a-time admin changes, and a scripted BotFather exchange. Tokens and the session stay in the secret store. See [docs/user-account.md](docs/user-account.md)
- Webhook storage and reply drafts that wait for approval
- `POST /api/intake/drafts` for cross-posts from other harnesses
- MCP server and TypeScript SDK

Limits that were checked, and limits that were left unknown, are in [docs/bot-api-limits.md](docs/bot-api-limits.md). The approval steps are in [docs/approval.md](docs/approval.md). Local setup is in [docs/manual/01-local.md](docs/manual/01-local.md).

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
