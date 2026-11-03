# User account (GramJS)

This layer sits next to the Bot API. It talks to Telegram as the owner, through [GramJS](https://github.com/gram-js/gramjs) and MTProto. `api_id` and `api_hash` come from the owner's own app at https://my.telegram.org. GramJS is a third-party client of that API. It is not a library published by Telegram, and it is not the Bot API.

The local `pnpm --filter worker dev` process is dry-run. It refuses `TELEGRAM_ALLOW_NETWORK=true` and `TELEGRAM_USER_ALLOW_NETWORK=true`. It does not log in and it does not open a socket to Telegram. `pnpm --filter worker user-live` is the opt-in Node process for a real session. This repository does not start it, and Cloudflare Workers are not a supported runtime for the MTProto TCP session. Whether Workers `connect()` can carry GramJS is **unknown** here and is not implemented.

`user-live` keeps the approval queue, registered bots and channels, account actions, and `selfUserId` in a SQLite file opened with Node's `node:sqlite`. The Worker process still uses D1. Both apply `packages/db/migrations`. The application tables match. `user-live` records applied file names in `schema_migrations`. Wrangler tracks D1 migrations in its own table. The dry-run Node server still uses an in-memory repo and does not open this file.

## Approval

Login (phone, code, optional 2FA password) is the owner's own authentication. It is rate limited and it is not an approval-queue item.

These writes are `pending` until `approve_account_action`. Approve only sets `scheduled`. It does not call GramJS. `run_publisher` or cron runs due account actions:

- create a channel or supergroup
- edit title, description, photo, or username
- add or remove one admin, including a harness bot resolved with `getMe`
- BotFather changes: create bot, name, description, about, commands, profile photo, fetch token, revoke token

The scripted BotFather exchange fixes its peer to `@BotFather`. The new finite owner-operation dispatcher also supports ordinary user messages, media, polls, and profile changes, all through request → approve → publisher. See [API coverage](api-coverage.md) and [operation examples](api-operations.md). No arbitrary TL invocation is exposed.

## Secrets

| Name | What it is |
|---|---|
| `TELEGRAM_API_ID` | Numeric app id from my.telegram.org |
| `TELEGRAM_API_HASH` | App hash from my.telegram.org |
| `TELEGRAM_SESSION_ENCRYPTION_KEY` | 32-byte key, base64url, for AES-256-GCM |
| `TELEGRAM_USER_SESSION` | Ciphertext of the GramJS string session. The plaintext is not stored. |
| `TELEGRAM_BOT_TOKEN_*` | Bot token values. The database stores the variable name only. Send and `getMe` read the secret store first, then the process environment. |
| `TELEGRAM_SECRET_STORE_PATH` | Optional file path for the secret store. Must be outside the repo or under `.local/`. |
| `TELEGRAM_DB_PATH` | Optional SQLite file for `user-live`. Must be outside the repo or under `.local/`. |
| `HOST` | Bind address for `user-live`. Default `127.0.0.1`. |
| `PORT` | Bind port for `user-live`. Default `8787`. |
| `API_KEY` | Required on `user-live` management routes. This process does not invent a default key. |

Login keeps the in-progress session and phone in `TELEGRAM_USER_LOGIN_SESSION` and `TELEGRAM_USER_LOGIN_PHONE`, encrypted, and deletes them when login finishes or the session is forgotten. API responses, MCP results, draft errors, and the dry-run call log do not include the session, the phone, the code, the password, the access hash, or a bot token. `user_session_forget` deletes the local ciphertext. It does not call `auth.logOut`. Remote revocation from this harness is **not implemented**.

The dry-run Node server uses a fixed local encryption key so the console can store a fake session. `user-live` refuses that key.

The secret file stores only keys this process manages: `TELEGRAM_USER_SESSION`, `TELEGRAM_USER_LOGIN_SESSION`, `TELEGRAM_USER_LOGIN_PHONE`, and `TELEGRAM_BOT_TOKEN_*` values written with `put`. A token or session that is only in the environment is readable from that environment, and it is not copied into the file. Other variables, including `PATH`, `HOME`, and `TELEGRAM_API_HASH`, are not written. A file left over from an older build is rewritten without those extra keys the next time a managed key is saved. The file mode is `0600`.

## SQLite on `user-live`

`TELEGRAM_DB_PATH` selects the file. When it is unset, the path is `~/.local/share/telegram-harness/telegram-harness.sqlite` (the home directory, outside this repository). A path inside the repository is rejected unless it is under `.local/`. The process creates the file with mode `0600`. Session strings and bot tokens are not columns.

The same process can set `TELEGRAM_ALLOW_NETWORK` to true. Bot API sends and the account layer then use this one SQLite file. The dry-run command `pnpm --filter worker dev` still refuses that variable. Tests and CI do not set it, and they do not call `api.telegram.org`.

## HTTP bind

`user-live` listens on `127.0.0.1` and port `8787` unless `HOST` or `PORT` is set. Management routes still require `API_KEY`. The dry-run server is unchanged and is not covered by this bind.

## What this layer will not do

- Create Telegram user accounts. `auth.AuthorizationSignUpRequired` stops the login.
- Bulk account creation, bulk bot creation, or a list of targets in one action.
- Mass DMs, or `messages.sendMessage` to any peer other than `@BotFather`.
- Member scraping. Dialog fetch keeps channels and groups where this account is creator or admin. User dialogs are dropped. `channels.getParticipants` is not called. Stats responses drop `users` and `chats` arrays that arrive beside view counts.
- Invites. There is no invite link, contact import, or `channels.inviteToChannel`. Adding an admin names one username or one registered bot.
- Basic-group edits. Small groups can appear in the list. Writes return `basic_group_unsupported`. The matching MTProto methods were not wired. Behavior of those methods here is **unknown**.

## Telegram rules

Automating a user account can violate the [Telegram Terms of Service](https://telegram.org/tos) and the [API Terms](https://core.telegram.org/api/terms). This repository is for the owner managing that owner's channels and that owner's bots. It is not for spam, bulk messaging, or collecting members. The operator obtains their own `api_id` / `api_hash` and does not share the session string. A session string is a logged-in account.

The exact text of those terms was not copied here. If a limit or a prohibition was not re-read from telegram.org for this change, it is **unknown** below rather than paraphrased into a number.

## Rate limits and FLOOD_WAIT

These numbers are harness policy. They are not Telegram's published ceilings. Official MTProto ceilings are **unknown**.

| Policy | Value |
|---|---|
| Minimum gap between account writes | 3 seconds |
| Account writes per hour | 20 |
| Account reads per minute | 20 |
| Login code sends per hour | 3 |
| BotFather steps per approved action | 6 |
| Dialog page size | 100 |
| `FLOOD_WAIT` at or under 30 seconds | One retry, and only for reads (`list_own_chats`, `get_own_channel_stats`) |
| Longer `FLOOD_WAIT`, and any `FLOOD_WAIT` on a write or login | No retry. The action fails with `flood_wait:<seconds>` or the login returns 429. Requeue is manual. |

GramJS `floodSleepThreshold` is 0, so the library does not sleep on its own. `requestRetries` is 1. In GramJS 2.26.22 (the version this repo depends on) the send loop is `for (attempt = 0; attempt < requestRetries; attempt++)`. A value of 0 throws `Request was unsuccessful 0 time(s)` and does not send. A value of 1 sends once and does not run the loop again, including for writes. A write that Telegram applied and then reported as `FLOOD_WAIT` could be duplicated if it were retried. Writes are not retried for that reason. That loop was read from the installed library. It was not executed against Telegram.

## BotFather

The script is a fixed sequence to `@BotFather` (`/newbot`, `/setname`, `/setdescription`, `/setabouttext`, `/setcommands`, `/setuserpic`, `/token`, `/revoke`). Prompts, button layouts, and confirmation words were **not** checked against a live BotFather in this repository. If a reply matches a short rejection heuristic (`sorry`, `already taken`, and a few similar phrases), the action stops and does not send the rest. That heuristic is **unverified**. A successful token is stored under `tokenEnvName` in the secret store, and the reply text is discarded. Later Bot API calls read that store before the environment, so the token is usable without a restart. When `TELEGRAM_SECRET_STORE_PATH` is set, the next process start still finds it in that file. Without that path, the value stays in the process only. The HTTP response still contains the variable name only. If the reply does not contain a token when one was expected, the action fails with `botfather_token_missing` and the reply is not stored.

`/revoke` sends the command and the `@username` only. It does not guess a confirmation word. If BotFather asks for an extra confirmation, the action fails rather than sending one. Whether the current BotFather requires that confirmation is **unknown**.

## Stats

`messages.getMessagesViews` is called with `increment: false` for message ids the caller supplies (at most 20). The count is the `views` field on each `MessageViews` item. This route does not walk history and does not pass `users` or `chats` through.

`channels.getFullChannel` is read for `participantsCount` and `about` on `fullChat` only.

`stats.getBroadcastStats` supplies `followers`, `viewsPerPost`, `sharesPerPost`, and `reactionsPerPost` when the object is `stats.BroadcastStats`. Graphs are omitted. Which channels expose broadcast stats, and at what size or boost level, was **not** re-checked. Failure is `broadcastStats: null` plus a reason code. The Bot API stats route still returns `views: null`.

## Unknown

- Official maximum length of a channel title, about text, bot description, bot about, and command list as enforced by MTProto or by the current BotFather. The harness uses its own input caps in `USER_INPUT_LIMITS`.
- Official per-account MTProto rate limits. The table above is policy.
- Whether `user-live` on a particular network needs a proxy. Proxies are not configured.
- Whether `requestRetries` keeps this meaning in a GramJS release other than 2.26.22.
- Whether `localhost` on the owner's machine resolves to IPv6 `::1`. The default bind is IPv4 `127.0.0.1`. Reachability of a non-loopback `HOST` was not tested.
- Whether a filesystem that ignores POSIX `chmod` keeps the SQLite file and the secret file at mode `0600`. The process sets `0600` after creating them. That was checked on Linux in the tests, not on the owner's disk.
- Whether Node's `node:sqlite` API stays compatible on the owner's Node build. Node 22 still marks the module experimental. Tests ran on Node 22.23. The owner's binary was not checked.
- Whether a DC migration during login always leaves a usable string session. The ciphertext is rewritten when GramJS `session.save()` changes. That path was not run against Telegram.
- How long a string session stays valid, and which Telegram client actions revoke it.
- The live wording and button flow of BotFather.
- Whether `channels.editAdmin` on a username adds a person who was not already in the channel. The harness allows one explicit username because the owner named them. It does not search for people.
- Album or story statistics. Not requested and not implemented.
- Recovering an account action left in `publishing`. Same gap as bot drafts: **unknown**, and not automatic.

## 日本語

所有者本人のアカウントを、Bot API の横で GramJS（MTProto）から扱う。`api_id` と `api_hash` は https://my.telegram.org で本人が発行する。セッション文字列は AES-256-GCM で暗号化し、`TELEGRAM_USER_SESSION` という名前の秘密として置く。平文はデータベース、ログ、リポジトリ、API レスポンスに出さない。ボットトークンも値ではなく環境変数名だけをレスポンスに出す。

チャンネルとスーパーグループの作成、タイトル・説明・写真・ユーザー名の変更、管理者の追加と削除、BotFather への定型操作は、すべて承認待ちになる。承認は状態を `scheduled` にするだけで、実行は publisher だけが行う。ログイン（電話番号、コード、必要な場合の 2FA）は本人の認証なので承認キューには入れない。回数は上の表で制限する。

一斉 DM、メンバー収集、知らない人への招待、新規ユーザーアカウントの作成はしない。Telegram の利用規約に反する自動化はしない。上の「Unknown」は、この変更で公式ドキュメントを読み直して数値を確認できなかった項目である。BotFather の実際の返答文も未確認である。

`user-live` は承認キュー、登録済みボットとチャンネル、アカウント操作、`selfUserId` を SQLite（Node の `node:sqlite`）に残す。パスは `TELEGRAM_DB_PATH`。未設定ならホームの `~/.local/share/telegram-harness/telegram-harness.sqlite`（リポジトリの外）。リポジトリ内は `.local/` 以外を拒否する。ファイルモードは `0600`。マイグレーションは Worker の D1 と同じ `packages/db/migrations` で、アプリの表は揃う。適用済みファイル名は `schema_migrations` に記録する。Worker の D1 経路は変えない。Node 22 では `node:sqlite` は experimental である。テストは Node 22.23 で通り、所有者の Node では未確認である。同じプロセスで `TELEGRAM_ALLOW_NETWORK` を true にすると、Bot API もこの SQLite を使う。dry-run の `pnpm --filter worker dev` はその変数を拒否したままである。セッション文字列とボットトークンは列にしない。

HTTP は既定で `127.0.0.1` のポート `8787` にバインドする。変更は `HOST` と `PORT`。管理 API はこれまでどおり `API_KEY` が必要で、このプロセスは仮の鍵を作らない。`localhost` が IPv6 の `::1` になるか、ループバック以外の `HOST` に届くかは、このリポジトリでは未確認である。

ボットトークンは `tokenEnvName` で秘密ストアを先に読み、無ければ環境変数を読む。BotFather が保存したトークンは再起動なしで使える。`TELEGRAM_SECRET_STORE_PATH` があるときは、次の起動でもそのファイルから読む。パスが無いときはプロセスの中だけに残る。秘密ファイルに書くのは、このプロセスが保存したセッション暗号文、ログイン状態、`TELEGRAM_BOT_TOKEN_*` だけである。無関係な環境変数は書かない。GramJS の `requestRetries` は 1（0 だと送信しない）。`floodSleepThreshold` は 0 のままである。承認の流れは変えていない。
