# Telegram Harness

[English](README.en.md) · [能力比較](docs/capabilities.md) · [設計](docs/architecture.md) · [開発DoD](docs/DOD.md)

予約管理を主軸にした、Botから独立する顧客台帳。Telegram / Cloudflareの非公式プロジェクトです。MITライセンス。

フェーズ1では顧客・連絡先・同意・予約をローカルSQLiteに保存し、管理API、MCP、Kumo画面から扱えます。Botやチャンネルが利用不能になっても台帳は残ります。ただし別BotへのDM権限は引き継げません。確認済みのメール／電話と本人の有効な再連絡同意を持つ候補だけを抽出します。

## 現在の範囲

- 顧客登録・一覧・詳細・更新、流入元・タグ、連絡先、確認証跡、目的別の同意／撤回履歴。
- 予約枠作成、定員制御、予約・取消、重複リクエストの抑止。
- 台帳JSONエクスポート、再連絡候補リスト。全14 CRM MCPツール。
- Kumoの顧客一覧・予約一覧画面。ローカル管理者専用。
- 既存の承認付き投稿管理、暗号化セッションを使う所有者アカウント層。

Mini Apps、Login、Stars決済、Cloud接続、顧客自身の予約受付、メール送信、バックアップ復元UIは後続です。購入はスキーマだけです。画面のブラウザ視覚検証は未完了（[DoD](docs/DOD.md)）。

## 安全なローカル起動

Node.js 22.13以上、pnpm 9.15.4。NodeのSQLiteは実験的APIです。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# .envのAPI_KEYを自分のローカル値にし、TELEGRAM_LOCAL_UI=trueを設定。
# Botトークンや実セッションは不要。両ALLOW_NETWORKはfalseのまま。
set -a
source .env
set +a
pnpm dev:worker
```

別ターミナルでも同じ環境変数を読み込み、`pnpm dev:web`。顧客台帳は `http://127.0.0.1:3005/crm/customers`、予約一覧は `/crm/bookings`。投稿管理は `/`。

workerは127.0.0.1:8787、webは127.0.0.1:3005にbindします。webは`TELEGRAM_LOCAL_UI=true`がなければ403です。**インターネット／LANへ公開しないでください**。公開運用の利用者認証・テナント分離は未実装です。

dry-run workerもDBへ永続化します。既定はworker作業ディレクトリ内の`.local/crm-dry-run.sqlite`、`TELEGRAM_CRM_DB_PATH`で絶対パスを指定できます。既存user-liveのDBとは別です。起動時に未適用migrationを実行します。保存先は運用環境の容量・保存ポリシーに合わせて設定してください。2026-11-05フェーズ2の作業は内蔵のみを使用します。D1への適用やデプロイはこの手順では行いません。

## API / MCP

APIは`Authorization: Bearer <API_KEY>`必須。CRMは`/api/crm/`。顧客、枠、予約、連絡先、同意、エクスポートの全ルートは[対応一覧](docs/architecture.md#mcp--api対応一覧)を参照してください。INTAKE_API_KEYではCRMを操作できません。

MCPをstdioで起動:

```sh
# この2変数はMCPクライアント側に設定。キーは管理APIと一致させる。
export TELEGRAM_HARNESS_API_URL=http://127.0.0.1:8787
export TELEGRAM_HARNESS_API_KEY="$API_KEY"
pnpm --filter worker exec tsx ../../packages/mcp/src/index.ts
```

`crm_create_customer` → `crm_create_slot` → `crm_book`で予約を登録できます。予約の再試行には同じ`requestKey`、新しい予約には新しいキーを使います。日時は`2026-12-01T13:00:00+09:00`等の時差付きISO8601。

連絡先は`crm_add_contact`で未確認として登録し、実際に本人確認した証跡を`crm_verify_contact`へ渡します。`crm_record_consent`でpurpose/status/evidence/policyVersion/occurredAtを記録。MCPが勝手に本人の同意を作ってはいけません。`recontact`、`booking`、`marketing`は別目的で、撤回も履歴として残ります。

`crm_export_customers`と`crm_list_recontact`は送信しません。一覧は50件既定・最大100件。返された`nextCursor`を`after`へ渡し、nullまで保存します。書出しは個人情報なので非公開にし、完全な復旧用保存では書込み停止またはDBバックアップを併用してください。ページ間の更新整合性は保証しません。

## 検証

```sh
pnpm check
pnpm --filter web build
# gitleaks導入済みの場合。実際の秘密値を出力しない。
gitleaks git --redact --no-banner --log-opts=--all
```

テストはfixtureとローカルSQLiteで実行し、Telegramへ接続しません。CRM統合テストは認証・同意撤回・定員競合・冪等性・永続化・MCP全経路を確認します。D1本番・Telegram実機の検証とは別です。

## 秘密・制約・公開

`.env`、`.dev.vars`、`.local/`、DB、秘密ファイル、エクスポートをコミットしないでください。トークンは環境変数名で参照します。サーバーのAPIキーを`NEXT_PUBLIC_`変数に入れないでください。

スパム、制限回避、参加者スクレイピング、日本向けオンラインカジノ誘導は対象外。Starsは商品・対象国・規約・返金体制を確認してから導入する設計です。フェーズ1作業では送信・チャンネル操作・デプロイ・push・公開を行いません。

既存機能の詳細: [承認フロー](docs/approval.md)、[Bot API制約](docs/bot-api-limits.md)、[ユーザーアカウント](docs/user-account.md)、[セキュリティ](SECURITY.md)。

## フェーズ2 — ボット予約・電話受付（ローカルモック）

`/crm/booking-bot`で月別インラインカレンダー、`/book`の模擬受付、グループ／トピックから台帳への予約、電話のスタッフ入力、予約確認・24時間前リマインダーを検証できます。送信はすべてモック。追加の5 MCPツールも同じ管理APIを利用します。Mini Appの公開・認証や実送信は含みません。

[使い方・API/MCP・検証境界](docs/phase2.md) / [Bot機能マップ](docs/bot-capabilities.md) / [中国語圏クライアント調査](docs/research-cn-clients.md) / [npm監査](docs/security/npm-audit-20261105.md) / [SMS・電話設計](docs/sms-phone.md)。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm --filter web build
node scripts/phase2-http-smoke.mjs
```

このブランチの依存更新はinstall系スクリプトを実行せず検証しています。GramJSのnpm名は`telegram`で、現在archived/deprecatedです。今回の予約はGramJSに依存しません。既存の本人アカウント機能を再開する前に保守方針を見直してください。
