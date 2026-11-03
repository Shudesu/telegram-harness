# Telegram Harness

Official Telegram Bot API only. No MTProto, no user-account automation, no scraped sessions.

## Approval

- Creating a draft, importing one, or composing a reply must leave it `pending`.
- `approve` only moves `pending` to `scheduled`. It must not call Telegram.
- Only the publisher (HTTP `POST /api/publisher/run` or cron) may call send, edit, or delete, and only for due `scheduled` drafts.
- A failed draft is sent again only after `requeue` and a new `approve`.
- Do not add an MCP or HTTP tool whose name or body sends in one step.

## Secrets

- Store `tokenEnvName`, never the token.
- `.env.example` contains names and placeholders. Do not commit real values, and do not put them in tests, logs, or error strings.
- Redact token values before they are saved on a failed draft.
- Do not set `TELEGRAM_ALLOW_NETWORK=true` in tests, CI, wrangler vars, or the local node server.

## Unknowns

If the Bot API page does not state a limit, write "unknown" in `docs/bot-api-limits.md`. Do not copy numbers from secondary blogs into code or docs.

## Checks

```bash
pnpm check
```

That runs the secret scan, typecheck, and mocked tests. Do not deploy, do not point tests at `api.telegram.org`, and do not create a production D1.
