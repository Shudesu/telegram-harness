# フェーズ1検証記録

2026-11-05。ローカル環境、合成データのみ。Telegramへの接続・送信、チャンネル操作、デプロイ、push、公開は実施していない。

| 検証 | 結果 |
|---|---|
| `pnpm check` | 成功。秘密パターン検査、全workspace型検査、16ファイル・62テスト |
| `pnpm --filter web build` | 成功。Kumo顧客・予約ページとmiddlewareをビルド |
| SQLite/D1互換adapter | 新規・既存migration、再起動保持、定員競合、冪等性、取消、同意撤回、ページング、認証のテスト成功 |
| MCP stdio | initialize / tools/listでCRM 14ツール。tools/callからローカル管理APIへの読み取り成功。全14操作は統合テストでも確認 |
| 起動中API | 合成顧客・連絡先・同意・枠・予約・再連絡候補を確認。Telegram呼出し0件 |
| 起動中Next | 顧客・予約ページHTTP 200、合成データ入りSSR HTML、CSS応答、Inputのアクセシブル名、HTMLへのAPIキー非露出を確認 |
| UI境界 | 想定外Hostは403、TELEGRAM_LOCAL_UI=falseでも403。loopback専用、Cloud認証の代替ではない |
| gitleaks | 履歴全体とステージ済み差分をredact付きで検査し0件。秘密値は出力しない |
| ブラウザ視覚QA・スクリーンショット | **未実施**。ユーザー共通指示でブラウザ操作が禁止されているため。SSR HTMLはスクリーンショットの代替ではない |
| 実D1・Telegram実機・Stars・Cloud | 未実施／後続フェーズ |

ログ・gitleaks JSON・git証跡・STATUSは依頼指定の非公開buildディレクトリへ保存。SSR HTML・合成検証DB・Next buildは外部ディスクへ保存し、リポジトリには含めない。初回のUI Host検査でNextのURL正規化による拒否漏れを検出し、実Hostヘッダーの検査へ修正してHTTPで再確認した。

フェーズ1の全完了には、両画面を実際に表示した視覚確認とスクリーンショット保存が残る。依頼された項目を縮小せず保留として扱う。
