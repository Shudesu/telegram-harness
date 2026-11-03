# Contributing

Run `pnpm check` before opening a pull request. Tests must keep Telegram behind the mock or dry-run client.

Do not add a path that sends, edits, or deletes without `pending` → `approve` → publisher. Do not add MTProto. Do not commit env files other than `.env.example`.

Limits that are not on https://core.telegram.org/bots/api belong in `docs/bot-api-limits.md` as unknown.
