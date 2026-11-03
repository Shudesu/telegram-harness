# Progress

## 0.2.0

- `packages/user-account` wraps GramJS behind a socket interface. Tests pass a fake socket and do not connect
- Login, encrypted session, secret-store bot tokens, owned-chat list, channel edits, one admin at a time, BotFather scripts, message views
- Account actions use `pending` → approve → publisher. Approve still does not call Telegram
- Harness rate limits and `FLOOD_WAIT` handling. Official MTProto ceilings remain unknown
- MCP tools use the same snake_case split (`request_*`, `approve_account_action`, `run_publisher`)
- Console section for login and the account-action queue

## 0.1.0

- pnpm monorepo: `apps/worker`, `apps/web`, `packages/db`, `packages/telegram-sdk`, `packages/sdk`, `packages/mcp`, `packages/shared`
- Register bots by environment-variable name and register channels, groups, and supergroups
- Drafts for text, photo, video, album, and inline buttons
- Approval queue. Approve does not send. Publisher sends only due `scheduled` drafts
- Edit and delete requests are themselves drafts
- Webhook intake for messages, channel posts, and a documented comment heuristic
- Reply drafts go through the same approval
- `POST /api/intake/drafts` for cross-posts from other harnesses
- `getChatMemberCount` and `getChat` when the client is live. Views stay null
- MCP tools in the same snake_case style as X Harness, including `approve_draft` and `run_publisher` as separate tools
- Tests use a dry-run client or a mocked `fetch`

## Not in this version

- Production deploy and a real D1 database
- Calling `setWebhook`
- Multipart uploads and `file_id` reuse
- Album edits
- A numeric rate-limit scheduler. The unpaid ceiling is unknown; see `docs/bot-api-limits.md`
- Automatic recovery of a draft stuck in `publishing`
- Installer package equivalent to `create-ig-harness` / `create-x-harness`

## Reference

Private `github.com/Shudesu/ig-harness` and `github.com/Shudesu/x-harness` were not readable from the build environment. The public OSS repositories `ig-harness-oss` and `x-harness-oss` were the structure and approval reference.
