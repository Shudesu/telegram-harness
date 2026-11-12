🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# Telegram Harness

Telegram のチャンネルとグループを、公式 Bot API だけでまとめて扱う。ソフトウェア利用料はこのリポジトリの範囲では発生しない。Bot API の制約、運用するサーバー、接続先の費用は別である。

投稿、返信、編集、削除は下書きになり、承認するまで送られない。承認も送信そのものではない。送信は publisher が、承認済みで時刻の来た下書きだけに行う。

Bot API の横に、所有者本人のアカウントを GramJS（MTProto、`api_id` / `api_hash` は https://my.telegram.org）で扱う層がある。チャンネルの作成と編集、管理者の変更、BotFather への定型操作も同じ承認キューを通る。セッションとボットトークンは秘密の名前だけで扱い、値はログやリポジトリに置かない。一斉 DM、メンバー収集、知らない人への招待、アカウントの大量作成はできない。未確認の上限と利用規約上の注意は [docs/user-account.md](docs/user-account.md)。

**現バージョン**: v0.3.0 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

## できること

- 複数ボットと複数チャンネル / グループの登録。トークンは環境変数名だけを保存する
- テキスト、画像、動画、アルバム、インラインボタンの下書き
- 承認キュー。`approve` は X Harness の growth draft と同様、状態を変えるだけで Bot API を呼ばない
- 承認済み下書きの予約送信
- 公開済みメッセージの編集・削除も、それぞれ承認待ちを通す
- `getChatMemberCount` と `getChat`。Bot API の Message に閲覧数は無いので、そのルートの `views` は `null`
- 本人アカウントでのチャンネル一覧、作成、編集、管理者変更、BotFather、`messages.getMessagesViews`（increment しない）
- Webhook で受信したメッセージとコメントを保存し、返信下書きも承認を通す
- 他の SNS 下書きを `POST /api/intake/drafts` で取り込む
- MCP と TypeScript SDK

確認できた上限と、数値を書かなかった項目は [docs/bot-api-limits.md](docs/bot-api-limits.md)。承認の手順は [docs/approval.md](docs/approval.md)。

## 会員・Stars決済・予約・ウィジェット・Mini App・MCP（36ツール）

`apps/membership-bot` は、Telegram Bot をお店の「予約・会員・配信の窓口」にする Cloudflare Workers アプリ（JavaScript、1 チャット 1 Durable Object）。上の承認キューの worker とは別の Worker としてデプロイする。詳しい手順は [apps/membership-bot/README.md](apps/membership-bot/README.md)。

- **会員**（`MEMBERSHIP=1`）：参加リクエストの承認、期限切れ・猶予・解約時の自動退出、認証 Mini App（`/verify`）。ルールは既定ですべて OFF
- **Stars 決済**：3 つの会員プラン、Stars の請求書と自動更新サブスクリプション。プラン登録と checkout ルールの有効化をするまで販売は始まらない。`PAY_LIVE=1` で Mini App が本物の請求書を作る。チャットの `/plans` は checkout ルールを有効にした時点で本物の請求になる。Stripe・KOMOJU・銀行振込のアダプタも差し替え可能
- **予約**：業態 → メニュー → スタッフ → 日時 → 確認 を 1 枚のカードで完結（デモデータ・AI 生成の架空スタッフ）
- **ウィジェット**：13 種類のリッチメッセージ・ウィジェットと `/widgets` ギャラリー、`/start` の 6 ステップガイド、Managed Bots（`/newbot`）
- **Mini App**：`/app/`（会員・決済）と `/verify`（認証）
- **MCP（36 ツール）**：`POST /mcp`。読み取り 19 個はすぐ返り、`request_*` 17 個は送信・返金・キック・設定変更を「オーナー承認待ち」に積むだけで実行しない。出力にユーザー ID・チャット ID は含めない

Stars で販売する前に、`/terms`（利用規約・特定商取引法に基づく表記）と `/paysupport`（支払いの問い合わせ窓口）を自分の事業者情報で整えること。日本で有償販売する場合は特商法の表示が必要。手順は [apps/membership-bot/README.md](apps/membership-bot/README.md#stars-決済の注意)。

```bash
pnpm test:membership-bot     # Node だけで動くテスト
pnpm build:membership-bot    # wrangler の dry-run ビルド（デプロイしない）
```

### 自分で動かすか、クラウドで使うか

同じ機能は、ホスト版として **The Harness Cloud（https://theharness.cloud）** でも使える。サーバーやシークレットを自分で管理したいならこのリポジトリ（OSS）を自分の Cloudflare アカウントにデプロイし、運用を任せたいならクラウド版を使う、と選べる。

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

`apps/worker` が Hono API、`apps/web` が承認画面、`packages/db` が D1 スキーマ、`packages/telegram-sdk` が Bot API、`packages/sdk` が API クライアント、`packages/mcp` が MCP サーバー、`apps/membership-bot` が会員・Stars決済・予約の Bot。
