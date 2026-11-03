# 汎用 API 操作の使い方

管理用 API キーが必要。HTTP・SDK・MCP は同じ型定義と検証・承認経路を使う。[全対応表と制約](api-coverage.md) を参照。

## Bot API

`POST /api/bot/requests` に以下を渡すと `pending` 操作を返す。ボットは既存の `/api/bots` で登録した ID を指定する。チャット登録は必須ではなく、公式パラメータの `chat_id` を承認対象に含める。

```json
{
  "botId": "登録済みボットのID",
  "method": "sendPoll",
  "params": {
    "chat_id": "@example_channel",
    "question": "参加できる日を選んでください",
    "options": [{"text": "月曜日"}, {"text": "火曜日"}],
    "allows_multiple_answers": true
  }
}
```

1. `GET /api/account/actions/:id` または承認画面で、対象・金額・本文など全引数を確認。
2. `POST /api/account/actions/:id/approve`。scheduled になるがまだ送信しない。
3. `POST /api/publisher/run`。予定時刻に達した承認済みだけを実行。
4. `GET /api/account/actions/:id` の status / result を確認。

MCP は `request_bot_api` → `get_account_action` → `approve_account_action` → `run_publisher`。Bot の読み取りは `read_bot_api` / `POST /api/bot/read`。既存 `list_account_actions` で両プロバイダのキューを一覧できる。failed は `requeue_account_action` で pending に戻してから再承認。scheduled の取消は `cancel_account_action`。

## オーナーアカウント

`POST /api/user/requests` / MCP `request_user_api`:

```json
{
  "operation": "send_message",
  "params": {"peer": "me", "text": "自分へのメモ"},
  "scheduledAt": "2026-12-01T00:00:00Z"
}
```

読み取りは `POST /api/user/read` / `read_user_api` で、例は `{"operation":"history","params":{"peer":"me","limit":20}}`。既読にはしない。ログイン済みの所有者セッションが必要。Bot だけの操作にはオーナーセッションは不要。

## 型とアップロード

`GET /api/operations` / `list_api_operations` で一覧、`GET /api/operations?provider=bot&name=sendPhoto` / `get_api_operation` で構造を取得する。プロバイダは `bot` / `user`。MCP の入力 schema にも同じメソッド別型を埋め込む。

型付き SDK:

```ts
await client.requestBotApi(botId, "sendPhoto", {
  chat_id: "@example_channel",
  photo: { filename: "image.png", base64: encodedImage, contentType: "image/png" },
  caption: "写真の説明",
});
await client.readBotApi(botId, "getChat", { chat_id: "@example_channel" });
await client.requestUserApi("send_message", { peer: "me", text: "メモ" });
```

Bot のネストしたメディア・サムネイルも同じ `InputFile` 形式で指定可能。publisher が `attach://` と multipart に変換する。URL の事前ダウンロードや任意ローカルパスの読み込みはしない。オーナーの file は `filename` と `base64` を指定する。

Webhook・決済の秘密値は `{"secretEnvName":"TELEGRAM_WEBHOOK_SECRET"}` または `{"secretEnvName":"TELEGRAM_PAYMENT_PROVIDER_MAIN"}`。秘密値の直書きは拒否し、実行時に秘密ストアから解決する。参照先は承認から実行までの間に変わり得るため、秘密のローテーション時は関連する予約操作を確認する。

## 運用境界

新規書込の保存型は account_actions の `bot_api_call` / `user_api_call`。既存の bot drafts と同じ publisher で処理する。Bot / オーナーそれぞれ最大20件を取得し、無効なプロバイダの待ち行列が別プロバイダを妨げない。期限が短い API に対する承認省略、レートエラーの自動再送は行わない。

UI・MCP・HTTP の承認は既存の単一管理 API キーによる認可。別人承認やロール分離を新設したものではない。既存の環境設定の扱いは維持し、この変更の検証では実サーバーを起動しない。
