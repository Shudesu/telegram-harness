🌐 [日本語](README.md) | **English** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

Manage Telegram channels and groups through the official Bot API. This repository does not automate user accounts and does not speak MTProto.

Posts, replies, edits, and deletes are drafts. Approving a draft does not send it. The publisher sends only drafts that are already approved and due. The local worker is a dry-run and will not start with `TELEGRAM_ALLOW_NETWORK=true`.

**Version**: v0.1.0 · MIT License · TypeScript / Cloudflare Workers + D1

## What it does

- Register many bots and channels. Only the environment variable name of a token is stored
- Draft text, photo, video, album, and inline buttons
- Approval queue, scheduled publishing, and approved edits and deletes
- Member count via `getChatMemberCount`. Message views stay null because the Bot API Message type has no views field
- Webhook storage and reply drafts that wait for approval
- `POST /api/intake/drafts` for cross-posts from other harnesses
- MCP server and TypeScript SDK

Limits that were checked, and limits that were left unknown, are in [docs/bot-api-limits.md](docs/bot-api-limits.md). The approval steps are in [docs/approval.md](docs/approval.md). Local setup is in [docs/manual/01-local.md](docs/manual/01-local.md).

```bash
pnpm install
pnpm check
pnpm --filter worker dev
```
