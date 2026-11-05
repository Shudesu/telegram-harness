# Telegram Harness — 機能比較

フェーズ2のモック予約実装は [phase2.md](phase2.md)、Botのチャット種別機能表は [bot-capabilities.md](bot-capabilities.md) を参照。以下の未実装記載はフェーズ1時点の記録。

確認日: 2026-11-05。公式公開資料の仕様と、このリポジトリの実装範囲は別である。フェーズ1はローカルCRM・予約・候補抽出のみ。Telegramの実操作、Login、Mini Apps、決済は未実装／未実機検証。

| 方式 | できること | できないこと・誤解しやすい点 | 審査・制約・認証 | 公式出典 |
|---|---|---|---|---|
| Bot API | Bot主体の受信・投稿・ボタン・権限内のグループ管理・決済イベント | 任意の相手へのDM開始、全参加者の顧客台帳化、Bot間でのDM権限移植。通常の送信予約はアプリ側のキューが必要 | トークンとBotの権限が必要。Webhook/getUpdatesは排他。未受信更新は最大24時間。Privacy Mode、権限、レート制限がある | [Bot API](https://core.telegram.org/bots/api)、[Bot FAQ](https://core.telegram.org/bots/faq) |
| MTProto / GramJS | 本人アカウントが許されたチャット操作、履歴参照、サーバー側予約、ユーザー専用フォルダ管理等 | Botにユーザー権限を与えること、BANやFloodWaitの回避、無権限データの取得 | api_id/api_hashとユーザーセッション。アカウント規約と権限に従う。GramJSは第三者ライブラリ。接続・セッションは独立したNodeプロセスに隔離 | [Telegram API](https://core.telegram.org/api)、[API Terms](https://core.telegram.org/api/terms)、[予約API](https://core.telegram.org/api/scheduled-messages)、[GramJS公式](https://gram.js.org/) |
| Mini Apps | Telegram内のWeb UI、予約カレンダー・入力フォーム、テーマ対応、利用者確認を伴う連絡先要求・書込み許可、支払い画面 | Web UIを足してもBot権限は増えない。全参加者情報・メールの自動取得、Botトークンの安全なブラウザ保持はできない | HTTPS、起動経路やクライアントによる機能差。サーバーでinitDataを検証する。ストア掲載・認証バッジと通常起動は別問題 | [Mini Apps](https://core.telegram.org/bots/webapps)、[Bot開発者規約](https://telegram.org/tos/bot-developers) |
| Telegram Login Widget（従来方式） | 外部WebサイトでTelegram ID・公開プロフィールを使って認証 | メール・電話の自動取得、本人の他チャット履歴取得、包括的なCRM配信同意 | Botとドメインの設定。SHA256(bot_token)を鍵とするHMAC検証、auth_dateの鮮度検査。Mini Appとは鍵導出が異なる | [従来Widget公式](https://core.telegram.org/widgets/login-legacy) |
| Telegram Login（現行OIDC） | 外部サイト／アプリのログイン。許可されたscopeでプロフィール・電話番号・Bot書込み許可 | ログイン成功だけでは再連絡・マーケティング同意を得たことにならない | Allowed URLs、Client ID/Secret、Authorization Code + PKCE。JWT署名・iss/aud/exp・nonce/stateを検査。phoneは本人同意が必要 | [現行Login公式](https://core.telegram.org/bots/telegram-login) |
| Mini App initData認証 | Telegram起動コンテキストをサーバーで検証して自社セッションに交換 | initDataUnsafeやクライアント指定customerIdを信用すること。管理APIキーを顧客へ渡すこと | WebAppDataを鍵としてBotトークンから導出したHMAC鍵で検証。auth_dateの期限と再利用対策。第三者検証には公式Ed25519方式もある | [initData検証](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) |
| Stars | デジタル商品・サービスのXTR請求、支払いイベント、返金。専用テスト環境 | pre_checkout承認やフロントの支払い完了表示だけで入金確定すること。Stars導入が全商流の許可を意味すること | Telegram内のデジタル商品はStars。pre_checkoutは10秒以内に応答。successful_paymentを確認しcharge IDを保存。規約・購入条件・サポート・返金対応が必要 | [Stars公式](https://core.telegram.org/bots/payments-stars)、[Bot開発者規約](https://telegram.org/tos/bot-developers) |

## Mini Appsと「Bot API全面利用」の違い

Mini Appsは顧客の操作画面、Bot APIはサーバーからTelegramへ行う操作・受信の窓口であり、代替関係ではない。予約画面はMini App、定員・顧客・同意・予約の正本はHarness DB、通知は承認と同意を確認したBot APIで扱う。Bot APIのメソッドをすべてラップしても、顧客統合、空き枠排他、認証、同意管理、バックアップ、決済照合は自動的に完成しない。[Mini Apps公式](https://core.telegram.org/bots/webapps)、[Bot API公式](https://core.telegram.org/bots/api)

## 審査の扱い

Starsの公式導入ページは、全Bot共通の「事前申請で必ず承認を得る制度」を明示していない。**本製品では利用業種・商品区分・対象国・規約・返金／問い合わせ体制の運営側審査を必須の導入ゲートにする**。必要なTelegram側／決済事業者側の審査・制限は個別確認する。「審査済み」「換金可能」を未確認で表示しない。物理商品・対面サービスとデジタルサービスは商流を判定し、Starsを一律適用しない。[Stars導入条件](https://core.telegram.org/bots/payments-stars#going-live)、[物理商品等の決済](https://core.telegram.org/bots/payments)

BAN時も顧客台帳は保持するが、別Botから同じTelegram IDへ無条件でDMできるわけではない。本人同意のあるメール・電話等で正規の再登録導線を案内し、新Botの利用開始・権限と同意を再確認する。制限回避、大量DM、参加者収集、日本向けオンラインカジノ誘導は対象外。[Bot制約](https://core.telegram.org/bots#how-are-bots-different-from-humans)、[Spam FAQ](https://telegram.org/faq_spam)
