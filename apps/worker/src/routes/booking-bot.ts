import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CrmError } from '@telegram-harness/db';
import type { Deps } from '../deps.js';
import { MockCommunications } from '../services/communications.js';
import { body, text, page } from './crm.js';
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new CrmError('invalid_update', 400);
    return value as Record<string, unknown>;
}
function id(value: unknown, negative = false): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0 || (!negative && value < 0))
        throw new CrmError('invalid_telegram_id', 400);
    return String(value);
}
function month(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
        throw new CrmError('invalid_month', 400);
    return value;
}
function adjacent(value: string, offset: number) {
    const d = new Date(`${value}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + offset);
    return d.toISOString().slice(0, 7);
}
export function mountBookingBot(app: Hono, deps: Deps) {
    const router = new Hono();
    // This is an authenticated mock ingress, never mounted as a public Telegram webhook.
    const provider = new MockCommunications();
    router.use('*', bodyLimit({ maxSize: 65536 }));
    router.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        if (deps.env.TELEGRAM_BOOKING_MOCK !== 'true' || deps.telegram.mode !== 'dry-run' || deps.env.TELEGRAM_ALLOW_NETWORK === 'true' || deps.env.TELEGRAM_USER_ALLOW_NETWORK === 'true')
            return c.json({ success: false, error: 'booking_mock_disabled' }, 503);
        if (!deps.repo.crm)
            return c.json({ success: false, error: 'crm_storage_unavailable' }, 503);
        return next();
    });
    router.onError((e, c) => e instanceof CrmError ? c.json({ success: false, error: e.code }, e.status) : c.json({ success: false, error: 'booking_error' }, 500));
    const repo = () => deps.repo.crm!;
    async function calendar(value: string) {
        const selected = month(value);
        const slots = await repo().calendar(selected, deps.now().toISOString());
        const available = slots.filter(s => (s.booked ?? 0) < s.capacity);
        return { month: selected, timeZone: 'UTC', slots, reply_markup: { inline_keyboard: [
                    ...available.map(s => [{ text: `${s.startsAt.slice(5, 16).replace('T', ' ')} UTC · ${s.title}`, callback_data: `book:${s.id}` }]),
                    [{ text: '‹ 前月', callback_data: `cal:${adjacent(selected, -1)}` }, { text: '翌月 ›', callback_data: `cal:${adjacent(selected, 1)}` }],
                ] }, text: `${selected} の予約カレンダー（UTC）${available.length ? '' : '：空き枠なし'}` };
    }
    router.get('/calendar', async (c) => c.json({ success: true, data: await calendar(c.req.query('month') ?? deps.now().toISOString().slice(0, 7)) }));
    router.post('/update', async (c) => {
        const b = await body(c.req);
        const bot = text(b, 'botId', 64);
        if (!/^[a-zA-Z0-9_-]+$/.test(bot))
            throw new CrmError('invalid_botId', 400);
        const update = object(b.update);
        if (typeof update.update_id !== "number" || !Number.isSafeInteger(update.update_id) || update.update_id < 0)
            throw new CrmError("invalid_update_id", 400);
        const updateId = String(update.update_id);
        const callback = update.callback_query ? object(update.callback_query) : null;
        const callbackId = callback ? text(callback, 'id', 128) : null;
        const message = object(callback ? callback.message : update.message);
        const from = object(callback ? callback.from : message.from);
        if (from.is_bot !== false || message.sender_chat)
            throw new CrmError('human_sender_required', 400);
        const userId = id(from.id), chat = object(message.chat), chatId = id(chat.id, true);
        if (!['private', 'group', 'supergroup'].includes(String(chat.type)))
            throw new CrmError('unsupported_chat', 400);
        if (chat.type !== 'private' && Number(chatId) >= 0)
            throw new CrmError('group_chat_mismatch', 400);
        if (chat.type === 'private' && chatId !== userId)
            throw new CrmError('private_chat_mismatch', 400);
        const threadId = message.message_thread_id === undefined ? null : Number(id(message.message_thread_id));
        const data = callback ? text(callback, 'data', 64) : text(message, 'text', 150);
        // Addressed commands must target this configured mock bot; no anonymous/channel identities.
        const command = data.match(/^\/book(?:@([A-Za-z0-9_]+))?(?: (\d{4}-\d{2}))?$/);
        if (command?.[1] && command[1].toLowerCase() !== bot.toLowerCase())
            throw new CrmError('wrong_bot', 400);
        if (command || (callback && data.startsWith('cal:'))) {
            const result = await calendar(command ? (command[2] ?? deps.now().toISOString().slice(0, 7)) : data.slice(4));
            return c.json({ success: true, data: { ...result, mode: 'mock', chat_id: chatId, message_thread_id: threadId, ...(callbackId ? {answerCallbackQuery:{callback_query_id:callbackId,text:result.text}} : {}) } });
        }
        if (!callback || !/^book:[a-zA-Z0-9-]{1,50}$/.test(data))
            throw new CrmError('unsupported_command', 400);
        const now = deps.now().toISOString();
        const contact = await repo().telegramCustomer(bot, userId, text(from, 'first_name', 120), now);
        const booking = await repo().book({ id: crypto.randomUUID(), customerId: contact.customerId, slotId: data.slice(5), requestKey: `tg:${bot}:${updateId}`, status: 'confirmed', createdAt: now, cancelledAt: null });
        await repo().attachBookingRoute(booking.id, contact.id, 'telegram', chatId, threadId, 'mock-telegram');
        return c.json({ success: true, data: { booking, mode: 'mock', answerCallbackQuery: { callback_query_id: callbackId, text: '予約を受け付けました。' }, reminderConsentRequired: true } });
    });
    router.post('/phone', async (c) => {
        const b = await body(c.req), contact = await repo().getContact(text(b, 'contactId', 100));
        if (!contact || contact.kind !== 'phone')
            throw new CrmError('phone_contact_required', 400);
        const channel = b.channel ?? 'sms';
        if (channel !== 'sms' && channel !== 'voice')
            throw new CrmError('invalid_channel', 400);
        const booking = await repo().book({ id: crypto.randomUUID(), customerId: contact.customerId, slotId: text(b, 'slotId', 100), requestKey: `phone:${text(b, 'requestKey', 90)}`, status: 'confirmed', createdAt: deps.now().toISOString(), cancelledAt: null });
        await repo().attachBookingRoute(booking.id, contact.id, channel, contact.value, null, 'staff-phone');
        return c.json({ success: true, data: booking });
    });
    router.get('/notifications', async (c) => {
        const p = page(n => c.req.query(n)), items = await repo().notifications(p.after, p.limit);
        return c.json({ success: true, data: items, nextCursor: items.length === p.limit ? items.at(-1)!.id : null });
    });
    router.post('/notifications/run', async (c) => {
        const now = deps.now().toISOString(), results = [];
        for (const job of await repo().dueNotifications(now)) {
            const reason = job.status !== 'confirmed' ? 'booking_cancelled' : job.startsAt <= now ? 'slot_started' : !job.verifiedAt ? 'unverified_contact' : (job.kind === 'reminder' || job.channel !== 'telegram') && job.consent !== 'granted' ? 'booking_consent_missing' : null;
            // Atomic claim before mock execution; live delivery needs unknown/failed/reconcile states.
            if (!await repo().finishNotification(job.id, reason ? 'skipped' : 'mocked', reason ?? 'mock_only', now))
                continue;
            if (reason)
                results.push({ id: job.id, status: 'skipped', reason });
            else
                results.push({ id: job.id, ...await provider.deliver({ idempotencyKey: job.id, channel: job.channel, destination: job.destination, threadId: job.threadId, text: `${job.kind === 'confirmation' ? '予約確認' : '予約リマインダー'} ${job.startsAt}（UTC）` }) });
        }
        return c.json({ success: true, data: results, mode: 'mock' });
    });
    app.route('/api/crm/booking-bot', router);
}
