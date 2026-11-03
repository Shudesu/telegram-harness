# Bot API limits

Checked against https://core.telegram.org/bots/api on 2026-11-03. This file records what that page states, and what this repo deliberately does not invent.

## Used as preflight

| Item | Bound on the page | How this repo uses it |
|---|---|---|
| `sendMessage` / `editMessageText` text | 1–4096 characters after entities parsing | JavaScript string length of the raw text. This is not the same count. |
| Media caption | 0–1024 characters after entities parsing | Same raw-length preflight. |
| `sendMediaGroup` `media` | 2–10 items | Enforced. Photos and videos may be mixed. Documents and audio are not implemented. |
| `callback_data` | 1–64 bytes | UTF-8 byte length. |
| `deleteMessages` `message_ids` | 1–100 | One published record stays within an album of at most 10. |
| URL upload size | 5 MB photos, 20 MB other content | Not measured. The harness does not download the file before sending. |
| Multipart upload size | 10 MB photos, 50 MB other | Not used. v0.1 does not upload multipart bodies. |
| Webhook `secret_token` | 1–256 characters, `A-Z a-z 0-9 _ -` | The header `X-Telegram-Bot-Api-Secret-Token` is compared with `TELEGRAM_WEBHOOK_SECRET`. This version does not call `setWebhook`. |

`sendMediaGroup` has no `reply_markup` parameter on that page. Drafts that combine an album with buttons are rejected as `album_reply_markup_unsupported`.

## Member counts and views

`getChatMemberCount` returns an Integer. The harness calls it only when the Telegram client is live.

The Message object on the same page has no `views` field. This Bot API route does not call `messages.getMessagesViews`. Its `views` stay null. The owner-account route is separate and is documented in `docs/user-account.md`.

## Unknown — not hardcoded

These were not given as a single number on the page checked above. The code does not substitute a guess.

- Free-tier per-chat and per-bot send rates. The page mentions broadcasting limits because `allow_paid_broadcast` can bypass them. It does not state the unpaid ceiling.
- Maximum inline-keyboard rows or buttons. The type is an array of arrays. No numeric cap was copied.
- Button label length. The harness rejects labels outside 1–256 characters as its own input bound, not as a Telegram limit.
- Whether `editMessageCaption` on one item of an album changes the album caption the way a single-media caption edit does. Album edit is unsupported.
- How close the raw JavaScript string length is to Telegram's "after entities parsing" count.
- How long a draft left in `publishing` can safely be retried. Automatic retry is not implemented, because a retry after a lost response could send twice.
- Whether a group reply is always a channel comment. Storage marks group/supergroup replies and `is_automatic_forward` as `comment`. That is a harness label.

## Delete constraints stated by the page

`deleteMessage` documents the 48-hour rule, the dice exception, and the admin rights required in groups, supergroups, and channels. This harness still calls `deleteMessages` after approval and records a failure if Telegram refuses. It does not try to predict those cases.

## Generic dispatcher update (2026-11-04)

The older table above describes the original draft composer. The new [full API dispatcher](api-coverage.md) also accepts documented file_id/URL inputs, all media-group types in the current reference, and small inline-base64 multipart uploads. It allows setWebhook only through approval. Its structural types were regenerated from Bot API 10.3; Telegram remains responsible for conditional parameter rules and server-side limits. Harness upload bounds are documented separately and are not claims about Telegram limits.
