import type { ToolDef } from './tools.js';
import type { TelegramHarnessClient } from '@telegram-harness/sdk';
const string = { type: 'string' };
export const bookingToolDefs: ToolDef[] = [
    { name: 'booking_calendar', description: 'Telegram Harness: 月別インラインカレンダー（モック）。日時はUTC。', inputSchema: { type: 'object', properties: { month: string } } },
    { name: 'booking_mock_update', description: 'Telegram Harness: 管理者用の模擬Telegram update。/book・callbackで台帳に予約。実送信なし。', inputSchema: { type: 'object', properties: { botId: string, update: { type: 'object' } }, required: ['botId', 'update'] } },
    { name: 'booking_phone_intake', description: 'Telegram Harness: 電話の手入力受付。既存phone連絡先へ紐付け、送信はモック。', inputSchema: { type: 'object', properties: { contactId: string, slotId: string, requestKey: string, channel: { type: 'string', enum: ['sms', 'voice'] } }, required: ['contactId', 'slotId', 'requestKey'] } },
    { name: 'booking_list_notifications', description: 'Telegram Harness: 予約確認・リマインダーの状態一覧。', inputSchema: { type: 'object', properties: { after: string, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
    { name: 'booking_run_notifications', description: 'Telegram Harness: 期限到来の通知をモック処理。取消・同意撤回を再照合。', inputSchema: { type: 'object', properties: {} } },
];
export async function executeBookingTool(client: TelegramHarnessClient, name: string, args: Record<string, unknown>) {
    const base = '/api/crm/booking-bot';
    switch (name) {
        case 'booking_calendar': return client.get(`${base}/calendar?${new URLSearchParams(args.month === undefined ? {} : { month: String(args.month) })}`);
        case 'booking_mock_update': return client.post(`${base}/update`, args);
        case 'booking_phone_intake': return client.post(`${base}/phone`, args);
        case 'booking_list_notifications': {
            const q = new URLSearchParams();
            for (const k of ['after', 'limit'])
                if (args[k] !== undefined)
                    q.set(k, String(args[k]));
            return client.get(`${base}/notifications?${q}`);
        }
        case 'booking_run_notifications': return client.post(`${base}/notifications/run`, {});
        default: throw new Error('unknown_booking_tool');
    }
}
