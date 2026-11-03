# Approval flow

Nothing in this service posts, replies, edits, or deletes on Telegram inside the call that composes the draft.

1. `create_draft`, `intake_draft`, `create_reply_draft`, `request_message_edit`, or `request_message_delete` stores `pending`.
2. `approve_draft` (`POST /api/drafts/:id/approve`) is the explicit approval. It changes `pending` to `scheduled` and does not call the Bot API. Any other status returns `409` and `Draft is not pending`, matching the X Harness growth-draft route.
3. `run_publisher` or the worker cron sends only rows that are already `scheduled` and whose `scheduledAt` is null or due. A future `scheduledAt` waits.
4. `reject_draft` sets `rejected`. The publisher ignores it.
5. A failed send stays `failed`. `POST /api/drafts/:id/requeue` returns it to `pending`. It needs a new approval before another send.

`POST /api/drafts/:id/cancel` moves `scheduled` back to `pending` before the publisher claims it.

The local node server uses a dry-run client. It records the method it would have called and stores `dryRun: true`. It does not open a connection to `api.telegram.org`. The worker process does that only when `TELEGRAM_ALLOW_NETWORK=true`, which is not the default and is not set by the local server.

User-account writes use the same queue with a separate row type. `request_create_channel` and the other `request_*` tools store `pending`. `approve_account_action` moves that row to `scheduled` and does not call GramJS. `run_publisher` executes due account actions. Login is not an approval item. See `docs/user-account.md`.

## Generic API operations

`request_bot_api` and `request_user_api` store `bot_api_call` and `user_api_call` in the existing account-action table. `get_account_action` and the approval screen show the complete parameters before `approve_account_action`. The publisher revalidates the stored operation and dispatches only writes. Read tools reject writes, including getUpdates, callbacks, payments, webhooks, polls, and read receipts. See [operation examples](api-operations.md).

Approval, rejection, cancellation, and requeue for account actions use conditional status updates. A stale request cannot overwrite an action already claimed by another publisher. Failed operations require new approval; no automatic retry is added. Bot and owner batches are claimed separately so an unavailable owner session cannot block Bot actions.
