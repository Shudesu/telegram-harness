'use server';
import { redirect } from 'next/navigation';
import { crmApi } from '../api';
const value = (f: FormData, k: string) => String(f.get(k) ?? '');
export async function mockUpdate(f: FormData) {
    let notice = '';
    let selected = value(f, 'calendarMonth');
    try {
        const chatType = value(f, 'chatType') || 'private', userId = Number(value(f, 'userId'));
        const message = { message_id: 1, chat: { id: Number(value(f, 'chatId')), type: chatType }, ...(value(f, 'threadId') ? { message_thread_id: Number(value(f, 'threadId')) } : {}) };
        const from = { id: userId, is_bot: false, first_name: value(f, 'displayName') };
        const callback = value(f, 'callback');
        const update = { update_id: Number(value(f, 'updateId')), ...(callback ? { callback_query: { id: `mock-${value(f, 'updateId')}`, from, message, data: callback } } : { message: { ...message, from, text: value(f, 'command') } }) };
        const result = await crmApi<{
            data: {
                booking?: {
                    id: string;
                };
                text?: string;
                month?: string;
            };
        }>('booking-bot/update', { botId: value(f, 'botId'), update });
        selected = result.data.month ?? selected;
        notice = result.data.booking ? `予約を登録しました: ${result.data.booking.id}` : result.data.text ?? 'カレンダーを作成しました';
    }
    catch (e) {
        notice = e instanceof Error ? e.message : '受付に失敗しました';
    }
    redirect(`/crm/booking-bot?notice=${encodeURIComponent(notice)}${selected ? `&month=${encodeURIComponent(selected)}` : ""}`);
}
export async function phoneIntake(f: FormData) {
    let notice = '電話予約を登録しました';
    try {
        await crmApi('booking-bot/phone', { contactId: value(f, 'contactId'), slotId: value(f, 'slotId'), requestKey: value(f, 'requestKey'), channel: value(f, 'channel') });
    }
    catch (e) {
        notice = e instanceof Error ? e.message : '受付に失敗しました';
    }
    redirect(`/crm/booking-bot?notice=${encodeURIComponent(notice)}`);
}
export async function runNotifications() {
    let notice = '';
    try {
        const r = await crmApi<{
            data: Array<{
                status: string;
            }>;
        }>('booking-bot/notifications/run', {});
        notice = `モック通知処理: ${r.data.filter(x => x.status === 'mocked').length}件、スキップ: ${r.data.filter(x => x.status === 'skipped').length}件`;
    }
    catch (e) {
        notice = e instanceof Error ? e.message : '処理に失敗しました';
    }
    redirect(`/crm/booking-bot?notice=${encodeURIComponent(notice)}`);
}
export async function contactAction(f: FormData) {
    let notice = '連絡先・同意を保存しました';
    try {
        const action = value(f, 'action'), contactId = value(f, 'contactId');
        if (action === 'add')
            await crmApi(`customers/${encodeURIComponent(value(f, 'customerId'))}/contacts`, { kind: 'phone', value: value(f, 'phone') });
        else if (action === 'verify')
            await crmApi(`contacts/${encodeURIComponent(contactId)}/verify`, { evidence: value(f, 'evidence') });
        else
            await crmApi(`contacts/${encodeURIComponent(contactId)}/consents`, { purpose: 'booking', status: value(f, 'status'), evidence: value(f, 'evidence'), policyVersion: 'booking-v1', occurredAt: new Date().toISOString() });
    }
    catch (e) {
        notice = e instanceof Error ? e.message : '保存に失敗しました';
    }
    redirect(`/crm/booking-bot?notice=${encodeURIComponent(notice)}`);
}
