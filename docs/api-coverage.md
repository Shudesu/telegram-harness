# Telegram API カバレッジ

確認日: **2026-11-04**。Bot API は [Telegram 公式リファレンス](https://core.telegram.org/bots/api) の **10.3（2026-08-24）** を取得し、185個のメソッド見出しを機械抽出した。MTProto は [GramJS の公式プロジェクトドキュメント](https://gram.js.org/beta/classes/TelegramClient.html) と固定依存 `telegram@2.26.22` の型・TLシリアライザを照合した。[予約履歴](https://core.telegram.org/method/messages.getScheduledHistory)、[ストーリー取得](https://core.telegram.org/method/stories.getPeerStories) は Telegram 公式の仕様も確認した。

「既存」はベース `3ee8d87` で実行経路が存在したもの。「追加」は今回、HTTP・SDK・MCP から共通ディスパッチャで扱えるようにしたもの。既存の Bot メソッドも今回の汎用入口から全パラメータを指定できる。「意図的に除外」は実行不可。追加とはモック検証済みの実装を指し、実 Telegram での成功を意味しない。

| 対象・集計単位 | 総数 | 既存 | 追加 | 意図的に除外 |
|---|---:|---:|---:|---:|
| Bot API の公式全メソッド | 185 | 11 | 170 | 4 |
| GramJS の本表に列挙した主要操作・除外機能群 | 60 | 18 | 32 | 10 |

GramJS の60件は全 MTProto RPC の総数ではない。既存 BotFather 操作を含む18操作、新設32操作、除外10機能群という集計。ログイン認証そのものとローカルセッション保管は比較対象外。既存の `user_session_forget` はローカル暗号文の破棄だけで、Telegram セッションを終了しない。

## 共通経路

| 区分 | HTTP | MCP | 実行条件 |
|---|---|---|---|
| 一覧 | `GET /api/operations` | `list_api_operations` | ローカル定義のみ |
| 操作の型 | `GET /api/operations?provider=bot&name=sendPoll` | `get_api_operation` | JSON Schema、権限区分、除外理由 |
| Bot 読取 | `POST /api/bot/read` | `read_bot_api` | 読取許可リストの30メソッドのみ |
| Bot 書込依頼 | `POST /api/bot/requests` | `request_bot_api` | 151メソッド、pending を作るだけ |
| オーナー読取 | `POST /api/user/read` | `read_user_api` | 読取10操作のみ |
| オーナー書込依頼 | `POST /api/user/requests` | `request_user_api` | 書込22操作、pending を作るだけ |
| 確認・承認 | `GET /api/account/actions/:id` → `POST /api/account/actions/:id/approve` | `get_account_action` → `approve_account_action` | 承認しても Telegram を呼ばない |
| 実行 | `POST /api/publisher/run` / cron | `run_publisher` | scheduled かつ予定時刻到来だけ |

`getUpdates` は offset によって更新の確認済み状態を変えるので書込扱い。`getFile` は Telegram ファイル情報を取得するだけで、Bot 用の生ファイルダウンロードエンドポイントではない。`readBusinessMessage`、既読、投票、コールバック応答、決済、Webhook 設定、ユーザープロフィール変更もすべて承認対象。失敗後は requeue → 新しい approve が必要。MCP の入力 JSON Schema はメソッド別の `oneOf` と型定義を含む。

## Bot API 全メソッド

「読取」は直接実行、「承認」は pending → approve → publisher。除外はどちらの入口でも拒否。

| メソッド（公式仕様） | 分類 | 経路・理由 |
|---|---|---|
| [getUpdates](https://core.telegram.org/bots/api#getupdates) | 追加 | 承認 |
| [setWebhook](https://core.telegram.org/bots/api#setwebhook) | 追加 | 承認 |
| [deleteWebhook](https://core.telegram.org/bots/api#deletewebhook) | 追加 | 承認 |
| [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo) | 追加 | 読取 |
| [getMe](https://core.telegram.org/bots/api#getme) | 既存 | 読取 |
| [logOut](https://core.telegram.org/bots/api#logout) | 意図的に除外 | Bot API サーバーのセッション終了を伴うため対象外 |
| [close](https://core.telegram.org/bots/api#close) | 意図的に除外 | Bot API インスタンスの終了を伴うため対象外 |
| [sendMessage](https://core.telegram.org/bots/api#sendmessage) | 既存 | 承認 |
| [forwardMessage](https://core.telegram.org/bots/api#forwardmessage) | 追加 | 承認 |
| [forwardMessages](https://core.telegram.org/bots/api#forwardmessages) | 追加 | 承認 |
| [copyMessage](https://core.telegram.org/bots/api#copymessage) | 追加 | 承認 |
| [copyMessages](https://core.telegram.org/bots/api#copymessages) | 追加 | 承認 |
| [sendPhoto](https://core.telegram.org/bots/api#sendphoto) | 既存 | 承認 |
| [sendLivePhoto](https://core.telegram.org/bots/api#sendlivephoto) | 追加 | 承認 |
| [sendAudio](https://core.telegram.org/bots/api#sendaudio) | 追加 | 承認 |
| [sendDocument](https://core.telegram.org/bots/api#senddocument) | 追加 | 承認 |
| [sendVideo](https://core.telegram.org/bots/api#sendvideo) | 既存 | 承認 |
| [sendAnimation](https://core.telegram.org/bots/api#sendanimation) | 追加 | 承認 |
| [sendVoice](https://core.telegram.org/bots/api#sendvoice) | 追加 | 承認 |
| [sendVideoNote](https://core.telegram.org/bots/api#sendvideonote) | 追加 | 承認 |
| [sendPaidMedia](https://core.telegram.org/bots/api#sendpaidmedia) | 追加 | 承認 |
| [sendMediaGroup](https://core.telegram.org/bots/api#sendmediagroup) | 既存 | 承認 |
| [sendLocation](https://core.telegram.org/bots/api#sendlocation) | 追加 | 承認 |
| [sendVenue](https://core.telegram.org/bots/api#sendvenue) | 追加 | 承認 |
| [sendContact](https://core.telegram.org/bots/api#sendcontact) | 追加 | 承認 |
| [sendPoll](https://core.telegram.org/bots/api#sendpoll) | 追加 | 承認 |
| [sendChecklist](https://core.telegram.org/bots/api#sendchecklist) | 追加 | 承認 |
| [sendDice](https://core.telegram.org/bots/api#senddice) | 追加 | 承認 |
| [sendMessageDraft](https://core.telegram.org/bots/api#sendmessagedraft) | 追加 | 承認 |
| [sendChatAction](https://core.telegram.org/bots/api#sendchataction) | 追加 | 承認 |
| [setMessageReaction](https://core.telegram.org/bots/api#setmessagereaction) | 追加 | 承認 |
| [getUserProfilePhotos](https://core.telegram.org/bots/api#getuserprofilephotos) | 追加 | 読取 |
| [getUserProfileAudios](https://core.telegram.org/bots/api#getuserprofileaudios) | 追加 | 読取 |
| [setUserEmojiStatus](https://core.telegram.org/bots/api#setuseremojistatus) | 追加 | 承認 |
| [getFile](https://core.telegram.org/bots/api#getfile) | 追加 | 読取 |
| [banChatMember](https://core.telegram.org/bots/api#banchatmember) | 追加 | 承認 |
| [unbanChatMember](https://core.telegram.org/bots/api#unbanchatmember) | 追加 | 承認 |
| [restrictChatMember](https://core.telegram.org/bots/api#restrictchatmember) | 追加 | 承認 |
| [promoteChatMember](https://core.telegram.org/bots/api#promotechatmember) | 追加 | 承認 |
| [setChatAdministratorCustomTitle](https://core.telegram.org/bots/api#setchatadministratorcustomtitle) | 追加 | 承認 |
| [setChatMemberTag](https://core.telegram.org/bots/api#setchatmembertag) | 追加 | 承認 |
| [banChatSenderChat](https://core.telegram.org/bots/api#banchatsenderchat) | 追加 | 承認 |
| [unbanChatSenderChat](https://core.telegram.org/bots/api#unbanchatsenderchat) | 追加 | 承認 |
| [setChatPermissions](https://core.telegram.org/bots/api#setchatpermissions) | 追加 | 承認 |
| [exportChatInviteLink](https://core.telegram.org/bots/api#exportchatinvitelink) | 追加 | 承認 |
| [createChatInviteLink](https://core.telegram.org/bots/api#createchatinvitelink) | 追加 | 承認 |
| [editChatInviteLink](https://core.telegram.org/bots/api#editchatinvitelink) | 追加 | 承認 |
| [createChatSubscriptionInviteLink](https://core.telegram.org/bots/api#createchatsubscriptioninvitelink) | 追加 | 承認 |
| [editChatSubscriptionInviteLink](https://core.telegram.org/bots/api#editchatsubscriptioninvitelink) | 追加 | 承認 |
| [revokeChatInviteLink](https://core.telegram.org/bots/api#revokechatinvitelink) | 追加 | 承認 |
| [approveChatJoinRequest](https://core.telegram.org/bots/api#approvechatjoinrequest) | 追加 | 承認 |
| [declineChatJoinRequest](https://core.telegram.org/bots/api#declinechatjoinrequest) | 追加 | 承認 |
| [answerChatJoinRequestQuery](https://core.telegram.org/bots/api#answerchatjoinrequestquery) | 追加 | 承認 |
| [sendChatJoinRequestWebApp](https://core.telegram.org/bots/api#sendchatjoinrequestwebapp) | 追加 | 承認 |
| [setChatPhoto](https://core.telegram.org/bots/api#setchatphoto) | 追加 | 承認 |
| [deleteChatPhoto](https://core.telegram.org/bots/api#deletechatphoto) | 追加 | 承認 |
| [setChatTitle](https://core.telegram.org/bots/api#setchattitle) | 追加 | 承認 |
| [setChatDescription](https://core.telegram.org/bots/api#setchatdescription) | 追加 | 承認 |
| [pinChatMessage](https://core.telegram.org/bots/api#pinchatmessage) | 追加 | 承認 |
| [unpinChatMessage](https://core.telegram.org/bots/api#unpinchatmessage) | 追加 | 承認 |
| [unpinAllChatMessages](https://core.telegram.org/bots/api#unpinallchatmessages) | 追加 | 承認 |
| [leaveChat](https://core.telegram.org/bots/api#leavechat) | 追加 | 承認 |
| [getChat](https://core.telegram.org/bots/api#getchat) | 既存 | 読取 |
| [getChatAdministrators](https://core.telegram.org/bots/api#getchatadministrators) | 追加 | 読取 |
| [getChatMemberCount](https://core.telegram.org/bots/api#getchatmembercount) | 既存 | 読取 |
| [getChatMember](https://core.telegram.org/bots/api#getchatmember) | 追加 | 読取 |
| [getUserPersonalChatMessages](https://core.telegram.org/bots/api#getuserpersonalchatmessages) | 追加 | 読取 |
| [setChatStickerSet](https://core.telegram.org/bots/api#setchatstickerset) | 追加 | 承認 |
| [deleteChatStickerSet](https://core.telegram.org/bots/api#deletechatstickerset) | 追加 | 承認 |
| [getForumTopicIconStickers](https://core.telegram.org/bots/api#getforumtopiciconstickers) | 追加 | 読取 |
| [createForumTopic](https://core.telegram.org/bots/api#createforumtopic) | 追加 | 承認 |
| [editForumTopic](https://core.telegram.org/bots/api#editforumtopic) | 追加 | 承認 |
| [closeForumTopic](https://core.telegram.org/bots/api#closeforumtopic) | 追加 | 承認 |
| [reopenForumTopic](https://core.telegram.org/bots/api#reopenforumtopic) | 追加 | 承認 |
| [deleteForumTopic](https://core.telegram.org/bots/api#deleteforumtopic) | 追加 | 承認 |
| [unpinAllForumTopicMessages](https://core.telegram.org/bots/api#unpinallforumtopicmessages) | 追加 | 承認 |
| [editGeneralForumTopic](https://core.telegram.org/bots/api#editgeneralforumtopic) | 追加 | 承認 |
| [closeGeneralForumTopic](https://core.telegram.org/bots/api#closegeneralforumtopic) | 追加 | 承認 |
| [reopenGeneralForumTopic](https://core.telegram.org/bots/api#reopengeneralforumtopic) | 追加 | 承認 |
| [hideGeneralForumTopic](https://core.telegram.org/bots/api#hidegeneralforumtopic) | 追加 | 承認 |
| [unhideGeneralForumTopic](https://core.telegram.org/bots/api#unhidegeneralforumtopic) | 追加 | 承認 |
| [unpinAllGeneralForumTopicMessages](https://core.telegram.org/bots/api#unpinallgeneralforumtopicmessages) | 追加 | 承認 |
| [answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery) | 追加 | 承認 |
| [answerGuestQuery](https://core.telegram.org/bots/api#answerguestquery) | 追加 | 承認 |
| [getUserChatBoosts](https://core.telegram.org/bots/api#getuserchatboosts) | 追加 | 読取 |
| [getBusinessConnection](https://core.telegram.org/bots/api#getbusinessconnection) | 追加 | 読取 |
| [getManagedBotToken](https://core.telegram.org/bots/api#getmanagedbottoken) | 意図的に除外 | 管理対象 Bot の秘密トークンを返すため汎用レスポンスから除外 |
| [replaceManagedBotToken](https://core.telegram.org/bots/api#replacemanagedbottoken) | 意図的に除外 | 管理対象 Bot の認証情報失効と秘密トークン返却を伴うため除外 |
| [getManagedBotAccessSettings](https://core.telegram.org/bots/api#getmanagedbotaccesssettings) | 追加 | 読取 |
| [setManagedBotAccessSettings](https://core.telegram.org/bots/api#setmanagedbotaccesssettings) | 追加 | 承認 |
| [setMyCommands](https://core.telegram.org/bots/api#setmycommands) | 追加 | 承認 |
| [deleteMyCommands](https://core.telegram.org/bots/api#deletemycommands) | 追加 | 承認 |
| [getMyCommands](https://core.telegram.org/bots/api#getmycommands) | 追加 | 読取 |
| [setMyName](https://core.telegram.org/bots/api#setmyname) | 追加 | 承認 |
| [getMyName](https://core.telegram.org/bots/api#getmyname) | 追加 | 読取 |
| [setMyDescription](https://core.telegram.org/bots/api#setmydescription) | 追加 | 承認 |
| [getMyDescription](https://core.telegram.org/bots/api#getmydescription) | 追加 | 読取 |
| [setMyShortDescription](https://core.telegram.org/bots/api#setmyshortdescription) | 追加 | 承認 |
| [getMyShortDescription](https://core.telegram.org/bots/api#getmyshortdescription) | 追加 | 読取 |
| [setMyProfilePhoto](https://core.telegram.org/bots/api#setmyprofilephoto) | 追加 | 承認 |
| [removeMyProfilePhoto](https://core.telegram.org/bots/api#removemyprofilephoto) | 追加 | 承認 |
| [setChatMenuButton](https://core.telegram.org/bots/api#setchatmenubutton) | 追加 | 承認 |
| [getChatMenuButton](https://core.telegram.org/bots/api#getchatmenubutton) | 追加 | 読取 |
| [setMyDefaultAdministratorRights](https://core.telegram.org/bots/api#setmydefaultadministratorrights) | 追加 | 承認 |
| [getMyDefaultAdministratorRights](https://core.telegram.org/bots/api#getmydefaultadministratorrights) | 追加 | 読取 |
| [getAvailableGifts](https://core.telegram.org/bots/api#getavailablegifts) | 追加 | 読取 |
| [sendGift](https://core.telegram.org/bots/api#sendgift) | 追加 | 承認 |
| [giftPremiumSubscription](https://core.telegram.org/bots/api#giftpremiumsubscription) | 追加 | 承認 |
| [verifyUser](https://core.telegram.org/bots/api#verifyuser) | 追加 | 承認 |
| [verifyChat](https://core.telegram.org/bots/api#verifychat) | 追加 | 承認 |
| [removeUserVerification](https://core.telegram.org/bots/api#removeuserverification) | 追加 | 承認 |
| [removeChatVerification](https://core.telegram.org/bots/api#removechatverification) | 追加 | 承認 |
| [readBusinessMessage](https://core.telegram.org/bots/api#readbusinessmessage) | 追加 | 承認 |
| [deleteBusinessMessages](https://core.telegram.org/bots/api#deletebusinessmessages) | 追加 | 承認 |
| [setBusinessAccountName](https://core.telegram.org/bots/api#setbusinessaccountname) | 追加 | 承認 |
| [setBusinessAccountUsername](https://core.telegram.org/bots/api#setbusinessaccountusername) | 追加 | 承認 |
| [setBusinessAccountBio](https://core.telegram.org/bots/api#setbusinessaccountbio) | 追加 | 承認 |
| [setBusinessAccountProfilePhoto](https://core.telegram.org/bots/api#setbusinessaccountprofilephoto) | 追加 | 承認 |
| [removeBusinessAccountProfilePhoto](https://core.telegram.org/bots/api#removebusinessaccountprofilephoto) | 追加 | 承認 |
| [setBusinessAccountGiftSettings](https://core.telegram.org/bots/api#setbusinessaccountgiftsettings) | 追加 | 承認 |
| [getBusinessAccountStarBalance](https://core.telegram.org/bots/api#getbusinessaccountstarbalance) | 追加 | 読取 |
| [transferBusinessAccountStars](https://core.telegram.org/bots/api#transferbusinessaccountstars) | 追加 | 承認 |
| [getBusinessAccountGifts](https://core.telegram.org/bots/api#getbusinessaccountgifts) | 追加 | 読取 |
| [getUserGifts](https://core.telegram.org/bots/api#getusergifts) | 追加 | 読取 |
| [getChatGifts](https://core.telegram.org/bots/api#getchatgifts) | 追加 | 読取 |
| [convertGiftToStars](https://core.telegram.org/bots/api#convertgifttostars) | 追加 | 承認 |
| [upgradeGift](https://core.telegram.org/bots/api#upgradegift) | 追加 | 承認 |
| [transferGift](https://core.telegram.org/bots/api#transfergift) | 追加 | 承認 |
| [postStory](https://core.telegram.org/bots/api#poststory) | 追加 | 承認 |
| [repostStory](https://core.telegram.org/bots/api#repoststory) | 追加 | 承認 |
| [editStory](https://core.telegram.org/bots/api#editstory) | 追加 | 承認 |
| [deleteStory](https://core.telegram.org/bots/api#deletestory) | 追加 | 承認 |
| [answerWebAppQuery](https://core.telegram.org/bots/api#answerwebappquery) | 追加 | 承認 |
| [savePreparedInlineMessage](https://core.telegram.org/bots/api#savepreparedinlinemessage) | 追加 | 承認 |
| [savePreparedKeyboardButton](https://core.telegram.org/bots/api#savepreparedkeyboardbutton) | 追加 | 承認 |
| [editMessageText](https://core.telegram.org/bots/api#editmessagetext) | 既存 | 承認 |
| [editMessageCaption](https://core.telegram.org/bots/api#editmessagecaption) | 既存 | 承認 |
| [editMessageMedia](https://core.telegram.org/bots/api#editmessagemedia) | 追加 | 承認 |
| [editMessageLiveLocation](https://core.telegram.org/bots/api#editmessagelivelocation) | 追加 | 承認 |
| [stopMessageLiveLocation](https://core.telegram.org/bots/api#stopmessagelivelocation) | 追加 | 承認 |
| [editMessageChecklist](https://core.telegram.org/bots/api#editmessagechecklist) | 追加 | 承認 |
| [editMessageReplyMarkup](https://core.telegram.org/bots/api#editmessagereplymarkup) | 既存 | 承認 |
| [stopPoll](https://core.telegram.org/bots/api#stoppoll) | 追加 | 承認 |
| [editEphemeralMessageText](https://core.telegram.org/bots/api#editephemeralmessagetext) | 追加 | 承認 |
| [editEphemeralMessageMedia](https://core.telegram.org/bots/api#editephemeralmessagemedia) | 追加 | 承認 |
| [editEphemeralMessageCaption](https://core.telegram.org/bots/api#editephemeralmessagecaption) | 追加 | 承認 |
| [editEphemeralMessageReplyMarkup](https://core.telegram.org/bots/api#editephemeralmessagereplymarkup) | 追加 | 承認 |
| [approveSuggestedPost](https://core.telegram.org/bots/api#approvesuggestedpost) | 追加 | 承認 |
| [declineSuggestedPost](https://core.telegram.org/bots/api#declinesuggestedpost) | 追加 | 承認 |
| [deleteMessage](https://core.telegram.org/bots/api#deletemessage) | 追加 | 承認 |
| [deleteMessages](https://core.telegram.org/bots/api#deletemessages) | 既存 | 承認 |
| [deleteEphemeralMessage](https://core.telegram.org/bots/api#deleteephemeralmessage) | 追加 | 承認 |
| [deleteMessageReaction](https://core.telegram.org/bots/api#deletemessagereaction) | 追加 | 承認 |
| [deleteAllMessageReactions](https://core.telegram.org/bots/api#deleteallmessagereactions) | 追加 | 承認 |
| [sendSticker](https://core.telegram.org/bots/api#sendsticker) | 追加 | 承認 |
| [getStickerSet](https://core.telegram.org/bots/api#getstickerset) | 追加 | 読取 |
| [getCustomEmojiStickers](https://core.telegram.org/bots/api#getcustomemojistickers) | 追加 | 読取 |
| [uploadStickerFile](https://core.telegram.org/bots/api#uploadstickerfile) | 追加 | 承認 |
| [createNewStickerSet](https://core.telegram.org/bots/api#createnewstickerset) | 追加 | 承認 |
| [addStickerToSet](https://core.telegram.org/bots/api#addstickertoset) | 追加 | 承認 |
| [setStickerPositionInSet](https://core.telegram.org/bots/api#setstickerpositioninset) | 追加 | 承認 |
| [deleteStickerFromSet](https://core.telegram.org/bots/api#deletestickerfromset) | 追加 | 承認 |
| [replaceStickerInSet](https://core.telegram.org/bots/api#replacestickerinset) | 追加 | 承認 |
| [setStickerEmojiList](https://core.telegram.org/bots/api#setstickeremojilist) | 追加 | 承認 |
| [setStickerKeywords](https://core.telegram.org/bots/api#setstickerkeywords) | 追加 | 承認 |
| [setStickerMaskPosition](https://core.telegram.org/bots/api#setstickermaskposition) | 追加 | 承認 |
| [setStickerSetTitle](https://core.telegram.org/bots/api#setstickersettitle) | 追加 | 承認 |
| [setStickerSetThumbnail](https://core.telegram.org/bots/api#setstickersetthumbnail) | 追加 | 承認 |
| [setCustomEmojiStickerSetThumbnail](https://core.telegram.org/bots/api#setcustomemojistickersetthumbnail) | 追加 | 承認 |
| [deleteStickerSet](https://core.telegram.org/bots/api#deletestickerset) | 追加 | 承認 |
| [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage) | 追加 | 承認 |
| [sendRichMessageDraft](https://core.telegram.org/bots/api#sendrichmessagedraft) | 追加 | 承認 |
| [answerInlineQuery](https://core.telegram.org/bots/api#answerinlinequery) | 追加 | 承認 |
| [sendInvoice](https://core.telegram.org/bots/api#sendinvoice) | 追加 | 承認 |
| [createInvoiceLink](https://core.telegram.org/bots/api#createinvoicelink) | 追加 | 承認 |
| [answerShippingQuery](https://core.telegram.org/bots/api#answershippingquery) | 追加 | 承認 |
| [answerPreCheckoutQuery](https://core.telegram.org/bots/api#answerprecheckoutquery) | 追加 | 承認 |
| [getMyStarBalance](https://core.telegram.org/bots/api#getmystarbalance) | 追加 | 読取 |
| [getStarTransactions](https://core.telegram.org/bots/api#getstartransactions) | 追加 | 読取 |
| [refundStarPayment](https://core.telegram.org/bots/api#refundstarpayment) | 追加 | 承認 |
| [editUserStarSubscription](https://core.telegram.org/bots/api#edituserstarsubscription) | 追加 | 承認 |
| [setPassportDataErrors](https://core.telegram.org/bots/api#setpassportdataerrors) | 追加 | 承認 |
| [sendGame](https://core.telegram.org/bots/api#sendgame) | 追加 | 承認 |
| [setGameScore](https://core.telegram.org/bots/api#setgamescore) | 追加 | 承認 |
| [getGameHighScores](https://core.telegram.org/bots/api#getgamehighscores) | 追加 | 読取 |

## GramJS 主要機能

| 操作 | 機能 | 分類 | 経路 |
|---|---|---|---|
| `list_own_chats` | 自分が作成者・管理者のチャット一覧 | 既存 | 読取 |
| `get_own_channel_stats` | チャンネル概要・閲覧数（increment: false） | 既存 | 読取 |
| `create_channel` | チャンネル作成 | 既存 | 承認 |
| `create_supergroup` | スーパーグループ作成 | 既存 | 承認 |
| `edit_title` | タイトル変更 | 既存 | 承認 |
| `edit_description` | 説明変更 | 既存 | 承認 |
| `edit_photo` | チャット写真変更 | 既存 | 承認 |
| `edit_username` | チャネルユーザー名変更 | 既存 | 承認 |
| `add_admin` | 管理者追加 | 既存 | 承認 |
| `remove_admin` | 管理者解除 | 既存 | 承認 |
| `botfather_create_bot` | BotFather で Bot 作成 | 既存 | 承認 |
| `botfather_set_name` | BotFather で名前変更 | 既存 | 承認 |
| `botfather_set_description` | BotFather で説明変更 | 既存 | 承認 |
| `botfather_set_about` | BotFather で短い説明変更 | 既存 | 承認 |
| `botfather_set_commands` | BotFather でコマンド変更 | 既存 | 承認 |
| `botfather_set_photo` | BotFather で写真変更 | 既存 | 承認 |
| `botfather_fetch_token` | BotFather トークンを秘密ストアへ保存 | 既存 | 承認 |
| `botfather_revoke_token` | BotFather の Bot トークン再発行（既存の承認経路） | 既存 | 承認 |
| `dialogs` | ダイアログ一覧（ページング） | 追加 | 読取 |
| `history` | 履歴（ページング） | 追加 | 読取 |
| `search` | チャット内検索（ページング） | 追加 | 読取 |
| `send_message` | 送信・返信・Telegram 予約投稿 | 追加 | 承認 |
| `edit_message` | メッセージ編集 | 追加 | 承認 |
| `delete_messages` | メッセージ削除 | 追加 | 承認 |
| `forward_messages` | 転送 | 追加 | 承認 |
| `send_media` | 写真・動画・音声・文書等のアップロード送信 | 追加 | 承認 |
| `download_media` | 受信メディアの小容量ダウンロード | 追加 | 読取 |
| `contacts` | 連絡先一覧（電話番号・access hash を返さない） | 追加 | 読取 |
| `delete_contact` | 指定連絡先の削除 | 追加 | 承認 |
| `folders` | フォルダ一覧 | 追加 | 読取 |
| `upsert_folder` | カスタムフォルダ作成・更新 | 追加 | 承認 |
| `delete_folder` | カスタムフォルダ削除 | 追加 | 承認 |
| `send_reaction` | 絵文字・カスタム絵文字リアクション、空指定で解除 | 追加 | 承認 |
| `stories` | 指定 peer の有効なストーリー取得 | 追加 | 読取 |
| `stories_by_id` | 指定 ID のストーリー取得 | 追加 | 読取 |
| `scheduled_messages` | Telegram 予約投稿一覧 | 追加 | 読取 |
| `send_scheduled` | Telegram 予約投稿の即時送出 | 追加 | 承認 |
| `delete_scheduled` | Telegram 予約投稿の削除 | 追加 | 承認 |
| `send_poll` | 投票・クイズ作成 | 追加 | 承認 |
| `vote_poll` | 投票（実際の option bytes の base64、空配列で撤回） | 追加 | 承認 |
| `stop_poll` | 投票停止 | 追加 | 承認 |
| `mark_read` | 既読変更 | 追加 | 承認 |
| `profile` | 自分のプロフィール取得 | 追加 | 読取 |
| `update_profile` | 名前・自己紹介変更 | 追加 | 承認 |
| `update_username` | 自分のユーザー名変更 | 追加 | 承認 |
| `update_profile_photo` | 自分のプロフィール写真アップロード | 追加 | 承認 |
| `join_channel` | 指定公開チャンネル・スーパーグループへ自分が参加 | 追加 | 承認 |
| `leave_channel` | 指定チャンネル・スーパーグループから自分が退出 | 追加 | 承認 |
| `pin_message` | ピン・解除 | 追加 | 承認 |
| `set_chat_permissions` | グループ既定権限の設定 | 追加 | 承認 |

### GramJS の意図的な除外

| 機能群 | 分類 | 理由 |
|---|---|---|
| アカウント削除 (`account.deleteAccount`) | 意図的に除外 | アカウントを失う破壊的操作。ユーザー指定により実装しない。 |
| セッション終了・他端末ログアウト (`auth.logOut`, `auth.resetAuthorizations`, `account.resetAuthorization`) | 意図的に除外 | 認証セッションの失効。ユーザー指定により実装しない。 |
| 2FA・パスワード変更／リセット | 意図的に除外 | 認証設定を失う・変更する操作。ユーザー指定により実装しない。 |
| ログインメール変更・復旧 | 意図的に除外 | 認証経路を変更する操作。ユーザー指定により実装しない。 |
| 電話番号変更・認証鍵／アカウント所有権移転 | 意図的に除外 | アカウントアクセスを失う操作。汎用 RPC は公開しない。 |
| 新規ユーザー登録 (`auth.signUp`) | 意図的に除外 | 既存の所有者アカウントだけを扱う方針。大量アカウント作成を提供しない。 |
| 連絡先インポート・一括追加 | 意図的に除外 | 既存ポリシーのスパム・電話帳収集防止。既存連絡先の取得と個別削除は提供。 |
| メンバー名簿収集・一斉 DM | 意図的に除外 | 既存ポリシーのスパム・収集防止。一度に指定できる送信先は一つ。 |
| 第三者を追加する招待 (`messages.addChatUser`, `channels.inviteToChannel`) | 意図的に除外 | 既存ポリシーの他人への招待防止。自分の参加・退出、Bot API 招待リンク管理は別。 |
| 通常グループ作成 (`messages.createChat`) | 意図的に除外 | メンバーの追加が必要になるため第三者招待の除外に含める。スーパーグループ作成は既存機能で提供。 |

## 制約と本番確認が必要な点

- 生成型・構造検証は公式のパラメータ表に基づく。文字数・メディア内容・条件付き必須・権限・課金残高など Telegram 側の意味的制約をすべて再実装するものではない。承認は Telegram 側の許可を保証しない。
- Bot のメディアは各メソッドで許される `file_id`、URL、inline base64 からの multipart。ローカルパスは読まない。base64 は1ファイル700,000文字以下、HTTP 本文は合計1,000,000バイト以下という Harness 独自の保管上限。大容量は外部で用意した URL / file_id を使う。`InputFile` しか許されない項目ではこれらを代用できない。
- オーナーのアップロードにも同じ base64 上限を使用。ダウンロードは512,000バイト以下の応答に限定し、超過はエラー（切り詰めて成功扱いにしない）。動画・音声などの指定は GramJS のファイル判定と `forceDocument` に従う。大容量転送・音声ノート等の詳細属性を指定する専用 UI はない。
- 新規オーナー送信先は一つの peer。数値 ID は既存ダイアログの解決情報が必要なことがある。raw access hash・セッション文字列・任意 TL 呼出は入力できない。フォルダの複数 peer は整理対象で、送信先リストではない。
- ストーリーは取得のみ。閲覧済み通知や閲覧数増加 RPC を自動で呼ばない。予約時刻 `scheduleDate` は Telegram の Unix 秒、`scheduledAt` は Harness publisher の UTC ISO 時刻で別のもの。
- `set_chat_permissions` は列挙した既定権限を置き換える操作で、未指定の禁止フラグは false（許可）。承認画面で引数を確認すること。
- `secret_token` と決済 `provider_token` は秘密値を保存せず `secretEnvName` を参照する。Stars の空 provider_token は `""` を指定可。対応する秘密名は `TELEGRAM_WEBHOOK_SECRET` と `TELEGRAM_PAYMENT_PROVIDER_*`。トークンを返す管理対象 Bot の2メソッドは除外。既存 BotFather の秘密ストア専用経路は維持。
- 支払・Stars・ギフト・ビジネス接続・ストーリー・チェックリスト・Rich Messages・Ephemeral Messages は呼出経路と型を実装した。アカウント資格・管理権限・利用可能範囲・費用は実行時の Telegram 規則に従う。
- コールバック、インライン、shipping/pre-checkout 応答には Telegram 側の有効期限がある。手動承認中に期限切れになり得る。承認を省略する自動応答は追加していない。
- 送信後の通信切断は成功・失敗を確定できないことがある。自動再送は行わない。`failed` / `publishing` の再処理前に実際の送信状態を確認すること。
- Bot の新規操作は account_actions の `result` に記録される。旧投稿専用の messages 一覧への自動同期は行わない。`getUpdates` の結果もこの結果欄に保存され、既存 Webhook inbox に自動取り込みはしない。
- 本番は未接続。実アカウントでの権限、返却データ、multipart、GramJS 固定 TL layer 互換性を別途確認する。DB 移行 `0003_api_operations.sql` はインメモリ SQLite で既存行保持を検証済み。本番 DB には適用していない。

## 再生成と検証

公式 HTML をローカルに取得し、`python3 scripts/generate-bot-api.py <公式HTMLのパス>` で型・構造検証用スキーマを再生成する。新しいメソッドは原則 write になり、read と除外の明示リストを人がレビューする。型が解釈できなければ生成を失敗させる。実行時には公式ドキュメントを取得しない。

`pnpm check` は secrets / typecheck / モックテスト。テストには fetch と TCP 接続を拒否する仕組みを追加し、Hono のインプロセスリクエストと注入したモックだけを使う。全185 Bot メソッドの権限境界、全32オーナー操作、実 GramJS TL 型のシリアライズ、MCP ルーティング、multipart、migration、重複承認・publisher 同時実行、失敗・再承認・予約・キャンセルを検証する。
