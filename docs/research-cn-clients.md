# Telegram Harness — 中国語圏クライアント・Bot運用OSS調査

確認日: 2026-11-05（JST）。「中国系」は中国語圏で利用・開発される関連プロジェクトを指す調査枠で、国籍・運営法人・安全性を推定するラベルではない。機能は公式サイト／README、ライセンスと更新日はGitHub APIで確認。更新日は**既定ブランチ最新commitのcommitter日時（UTC）**。push日時・リリース日・APK更新日とは区別する。[取得記録](security/logs/20261105/github-research.json)。クライアント実行・APK導入・コード取り込みはしていない。

## クライアント

| 対象・出典 | 機能・注意 | ライセンス | 最終更新（UTC） | MITリポジトリへの取り込み判定／参考にする部分 |
|---|---|---|---|---|
| [Nekogram](https://github.com/Nekogram/Nekogram) | 翻訳エンジン切替、チャット／記事翻訳、外観・フォルダ調整 | [GPL-2.0](https://github.com/Nekogram/Nekogram/blob/main/LICENSE) | [2026-10-28T03:35:52Z](https://github.com/Nekogram/Nekogram/commit/199abde0f100d92cee8d925337561633e6e11186) | **コード複製不可（MITのみでは再配布不可）**。翻訳の設定導線・必要機能を小さくまとめるUIの発想のみ |
| [NekoX](https://github.com/NekoX-Dev/NekoX) | 従来のNekoXは翻訳・通知・入力メニュー等を拡張。現URLのREADMEはTelegram Android一般説明であり、元配布物との継続性は未確認 | [GPL-2.0](https://github.com/NekoX-Dev/NekoX/blob/master/LICENSE) | [2026-02-14T12:56:36Z](https://github.com/NekoX-Dev/NekoX/commit/3581a10f8ecaa0f6d42d7a77442742caf95c6a13) | **コード複製不可（MITのみでは再配布不可）**。機能の発想のみ。配布APKや過去の拡張コードは未取得 |
| [Nagram](https://github.com/NextAlone/Nagram) | NekoX由来のAndroid拡張、翻訳、入力・メニュー・通知の改善 | [GPL-3.0](https://github.com/NextAlone/Nagram/blob/main/LICENSE) | [2026-10-20T13:13:00Z](https://github.com/NextAlone/Nagram/commit/87863c8a57854c739e1452e56591c07ea52415d3) | **コード複製不可（MITのみでは再配布不可）**。設定分類・翻訳導線の仕様のみ |
| [Telegram-FOSS](https://github.com/Telegram-FOSS-Team/Telegram-FOSS) | 公式Androidから非自由な部品を置換・除去するFOSS向けfork | [GPL-2.0](https://github.com/Telegram-FOSS-Team/Telegram-FOSS/blob/master/LICENSE) | [2024-07-07T17:04:16Z](https://github.com/Telegram-FOSS-Team/Telegram-FOSS/commit/10da5406ed92d30c6add3b25d40b2b3b6995d873) | **コード複製不可（MITのみでは再配布不可）**。依存と通信先を明示する運用設計のみ |
| [Forkgram（FOSS系比較枠）](https://github.com/forkgram/TelegramAndroid) | Androidクライアントの追加設定 | [GPL-2.0](https://github.com/forkgram/TelegramAndroid/blob/dev/LICENSE) | [2026-10-26T09:54:06Z](https://github.com/forkgram/TelegramAndroid/commit/f7f9472ed45cbec41f2914962cf2c387eb662047) | **コード複製不可（MITのみでは再配布不可）**。設定整理の発想のみ。中国発と断定しない |
| [Turrit](https://iturrit.com/) | 翻訳中心のTelegramクライアント。公式サイトはTelegramコード/API利用と説明 | 不明。今回公式ページから対応GitHub・ライセンスを特定できず | 不明（サイト更新日を製品リリース日と扱わない） | **コード複製不可（許諾不明）**。翻訳／言語切替の機能要件だけ参考 |
| 「纸飞机」名の再配布・中国語化サイト群 | 単一プロジェクトを特定できない呼称。名称だけでは公式・fork・単なる翻訳パックを区別できない | 不明。実体が公式Android/DesktopならそれぞれGPLだが、未特定物へ当てはめない | 不明 | **コード・配布物の取り込み不可**。出自が確定するまで採用候補にしない。[Telegram公式アプリ一覧](https://telegram.org/apps)と公開ソースを照合する |

## Bot運用の公開ツール・ライブラリ

中国語圏の運用Botに加え、比較基準として主要な汎用Botフレームワークを含む。ランキングや利用者数は未測定。

| 対象・出典 | 機能・注意 | ライセンス | 最終更新（UTC） | MITリポジトリへの取り込み判定／参考にする部分 |
|---|---|---|---|---|
| [grammY](https://github.com/grammyjs/grammY) | Bot APIフレームワーク、ミドルウェア・プラグイン | [MIT](https://github.com/grammyjs/grammY/blob/main/LICENSE) | [2026-10-16T15:43:25Z](https://github.com/grammyjs/grammY/commit/e8b3b1bec0ecb0cd76af7f3996354027ba94c303) | **条件付き可（著作権・MIT許諾表示を保持）**。候補npm grammy。今回は導入せず独自の小さいモック処理を維持 |
| [Telegraf](https://github.com/telegraf/telegraf) | Node.js Botフレームワーク、コマンド・コンテキスト処理 | [MIT](https://github.com/telegraf/telegraf/blob/v4/LICENSE) | [2026-09-24T15:15:52Z](https://github.com/telegraf/telegraf/commit/776b0f3c8b5903e10ecf53e67ebad6be0413cfa6) | **条件付き可（著作権・MIT許諾表示を保持）**。候補npm telegraf。組織内運用の実装パターン |
| [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) | Node.js Bot APIラッパー、受信イベント処理 | [MIT](https://github.com/yagop/node-telegram-bot-api/blob/master/LICENSE.md) | [2026-11-04T00:53:14Z](https://github.com/yagop/node-telegram-bot-api/commit/466bc50ec8e8c91eff527d8089058e8ca8fa12fb) | **条件付き可（著作権・MIT許諾表示を保持）**。同名npm候補。既存SDKとの機能重複を評価 |
| [rssbot](https://github.com/iovxw/rssbot) | 中国語圏のRSS購読・更新通知Bot（Rust） | [Unlicense](https://github.com/iovxw/rssbot/blob/2.x/UNLICENSE) | [2026-07-21T08:43:01Z](https://github.com/iovxw/rssbot/commit/fa441dae34d65f38a3f6ebabaa6313cc30a59c9f) | **可（Unlicense本文を確認・保持、同梱依存は別確認）**。購読管理・通知重複抑止の仕様 |
| [RSSHub（運用周辺）](https://github.com/DIYgod/RSSHub) | 情報源をRSSに変換。Bot本体ではなく通知運用の情報入口 | [AGPL-3.0](https://github.com/DIYgod/RSSHub/blob/master/LICENSE) | [2026-11-05T10:43:28Z](https://github.com/DIYgod/RSSHub/commit/32706ee76976d04773bb1cacb6d3f94e1846bb92) | **コード複製不可（MITのみでは再配布不可）**。取り込み元と配信を分離する設計のみ |
| [pmcenter](https://github.com/Elepover/pmcenter) | DMの受付・転送を支援するBot | [Apache-2.0](https://github.com/Elepover/pmcenter/blob/master/LICENSE) | [2020-05-29T01:12:25Z](https://github.com/Elepover/pmcenter/commit/a982a799629de408979694ec91032e10d1239e68) | **条件付き可（Apache本文・NOTICE等を維持、元コードをMITへ改称しない）**。顧客受付とオペレーター処理の役割分離 |
| [GramJS（MTProto比較）](https://github.com/gram-js/gramjs) | 本人アカウントのMTProtoクライアント。Botフレームワークとは別 | [MIT](https://github.com/gram-js/gramjs/blob/master/LICENSE) | [2026-07-14T19:50:48Z](https://github.com/gram-js/gramjs/commit/3dc2346fb15ee5a73a03bce3bd191e7d28c76f06) | **条件付き可（著作権・MIT許諾表示を保持）**。npm名は telegram。既存の隔離された本人アカウント層のみ。アーカイブ済み |

## 判断と今回の採用範囲

GPL/AGPLは「オープンソースだからMITへコピー可能」とは扱わない。MITの既存部分と共存できる場面と、GPL由来コードをMITのみで再ライセンスすることは別である。今回の禁止条件に従い、該当コード・アイコン・翻訳資産・UI画像は複製しない。独自実装の対象は抽象的な機能要件（設定分類、翻訳入口、購読状態、通知の重複防止）だけ。

MIT部品も著作権・許諾表示が必要。[MIT本文](https://opensource.org/license/mit)。Apache-2.0部品は原ライセンス、変更表示、該当NOTICE等を保持する。[Apache-2.0本文](https://www.apache.org/licenses/LICENSE-2.0)。実際の移植前には対象ファイル・依存・配布資産単位で再確認する。表の「可」は無条件の安全性・採用推奨ではない。

今回の予約実装は公式Bot APIのインラインボタン仕様から独自に実装した。Nekogram/NekoX/Nagram等のコード・画面素材は不使用。クライアントをforkしてもBotのDM権限やメンバー取得範囲は増えない。Turritの速度・制限に関する広告表現は検証・採用していない。スパム、制限回避、大量招待、他人へのなりすまし機能は対象外。

NekoXの過去機能は後継側に残る[README.NekoX.md](https://github.com/NextAlone/Nagram/blob/main/README.NekoX.md)でも照合したが、現在の同名リポジトリとの履歴の継続性・署名一致は不明。Telegram-FOSSとpmcenterは既定ブランチの更新が長く空いている。GramJSはGitHub archived、npm deprecatedの両方を確認済み。[npm監査](security/npm-audit-20261105.md)を参照。
