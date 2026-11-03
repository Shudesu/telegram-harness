# Telegram Harness

Bot API for channel publishing. GramJS (MTProto) only for the owner's own account, behind the same approval queue. No scraped sessions, no mass DMs, no member scraping, no third-party user-account invites, no account signup. Bot API invite-link management and owner join/leave are approval-gated.

## Approval

- Creating a draft, importing one, or composing a reply must leave it `pending`.
- `approve` only moves `pending` to `scheduled`. It must not call Telegram.
- Only the publisher (HTTP `POST /api/publisher/run` or cron) may call send, edit, or delete, and only for due `scheduled` drafts.
- A failed draft is sent again only after `requeue` and a new `approve`.
- Do not add an MCP or HTTP tool whose name or body sends in one step.
- User-account writes (`request_*` then `approve_account_action` then `run_publisher`) follow the same split. Login is the owner's authentication and is not an approval item.
- Do not add mass DM, member list, invite, contact import, or `auth.SignUp` tools.

## Secrets

- Store `tokenEnvName`, never the token.
- `.env.example` contains names and placeholders. Do not commit real values, and do not put them in tests, logs, or error strings.
- Redact token values before they are saved on a failed draft.
- Do not set `TELEGRAM_ALLOW_NETWORK=true` or `TELEGRAM_USER_ALLOW_NETWORK=true` in tests, CI, wrangler vars, or the local node server.
- Session strings and bot tokens are secret-store values. Responses, logs, and tests must not print them. `.env.example` has names and placeholders only.

## Unknowns

If the Bot API page does not state a limit, write "unknown" in `docs/bot-api-limits.md`. MTProto and BotFather limits that were not re-read for this change stay "unknown" in `docs/user-account.md`. Do not copy numbers from secondary blogs into code or docs. Harness rate limits are labeled as policy.

## Checks

```bash
pnpm check
```

That runs the secret scan, typecheck, and mocked tests. Do not deploy, do not point tests at `api.telegram.org`, and do not create a production D1.

## Full API coverage

- Generic methods live in shared registries; never add arbitrary Bot or TL execution routes.
- Bot reads and owner reads are explicitly classified. getUpdates is a write because offsets acknowledge updates.
- New writes use account_actions (`bot_api_call` / `user_api_call`) and existing approval/publisher. Only the publisher calls the write dispatcher.
- Account deletion, auth/session termination, password/2FA and login-email changes remain excluded.
- Inline uploads are bounded base64, not local paths. Provider/webhook secrets use approved secret-name references.
- Tests have a network tripwire and injected transports. Regenerate the Bot snapshot only from a downloaded official document, then review policy changes.
