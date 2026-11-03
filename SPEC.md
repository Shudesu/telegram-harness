# Telegram Harness — SPEC

## Overview

複数の Telegram チャンネル / グループを、公式 Bot API で管理する。投稿・返信・編集・削除は下書きになり、明示的な approve のあと、publisher が承認済みだけを送る。

0.2.0 から、所有者本人のアカウントを GramJS（MTProto）でも扱う。`api_id` と `api_hash` は https://my.telegram.org で本人が取る。チャンネルの作成と編集、管理者の変更、BotFather への定型送信も同じ承認キューを通る。ログインは本人の認証なのでキューには入れない。セッション文字列は暗号化して秘密ストアに置き、平文は保存しない。一斉 DM、メンバー収集、知らない人への招待、ユーザーアカウントの新規作成はしない。詳細と unknown は `docs/user-account.md`。

公開実装の IG Harness OSS と X Harness OSS と同じく、Cloudflare Workers (Hono) + D1 + TypeScript SDK + MCP の pnpm monorepo にする。プライベートの `ig-harness` / `x-harness` はこの作業環境から読めなかった。

## Tech Stack

- **API / Webhook**: Cloudflare Workers、Hono
- **Database**: Cloudflare D1 (SQLite)。テストはインメモリと `node:sqlite`
- **Cron**: Workers Cron Triggers (`*/5 * * * *`) が publisher を呼ぶ
- **Frontend**: Next.js 15 の承認キュー
- **SDK**: `@telegram-harness/sdk`
- **MCP**: `@telegram-harness/mcp`（stdio、ツール名は snake_case）
- **Bot API**: `@telegram-harness/telegram-sdk`

## Architecture

```
Telegram Bot API  ←  publisher（承認済みだけ）
        ↑
Cloudflare Workers (Hono) → D1
        ↑
Next.js 承認画面 / TypeScript SDK / MCP
        ↑
Webhook と POST /api/intake/drafts
```

`TELEGRAM_ALLOW_NETWORK` が `true` でない Worker は Bot API を呼ばない。ローカルの `node-server` は dry-run 固定で、そのフラグが true なら起動しない。

## Monorepo

```
telegram-harness/
├── apps/
│   ├── worker/          # Hono API
│   └── web/             # Next.js 承認画面
├── packages/
│   ├── db/              # schema.sql と D1 / memory repository
│   ├── telegram-sdk/    # Bot API client
│   ├── user-account/    # GramJS owner-account client, dry-run by default
│   ├── sdk/             # Harness HTTP client
│   ├── mcp/             # MCP server
│   └── shared/          # 型と検証
├── docs/
├── scripts/
├── SPEC.md
├── CLAUDE.md
└── PROGRESS.md
```

## Approval

X Harness の growth draft と同じ境界にする。

| 状態 | 意味 |
|---|---|
| `pending` | 承認待ち。送信されない |
| `scheduled` | 承認済み。`scheduledAt` 到来まで publisher は送らない |
| `publishing` | publisher が掴んだ途中 |
| `posted` | 送信処理が完了した |
| `rejected` | 却下 |
| `failed` | 送信に失敗。再送には requeue して、もう一度 approve する |

- `POST /api/drafts/:id/approve` は pending 以外を `409 Draft is not pending` で拒否する。Telegram は呼ばない。
- `POST /api/publisher/run` と cron だけが `scheduled` かつ期限到来の下書きを送る。
- 編集と削除も別の pending 下書きになり、同じ approve を通る。
- 受信への返信も同じ。Webhook は保存するだけで返さない。
- `POST /api/intake/drafts` は他 SNS の下書きを pending で取り込む。

## Registration

ボットトークンはデータベースに保存しない。`tokenEnvName`（例: `TELEGRAM_BOT_TOKEN_MAIN`）だけを保存し、送信時は秘密ストアを先に、無ければ環境変数を読む。`.env.example` にあるのは名前とプレースホルダだけ。

## Stats

- メンバー数: `getChatMemberCount`
- チャット概要: `getChat` の id / title / type / username
- 閲覧数: Bot API の Message に `views` は無い。Bot API の統計ルートは `views: null`。ユーザーアカウントの統計ルートだけが `messages.getMessagesViews` を `increment: false` で呼ぶ

数値の出典と、確認できなかった上限は `docs/bot-api-limits.md`。

## Out of scope

- 本番デプロイ、本番 D1、実 Bot API への送信、実ログイン
- `setWebhook` の自動呼び出し
- ファイルの multipart アップロード（Bot API）
- アルバムの編集
- 一斉 DM、メンバー収集、招待リンク、ユーザーアカウントの新規作成
- Cloudflare Workers 上での MTProto TCP。ライブ実行は Node の `user-live` だけを想定し、このリポジトリは起動しない
