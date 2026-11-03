# Progress

## Full API coverage（未リリース）

- Bot API 10.3: 185メソッド、既存11 / 追加170 / 除外4。型・構造スキーマを公式 HTML から生成
- GramJS: 主要操作18既存 / 32追加 / 除外10機能群。任意 TL と認証破壊的操作は公開しない
- HTTP / SDK / MCP の共通ディスパッチャ、既存 account_actions と publisher で全書込を承認
- multipart の inline base64、秘密値の名前参照、引数確認 UI、状態変更の比較更新
- 独立した Bot/オーナーキュー取得、レート制限時に後続項目を publishing に残さない
- D1 / SQLite migration 0003、ネットワーク拒否付きモックテスト。詳細は docs/api-coverage.md
- 本番接続・デプロイ・本番 migration は未実施

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
- `setWebhook` の自動呼び出し（明示承認付き呼び出しは追加）
- 大容量ファイルの multipart ストリーミング（小容量 inline base64 と file_id 指定は追加）
- 旧投稿専用画面のアルバム編集（汎用 Bot API の editMessageMedia 等は利用可能）
- A numeric rate-limit scheduler. The unpaid ceiling is unknown; see `docs/bot-api-limits.md`
- Automatic recovery of a draft stuck in `publishing`
- Installer package equivalent to `create-ig-harness` / `create-x-harness`

## Reference

Private `github.com/Shudesu/ig-harness` and `github.com/Shudesu/x-harness` were not readable from the build environment. The public OSS repositories `ig-harness-oss` and `x-harness-oss` were the structure and approval reference.
