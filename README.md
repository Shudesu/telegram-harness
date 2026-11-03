🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

Telegram のチャンネルとグループを、公式 Bot API だけでまとめて扱う。ソフトウェア利用料はこのリポジトリの範囲では発生しない。Bot API の制約、運用するサーバー、接続先の費用は別である。

ユーザーアカウントの自動化や MTProto は使わない。投稿、返信、編集、削除は下書きになり、承認するまで送られない。承認も送信そのものではない。送信は publisher が、承認済みで時刻の来た下書きだけに行う。

**現バージョン**: v0.1.0 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

## できること

- 複数ボットと複数チャンネル / グループの登録。トークンは環境変数名だけを保存する
- テキスト、画像、動画、アルバム、インラインボタンの下書き
- 承認キュー。`approve` は X Harness の growth draft と同様、状態を変えるだけで Bot API を呼ばない
- 承認済み下書きの予約送信
- 公開済みメッセージの編集・削除も、それぞれ承認待ちを通す
- `getChatMemberCount` と `getChat`。閲覧数は Bot API の Message に無いので `null`
- Webhook で受信したメッセージとコメントを保存し、返信下書きも承認を通す
- 他の SNS 下書きを `POST /api/intake/drafts` で取り込む
- MCP と TypeScript SDK

確認できた上限と、数値を書かなかった項目は [docs/bot-api-limits.md](docs/bot-api-limits.md)。承認の手順は [docs/approval.md](docs/approval.md)。

## ローカル

```bash
pnpm install
pnpm --filter worker dev
```

`apps/worker` の開発サーバーは dry-run で、`api.telegram.org` に接続しない。`TELEGRAM_ALLOW_NETWORK=true` では起動を拒否する。手順は [docs/manual/01-local.md](docs/manual/01-local.md)。

```bash
pnpm check
```

秘密情報の形をした文字列の検査、型チェック、モックした Bot API のテストを実行する。

## MCP

ツール名は `create_draft`、`approve_draft`、`run_publisher` のように分かれている。`create_draft` は送らない。

```bash
TELEGRAM_HARNESS_API_URL=http://localhost:8787 TELEGRAM_HARNESS_API_KEY=dev-local-api-key pnpm exec tsx packages/mcp/src/index.ts
```

## レイアウト

`apps/worker` が Hono API、`apps/web` が承認画面、`packages/db` が D1 スキーマ、`packages/telegram-sdk` が Bot API、`packages/sdk` が API クライアント、`packages/mcp` が MCP サーバー。
