# Telegram Harness — Bot機能マップ

確認日: 2026-11-05。公式Bot API仕様と今回のローカル実装を区別する。権限はBotごと・チャットごとに判定。既存FAQに比べAPI本文の方が新機能を含む場合があり、対象メソッドの条件を優先する。

| 機能 | 1対1（private） | グループ／supergroup | チャンネル | 条件・できないこと／公式出典 |
|---|---|---|---|---|
| 受信 | ユーザーとのメッセージを受信 | Privacy Modeで範囲が変わる | Botが参加するchannelの投稿更新 | [FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get)、[Update](https://core.telegram.org/bots/api#update)。過去履歴全取得のAPIではない |
| コマンド | /start、/book等 | /book@botnameを明示するのが確実。一般コマンドは配信条件あり | 読者のコマンド入力場所としては通常使わない。リンクからBotへ誘導 | [Privacy](https://core.telegram.org/bots/features#privacy-mode)。管理者Botまたはprivacy無効は受信が広いが、権限拡張・無差別収集とは別 |
| 投稿 | 利用者が開始・許可した経路で送信。任意の相手へ勝手にDM開始不可 | 参加・送信権限が必要 | can_post_messages等の管理権限が必要 | [Bots](https://core.telegram.org/bots#how-are-bots-different-from-humans)、[管理者権限](https://core.telegram.org/bots/api#chatadministratorrights) |
| インラインボタン | callback_data / URL | 同じ。押した人はCallbackQuery.fromで特定 | 投稿に付けられる。読者全員の属性は取得しない | [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)、[CallbackQuery](https://core.telegram.org/bots/api#callbackquery)。callback_dataは1〜64 bytes。回答はanswerCallbackQuery |
| Web Appボタン | InlineKeyboardButton.web_appはユーザーとBotのprivate限定。キーボード型もprivate限定 | 同じweb_appボタンをそのまま置けない。通常URL・deep linkから別導線 | 同様 | [ボタン仕様](https://core.telegram.org/bots/api#inlinekeyboardbutton)、[KeyboardButton](https://core.telegram.org/bots/api#keyboardbutton) |
| Mini App直接リンク | 起動方法に応じたコンテキスト | startapp/direct link等から起動可。通常のBotメッセージとは別の権限 | リンクを配布できる | [起動経路](https://core.telegram.org/bots/webapps#launching-mini-apps)。HTTPS、サーバーinitData検証。リンクからの起動だけでは任意メッセージ送信権限を得ない |
| トピック | topic mode有効BotのprivateトピックをAPI本文がサポート | forum supergroupのmessage_thread_id指定。作成／編集等はメソッド別の権限 | 通常チャンネル投稿はforum topicではない。linked discussionは別chat | [sendMessage](https://core.telegram.org/bots/api#sendmessage)、[createForumTopic](https://core.telegram.org/bots/api#createforumtopic)、[editForumTopic](https://core.telegram.org/bots/api#editforumtopic)。編集はcan_manage_topics等、削除はcan_delete_messages等 |
| 参加リクエスト承認／拒否 | 通常privateでは非該当 | 管理者＋can_invite_users | 管理者＋can_invite_users | [approveChatJoinRequest](https://core.telegram.org/bots/api#approvechatjoinrequest)、[decline](https://core.telegram.org/bots/api#declinechatjoinrequest)。本人のリクエストを扱う機能で、大量招待ではない |
| 参加申請者への連絡 | ChatJoinRequest.user_chat_idに限定的な連絡窓口 | 申請イベントから得る | 同左 | [ChatJoinRequest](https://core.telegram.org/bots/api#chatjoinrequest)。5分かつ申請処理前等の条件。恒久的DM許可にしない |
| メンバー確認 | 自分との相手情報 | getChatMember/getChatMemberCount/getChatAdministrators | 同様、権限条件あり | [getChatMember](https://core.telegram.org/bots/api#getchatmember)。他ユーザーの取得保証は管理者時。全加入者を列挙する一般メソッドではない |
| メンバー管理 | グループの管理とは別 | ban/unban、supergroup restrict、適切な管理者のpromote | ban/unban/promote等、権限が必要 | [ban](https://core.telegram.org/bots/api#banchatmember)、[restrict](https://core.telegram.org/bots/api#restrictchatmember)、[promote](https://core.telegram.org/bots/api#promotechatmember)。自身より上の権限を自由に与えることは不可 |
| 連絡先・電話取得 | request_contactを本人が押すなど明示操作 | request_contactボタンは使えない | 同左 | [KeyboardButton](https://core.telegram.org/bots/api#keyboardbutton)。参加者の電話番号・メールを自動取得しない |
| 編集／削除 | 対象メッセージ・期限などの条件あり | 同左＋管理権限 | 投稿／編集／削除権限別 | [editMessageText](https://core.telegram.org/bots/api#editmessagetext)、[deleteMessage](https://core.telegram.org/bots/api#deletemessage)。他人の全メッセージを無条件に編集・削除不可 |
| 予約・リマインダー | アプリ側でDB・時刻・同意を管理 | topic含む宛先の保存と送信権限を再照合 | 管理者の配信用途として別設計 | [sendMessage](https://core.telegram.org/bots/api#sendmessage)、[FAQ制限](https://core.telegram.org/bots/faq#how-do-i-avoid-hitting-limits)。予約台帳・定員・通知ジョブはBot APIが自動提供しない |
| 更新受取・認証 | webhook/getUpdates | 同左 | 同左（channel_post） | [getUpdates](https://core.telegram.org/bots/api#getupdates)、[setWebhook](https://core.telegram.org/bots/api#setwebhook)。排他、Webhook secret_tokenを検証。今回のupdateは管理キー付きモック入口のみ |

## 今回の実装境界

採用は**インラインボタン式の月別カレンダー**。`/book`または`/book@harness_demo YYYY-MM` → callback → `from.id + bot scope`の台帳 → 定員付き予約 → 確認／24時間前リマインダーをモック処理する。グループでは元chatとmessage_thread_idを保持する。匿名管理者・channel主体・Bot送信者は顧客として受け付けない。電話・表示名などの個人情報をグループ通知本文へ含めない。

Mini Appは今回の選択肢として調査したが実装していない。管理UIをMini Appとして公開しない。認証済み顧客セッション、initData、実Telegram webhook接続、実際の権限／privacy挙動・実機表示は未検証。ローカル管理者が模擬Updateを作れることと、Telegram上で本人認証済みであることを混同しない。
