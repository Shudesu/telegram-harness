# フェーズ3 — 配信モックと業種別台帳

2026-11-05依頼の範囲。`feat/phase2`の上に`feat/phase3`。実送信・発信・有料登録・公開・push・デプロイなし。新しい外部依存なし。対象はローカルモックで、L Harness全機能の本番完成ではない。

## 起動・操作

既存READMEのworker/Next起動手順を使用。`node-server.ts`はネットワーク許可時に起動拒否し、`TELEGRAM_ENGAGEMENT_MOCK=true`をローカルで設定する。管理画面は `/crm/engagement`。`TELEGRAM_LOCAL_UI=true`とloopback Host、サーバー側API_KEYが必要。Cloud entryではフラグ未指定のため503になる。

1. 顧客台帳で顧客、Bot scope付きTelegram連絡先、確認証跡を作成し、**marketing**の許可を記録する（サービス同意やbooking同意だけでは配信しない）。
2. 「業種別プロフィール」で6業種から選び、専用項目・年齢確認・サービス利用同意を保存。「来店履歴」で担当/指名/コース/ボトル/金額、「通話記録」でincoming/outgoingを記録する。
3. 「動画」でTelegram動画URLまたは動画ページリンクを登録。送信予定は動画IDを使ってシナリオ/配信予約で指定する。URL取得・アップロード・実送信はしない。
4. 「シナリオ」で簡易2段階配信、または詳細JSONで最大30ステップを定義。「配信進行」でシナリオIDとcontact IDを登録。同一シナリオ・連絡先は一度だけ登録され、完了/停止後の再登録で復活しない。再施策は新しいシナリオIDを使う。
5. 「セグメント」でBot scopeとAND条件を定義し対象/除外理由を確認。「配信予約」で期限と本文/動画を指定。1回100連絡先のページ処理で、nextCursorがあれば次ページを別IDで作成する。最終ページのnextCursorはnull。
6. 「配信進行」のモック処理は期限到来分を最大100実行・各1ステップだけ進める。ゼロ遅延の次ステップも次の明示実行で進む。自動タイマーは未接続。停止は不可逆で、モック記録だけを保持する。
7. 「動画反応」はスタッフが模擬証跡を記録する。`link_clicked` / `self_reported_watched`を分け、`verifiedPlayback:false`。個人別のネイティブ動画再生完了/視聴率や実測クリック数と称さない。

日時はISO 8601（UTCまたはoffset付き）、内部でUTC正規化。遅延は最初が登録時から、以降は前段を実際にモック処理した時刻から。遅れたジョブを一気に追い付かせない。分岐添字は0始まり、onTrue/onFalseは後続だけで循環不可、nullは終了。条件不一致時はそのメッセージを記録上スキップしてonFalseへ進む。タグ/流入元/業種/担当のeq/neqが使える。定義は不変、変更は新ID。

## API・MCP・画面

共通prefix `/api/crm/engagement`。すべて管理APIキー必須、INTAKE_API_KEY不可。no-store、本文64KiB上限。mock flag・dry-run client・両network禁止を全部確認する。モック実行コードにTelegram/SMS/電話provider呼出しはない。

| Method / path | MCP（`engagement_` prefix） | Kumo操作 |
|---|---|---|
| GET /templates | templates | 業種選択・専用フィールド |
| GET /records/:kind?after=&limit=&customerId= | list | 各台帳一覧・顧客絞り込み・ページ送り |
| POST /profiles | profile | 業種情報/年齢確認/利用同意の追記 |
| POST /visits | visit | 来店・担当・指名・コース・ボトル |
| POST /calls | call | 手入力着信/発信記録 |
| POST /calls/webhook | call_webhook | 通話Webhook模擬入力 |
| POST /videos | video | 動画/リンク登録 |
| POST /video-events | video_event | 反応の模擬証跡 |
| POST /segments | segment | ANDセグメント定義 |
| POST /segments/preview | preview | 対象/除外理由・次ページ |
| POST /campaigns | campaign | セグメント配信のモック予約 |
| POST /scenarios | scenario | 遅延/条件/遷移先の作成 |
| POST /enrollments | enroll | シナリオへcontact登録 |
| GET /executions?after=&limit= | executions | 進行・履歴・payload一覧 |
| POST /executions/stop | stop | 配信停止 |
| POST /run | run | 期限到来分の明示モック処理 |

recordsのkindはprofiles/visits/calls/videos/video-events/segments/scenarios/campaigns。一覧は50件既定・100件上限、UIは25件。実行IDは構成要素のため100文字を超え得るのでexecutionsのカーソルだけ400文字上限。顧客詳細と既存`/export`のschemaVersion=1には新台帳を混ぜていない。新台帳は上記recordsを全ページ読んで保存できるが、横断スナップショットexport/復元は未完。

## 永続化・再試行・権限

migration `0005_engagement.sql`。`crm_engagement`に不変定義/履歴、`crm_executions`に配信状態と履歴を保持。新規schemaと旧DB migrationの両方を検証。既存データを書き換えない。

- 記録のrequestKeyは種類内で一意。同一内容は同じ結果、別内容への流用は409。プロフィール変更は新しいキーで追記し、DB挿入順の最新を採用。再送では最新状態を巻き戻さない。
- セグメント計画は宛先・条件・本文/動画・期限・nextCursorを固定して先に永続化。途中で実行作成が失敗しても同じリクエストを再送すれば元計画の不足分を補える。後から同意した新しい顧客を古い計画に追加しない。
- モック処理の直前にcontact所有者、kind、Bot scope、確認、marketing最新同意、最新業種同意、現在のセグメント条件を再確認。不可ならstopped。許可を付け直しても過去ジョブを復活しない。
- `UPDATE ... WHERE version=? AND state='active'`の単一SQLで履歴と進行をまとめて確定。競合した実行者は結果を追加しない。これは**外部通信のexactly-once保証ではない**。ライブ送信にはlease/unknown/照合/承認/再試行が必要。
- 電話Webhookは管理者向けの模擬入口。実Twilio/Vonage等を受信する公開入口ではない。将来のprovider adapterで署名/時刻/イベントIDを検証し、検証済みイベントだけこの台帳へ正規化する。
- SMSはphase2の`CommunicationsProvider` / `MockCommunications`境界を維持。今回に不要な自動発信は追加しない。

## 処理量と制限

スケジューラは自動起動しない。1回の実行はdue indexから最大100件、セグメントpreviewはBot別contact最大100件。各contactについて顧客/プロフィール/同意を照合するため、最大件数に比例した複数SQLが発生する。UIの通常表示は一覧とテンプレ取得の2リクエスト。実行の履歴は最大30ステップで頭打ち。プロフィールは顧客×kind×sequence索引で最新1件を読む。

Bot連絡先取得には既存の(kind,value,scope)一意制約とは別に(kind,scope,id)の索引を追加。全件export/集計・自動Cron・大規模配信は今回対象外で、D1課金・遅延の100倍/1000倍測定は未実施。SQLiteテスト成功を本番負荷保証にしない。

## 検証

`pnpm check`、`pnpm --filter web build`、`node scripts/phase3-http-smoke.mjs`。Vitestでは実SQLite＋実localhost HTTP/MCPで遅延/true・false分岐/動画・リンク/停止/同意撤回/他Bot拒否/重複処理/ページング/旧DB移行・再起動を確認する。HTTP smokeは一時合成DBと自身のサーバーだけを用い、9タブのSSR・Server Action・CSS・画面から台帳への保存を確認後に片付ける。

ブラウザ起動禁止のため、実画面の視覚QA・スクリーンショット・キーボード操作やTelegram実機表示は未検証。これをE2E済みという理由で視覚確認済みにしない。ログと最終コミットは指定の `~/claudecode/telegram-harness-tasks/20261105/phase3/STATUS.md` を参照。
