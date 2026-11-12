# Telegram Harness — membership-bot (`apps/membership-bot`)

[日本語](#日本語) | [English](#english)

---

## 日本語

Telegram Bot を「お店の予約・会員・配信の窓口」にするための Cloudflare Workers 実装です。
チャットの中だけで予約・会員プラン（Telegram Stars 決済）・リッチメッセージ・自動応答を動かし、
運用は MCP（Model Context Protocol）経由で AI エージェントから読み取り／依頼できます。

### できること

- **予約ウィジェット**：業態 → メニュー → スタッフ → 日時 → 確認 を1枚のカード内で完結（デモデータ・架空スタッフ）
- **会員プランと Stars 決済**：ライト／スタンダード／プレミアムの3プラン、Mini App（`/app/`）から Stars の請求書・自動更新サブスクリプション。Mini App は `PAY_LIVE=1` にしない限り TEST 表示（実請求なし）
- **会員グループ管理**（`MEMBERSHIP=1`）：参加リクエストの承認、期限切れ・猶予・解約時の自動退出、認証 Mini App（`/verify`）。ルールは既定ですべて OFF、オーナーが有効にしたものだけが動く
- **外部決済アダプタ**：Stripe／KOMOJU／銀行振込（GMO あおぞら等の API）を差し替え可能なプロバイダとして実装
- **リッチメッセージ・ウィジェット**：13種類のウィジェット、`/widgets` ギャラリー、カスタム絵文字入りの配信下書き
- **ガイド付きツアー**：`/start` で6ステップのガイド、下部のスタジオキーボード
- **Managed Bots**：`/newbot` で利用者が自分の予約デモBotを作成（Bot API の Managed Bots）
- **/terms・/paysupport**：Stars 販売に必要な利用規約・特商法表記と、支払い問い合わせ窓口（受付番号つき）
- **運用 MCP**（`POST /mcp`）：36 ツール。読み取りはすぐ返り、送信・返金・キック・設定変更は「オーナー承認待ち」に積むだけで実行しない
- 1 チャット 1 Durable Object（SQLite）で、二重処理・再送・レート制限を扱う

### 構成

```
apps/membership-bot/
  src/index.mjs          Webhook 入口（/webhook, /health, /mcp, /app, /verify, /pay/*, /admin/membership/*）
  src/chat.mjs           ChatSession Durable Object（チャットごとの状態）
  src/studio/            ガイド・ウィジェット・プラン・規約・Mini App
  src/membership/        会員機能（ルール、承認、決済プロバイダ、cron）
  src/richmsg/           リッチメッセージ
  src/mcp/               MCP サーバ
  assets/                ヘッダー動画・スタッフ画像（AI 生成の架空人物）
  test/                  Node だけで動くテスト
  scripts/profile.mjs    Bot の名前・説明・コマンド一覧・メニューボタンを設定するスクリプト
```

### デプロイ手順（Cloudflare Workers）

前提：Node.js 22 以上、Cloudflare アカウント、`@BotFather` で作った Bot。

```bash
git clone https://github.com/Shudesu/telegram-harness.git
cd telegram-harness
pnpm install
pnpm test:membership-bot                  # Node だけで動くテスト
cd apps/membership-bot
cp wrangler.example.jsonc wrangler.jsonc  # name / BOT_USERNAME などを編集
```

1. `src/schema.mjs` の `BOT` を自分の Bot の数値 ID（トークンの `:` より前の数字）に書き換える。
2. Mini App カルーセルを使う場合は `src/config.mjs` の URL を自分のホスト先に変える（使わなければ `enabled: false`）。
3. シークレットを登録してデプロイ：

```bash
npx wrangler login
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_TOKEN       # 会員機能を使う場合
npx wrangler secret put MCP_API_KEY       # MCP を使う場合（32文字以上）
npx wrangler deploy
```

4. Telegram の webhook を Worker に向ける（`secret_token` は `WEBHOOK_SECRET` と同じ値）：

```bash
curl -s "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://<your-worker>.workers.dev/webhook","secret_token":"<WEBHOOK_SECRET>",
       "allowed_updates":["message","callback_query","widget_query","managed_bot",
                          "chat_join_request","pre_checkout_query","subscription"]}'
```

5. 任意：`BOT_TOKEN=... WORKER_ORIGIN=https://<your-worker>.workers.dev node scripts/profile.mjs apply` で Bot の名前・説明・コマンド一覧・メニューボタンを設定。
6. 動作確認：`GET /health` が `ok: true` を返すこと。

### 環境変数

シークレット（`wrangler secret put`。ローカルは `apps/membership-bot/.dev.vars`）：

| 名前 | 必須 | 用途 |
|---|---|---|
| `BOT_TOKEN` | 必須 | Bot API トークン |
| `WEBHOOK_SECRET` | 必須 | webhook の `X-Telegram-Bot-Api-Secret-Token` 照合 |
| `ADMIN_TOKEN` | 会員機能 | `/admin/membership/*` オーナー API の Bearer トークン |
| `MCP_API_KEY` | MCP | `/mcp` の Bearer キー（32文字以上） |
| `MANAGED_BOT_KEY` | Managed Bots | 64桁の hex。作成した Bot のトークン暗号化と webhook secret の導出に使う |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_ACCOUNT` / `STRIPE_RETURN_URL` | Stripe | Stripe アダプタ |
| `KOMOJU_SECRET_KEY` / `KOMOJU_WEBHOOK_SECRET` / `KOMOJU_RETURN_URL` | KOMOJU | KOMOJU アダプタ |
| `BANK_API_BASE` / `BANK_API_TOKEN` / `BANK_WEBHOOK_SECRET` | 銀行振込 | 振込確認アダプタ |

変数（`wrangler.jsonc` の `vars`）：

| 名前 | 既定 | 用途 |
|---|---|---|
| `MEMBERSHIP` | `0` | `1` で会員機能 ON |
| `PAY_LIVE` | `0` | `1` で Mini App が**本物の** Stars 請求書を作る（チャットの `/plans` には効かない。下記「Stars 決済の注意」） |
| `BOT_USERNAME` | — | 決済後の戻り先リンクなどに使う Bot のユーザー名 |
| `TENANT_ID` | `main` | 会員データの Durable Object 名の区別 |
| `MEMBER_GRACE_DAYS` | — | 支払い失敗後の猶予日数 |
| `SEED_FILE_IDS` / `SEED_OPTINS` | — | 旧環境からの移行用（通常は不要） |

### MCP ツール一覧（36）

`POST /mcp`、`Authorization: Bearer <MCP_API_KEY>`。

- **読み取り（19）**：`account_summary` `get_bot_status` `get_managed_bots_status` `get_terms` `get_audit_log` `list_approvals` `list_auto_replies` `list_booking_catalog` `list_commands` `list_guide_steps` `list_orders` `list_owner_requests` `list_payment_providers` `list_plans` `list_rich_templates` `list_rule_presets` `list_rules` `list_tickets` `list_widgets`
- **依頼のみ（17、実行はオーナー承認後）**：`request_send_message` `request_broadcast` `request_rich_message` `request_widget` `request_guide` `request_booking` `request_invoice_link` `request_refund` `request_subscription_cancel` `request_kick` `request_approval` `request_ticket_reply` `request_rule_change` `request_plan_change` `request_pay_live_change` `request_auto_reply_change` `request_managed_bot_creation`

MCP からは何も直接送信・課金・変更されません。出力にユーザー ID・チャット ID は含めません。

### Stars 決済の注意

- **販売を始めるまでの手順**：①`MEMBERSHIP=1` にしてデプロイ ②`apps/membership-bot/src/studio/plans.mjs` の `planSetPayloads()` が返す各要素を `POST /admin/membership/plan_set`（`Authorization: Bearer <ADMIN_TOKEN>`、本文は要素そのもの `{"plan": {...}}`）で登録 ③`POST /admin/membership/rule_add` に `{"preset":"checkout"}` を送って checkout ルールを有効化 ④下記の表記を整えてから `PAY_LIVE=1`。①〜③がないと請求書は作られません。**注意：`PAY_LIVE` が切り替えるのは Mini App だけです。③で checkout ルールを有効にした時点で、チャットの `/plans` の購入ボタンは `PAY_LIVE=0` でも本物の Stars 請求書を作ります。** ③は表記を整えてから行ってください。
- checkout ルールを有効にする前・`PAY_LIVE=1` にする前に、`apps/membership-bot/src/studio/legal.mjs` の **特定商取引法に基づく表記**（販売事業者・運営責任者・所在地・電話番号・メール窓口。初期値は「準備中」）を自分の情報に書き換えてください。日本で有償販売する場合は特商法の表示義務があります。
- Telegram は Stars で販売する Bot に **`/terms`（利用規約）と `/paysupport`（支払いサポート）** の提供を求めています。どちらも実装済みです。Telegram のサポートは購入の問い合わせに対応しないため、`/paysupport` の窓口を必ず運用してください。
- 返金は `refundStarPayment` で行い、MCP からは「返金依頼」として積まれるだけです。オーナーが `/admin/membership/*` で承認して初めて実行されます。
- デジタル商品・サービスは Telegram Stars での販売が必須です（外部決済は物理商品・サービス等に限る）。Telegram のポリシーとストアのガイドラインを確認してください。

### 既知の課題

レビューで見つかった、まだ直していない点です。

- `join_verify` ルールが OFF のとき、オーナーが個別承認した認証 Mini App は `unknown_request` になる
- Mini App の購入では、購入者を対象にした checkout ルールが一致せず、承認待ちになる

### ライセンス

リポジトリ直下の [LICENSE](../../LICENSE)（MIT）

---

## English

A Cloudflare Workers implementation that turns a Telegram bot into a shop's front desk for
bookings, memberships and messaging. Everything runs inside the chat, and operators (or AI agents)
can read state and file requests through an MCP endpoint.

### Features

- **Booking widget**: business → menu → staff → time → confirm inside a single card (demo data, fictional staff)
- **Membership plans with Telegram Stars**: three plans, Stars invoices and auto-renewing subscriptions from the Mini App (`/app/`). the Mini App stays in TEST mode (no real charges) unless `PAY_LIVE=1`
- **Member group management** (`MEMBERSHIP=1`): join-request approval, removal on expiry / grace / cancel, verification Mini App (`/verify`). All rules are off by default; only rules the owner enables run
- **Pluggable payment providers**: Stripe, KOMOJU and bank-transfer adapters
- **Rich messages and widgets**: 13 widget kinds, `/widgets` gallery, drafts with custom emoji
- **Guided tour**: `/start` runs a 6-step tour; a persistent studio keyboard
- **Managed Bots**: `/newbot` lets users create their own booking demo bot
- **/terms and /paysupport**: terms, Japanese legal notice (特商法表記) and a payment-support desk with ticket numbers
- **Ops MCP** (`POST /mcp`): 36 tools. Reads return immediately; sending, refunds, kicks and setting changes are only queued for owner approval
- One Durable Object (SQLite) per chat handles de-duplication, retries and rate limits

### Deploy to Cloudflare Workers

Requirements: Node.js 22+, a Cloudflare account, a bot from `@BotFather`.

```bash
git clone https://github.com/Shudesu/telegram-harness.git
cd telegram-harness
pnpm install
pnpm test:membership-bot
cd apps/membership-bot
cp wrangler.example.jsonc wrangler.jsonc   # edit name / BOT_USERNAME
```

1. Set `BOT` in `src/schema.mjs` to your bot's numeric id (the digits before `:` in the token).
2. If you use the carousel Mini App, point the URL in `src/config.mjs` at your host (or set `enabled: false`).
3. Add secrets and deploy: `npx wrangler secret put BOT_TOKEN`, `WEBHOOK_SECRET`, and optionally `ADMIN_TOKEN`, `MCP_API_KEY`; then `npx wrangler deploy`.
4. Call `setWebhook` with `url=https://<your-worker>.workers.dev/webhook`, `secret_token=<WEBHOOK_SECRET>` and
   `allowed_updates=["message","callback_query","widget_query","managed_bot","chat_join_request","pre_checkout_query","subscription"]`.
5. Optional: `BOT_TOKEN=... WORKER_ORIGIN=https://<your-worker>.workers.dev node scripts/profile.mjs apply` sets the bot's name, descriptions, command list and menu button.
6. Check that `GET /health` returns `ok: true`.

### Environment variables

Secrets (`wrangler secret put`; locally `apps/membership-bot/.dev.vars`): `BOT_TOKEN` (required), `WEBHOOK_SECRET` (required),
`ADMIN_TOKEN` (owner API), `MCP_API_KEY` (MCP, ≥32 chars), `MANAGED_BOT_KEY` (64 hex chars, Managed Bots),
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_ACCOUNT` / `STRIPE_RETURN_URL`,
`KOMOJU_SECRET_KEY` / `KOMOJU_WEBHOOK_SECRET` / `KOMOJU_RETURN_URL`, `BANK_API_BASE` / `BANK_API_TOKEN` / `BANK_WEBHOOK_SECRET`.

Vars (`wrangler.jsonc`): `MEMBERSHIP` (`1` = on), `PAY_LIVE` (`1` = real Stars invoices from the Mini App; does not affect the chat `/plans` checkout), `BOT_USERNAME`,
`TENANT_ID` (default `main`), `MEMBER_GRACE_DAYS`, `SEED_FILE_IDS` / `SEED_OPTINS` (migration only).

### MCP tools (36)

`POST /mcp` with `Authorization: Bearer <MCP_API_KEY>`. 19 read tools (`account_summary`, `get_*`, `list_*`)
and 17 queue-only `request_*` tools — see the Japanese section above for the full list. Nothing is sent, charged
or changed directly from MCP, and outputs never include user or chat ids.

### Stars payments: before going live

- **Setup order**: (1) deploy with `MEMBERSHIP=1`; (2) register each item returned by `planSetPayloads()` in `apps/membership-bot/src/studio/plans.mjs` with `POST /admin/membership/plan_set` (`Authorization: Bearer <ADMIN_TOKEN>`, body `{"plan": {...}}`); (3) enable the checkout rule with `POST /admin/membership/rule_add` and `{"preset":"checkout"}`; (4) then set `PAY_LIVE=1`. Without (1)–(3) no invoice is created. **Note: `PAY_LIVE` only switches the Mini App. Once the checkout rule is enabled in (3), the chat `/plans` buy buttons create real Stars invoices even with `PAY_LIVE=0`**, so do (3) only after the seller details are filled in.
- Before enabling the checkout rule or `PAY_LIVE=1`, fill in the seller details in `apps/membership-bot/src/studio/legal.mjs` (they default to 「準備中」). Selling to customers in Japan requires the 特定商取引法 notice.
- Telegram requires bots that sell with Stars to support **`/terms`** and **`/paysupport`**; both are implemented. Telegram support does not handle purchase questions, so keep `/paysupport` staffed.
- Refunds use `refundStarPayment` and only run after the owner approves them via `/admin/membership/*`.
- Digital goods and services must be sold in Telegram Stars; review Telegram's and the app stores' policies.

### Known issues

Found in review and not fixed yet.

- With the `join_verify` rule off, a verification Mini App the owner approves one by one answers `unknown_request`
- In the Mini App, a checkout rule scoped to the buyer does not match, so the purchase waits for approval

### License

MIT — see [LICENSE](../../LICENSE) at the repository root.
