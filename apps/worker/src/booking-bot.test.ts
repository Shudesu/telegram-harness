import { afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { D1Repo, createNodeSqliteD1 } from '@telegram-harness/db';
import { openNodeSqliteRepo } from '@telegram-harness/db/sqlite';
import { DryRunTelegram } from '@telegram-harness/telegram-sdk';
import { TelegramHarnessClient } from '../../../packages/sdk/src/index.js';
import { executeTool, toolDefs } from '../../../packages/mcp/src/tools.js';
import { createApp } from './app.js';
import { MockCommunications } from './services/communications.js';
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length)
    cleanup.pop()!(); vi.restoreAllMocks(); });
function fixture(enabled = true) {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../../packages/db/schema.sql', import.meta.url), 'utf8'));
    cleanup.push(() => db.close());
    const repo = new D1Repo(createNodeSqliteD1(db)), telegram = new DryRunTelegram();
    let now = new Date('2026-11-05T00:00:00Z');
    const app = createApp({ repo, telegram, env: { API_KEY: 'test-booking-key', INTAKE_API_KEY: 'intake', TELEGRAM_BOOKING_MOCK: enabled ? 'true' : 'false' }, now: () => now });
    const client = new TelegramHarnessClient('http://local.test', 'test-booking-key', (async (url, init) => app.request(String(url), init)) as typeof fetch);
    const run = (name: string, args: Record<string, unknown> = {}) => executeTool(client, name, args) as Promise<any>;
    const post = (path: string, b: unknown) => client.post(`/api/crm/${path}`, b) as Promise<any>;
    const slot = async (capacity = 2) => (await run('crm_create_slot', { title: '相談', startsAt: '2026-11-07T00:00:00Z', endsAt: '2026-11-07T01:00:00Z', capacity })).data;
    const update = (data: string, updateId = 1, userId = 10001, chatId = -10001) => ({ botId: 'harness_demo', update: { update_id: updateId, ...(data.startsWith('/') ? { message: { message_id: 1, from: { id: userId, is_bot: false, first_name: '合成' }, chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' }, message_thread_id: 7, text: data } } : { callback_query: { id: `cb-${updateId}`, from: { id: userId, is_bot: false, first_name: '合成' }, message: { message_id: 1, chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' }, message_thread_id: 7 }, data } }) } });
    return { app, db, repo, telegram, client, run, post, slot, update, clock: (date: string) => { now = new Date(date); } };
}
describe('Telegram Harness booking mock E2E', () => {
    it('real localhost HTTP: group command → inline calendar → callback → ledger → confirmation → consent → reminder', async () => {
        const f = fixture();
        const server = serve({ fetch: f.app.fetch, port: 0, hostname: '127.0.0.1' });
        cleanup.push(() => server.close());
        await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string')
            throw Error('no_port');
        const client = new TelegramHarnessClient(`http://127.0.0.1:${address.port}`, 'test-booking-key');
        const run = (name: string, args: Record<string, unknown> = {}) => executeTool(client, name, args) as Promise<any>;
        const s = await f.slot();
        const cal = await run('booking_mock_update', f.update('/book@harness_demo 2026-11'));
        expect(cal.data).toMatchObject({ chat_id: '-10001', message_thread_id: 7 });
        expect(cal.data.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(`book:${s.id}`);
        const r = await run('booking_mock_update', f.update(`book:${s.id}`, 2));
        const b = r.data.booking;
        expect(b.customerId).toBe('tg:harness_demo:10001');
        expect((await run('booking_mock_update', f.update(`book:${s.id}`, 2))).data.booking.id).toBe(b.id);
        expect((await run('crm_get_customer', { customerId: b.customerId })).data.bookings).toHaveLength(1);
        expect((await run('booking_run_notifications')).data).toMatchObject([{ status: 'mocked' }]);
        expect((await run('booking_run_notifications')).data).toEqual([]);
        await run('crm_record_consent', { contactId: b.customerId, purpose: 'booking', status: 'granted', evidence: 'synthetic explicit reminder opt-in', policyVersion: 'booking-v1', occurredAt: '2026-11-05T00:00:00Z' });
        f.clock('2026-11-06T00:00:00Z');
        expect((await run('booking_run_notifications')).data).toMatchObject([{ status: 'mocked' }]);
        expect((await run('booking_list_notifications')).data.map((j: any) => j.status)).toEqual(['mocked', 'mocked']);
        expect(f.db.prepare('SELECT destination,thread_id FROM crm_booking_routes').get()).toMatchObject({ destination: '-10001', thread_id: 7 });
        expect(f.telegram.calls).toEqual([]);
    });
    it('authenticates every route and explicitly disables mock ingress in other runtimes', async () => {
        const f = fixture();
        for (const [path, method] of [['calendar', 'GET'], ['update', 'POST'], ['phone', 'POST'], ['notifications', 'GET'], ['notifications/run', 'POST']]) {
            for (const key of ['', 'intake'])
                expect((await f.app.request(`/api/crm/booking-bot/${path}`, { method, headers: { authorization: `Bearer ${key}` } })).status).toBe(401);
        }
        expect((await fixture(false).app.request('/api/crm/booking-bot/calendar', { headers: { authorization: 'Bearer test-booking-key' } })).status).toBe(503);
    });
    it('rejects invalid updates and bot/channel/anonymous identities; sender owns group booking', async () => {
        const f = fixture(), s = await f.slot();
        const bad = [{}, f.update('/book@other_bot'), f.update('book:missing', 5), f.update('/book', 6, 10001, 10002)];
        for (const b of bad)
            await expect(f.run('booking_mock_update', b)).rejects.toThrow();
        const bot = f.update(`book:${s.id}`, 2);
        (bot.update as any).callback_query.from.is_bot = true;
        await expect(f.run('booking_mock_update', bot)).rejects.toThrow();
        const channel = f.update('/book');
        (channel.update as any).message.chat.type = 'channel';
        await expect(f.run('booking_mock_update', channel)).rejects.toThrow();
        const anonymous = f.update('/book');
        (anonymous.update as any).message.sender_chat = { id: -1 };
        await expect(f.run('booking_mock_update', anonymous)).rejects.toThrow();
        await expect(f.run('booking_calendar', { month: '2026-13' })).rejects.toThrow();
        const r = await f.run('booking_mock_update', { ...f.update(`book:${s.id}`, 3, 10002), customerId: 'forged' });
        expect(r.data.booking.customerId).toBe('tg:harness_demo:10002');
    });
    it('capacity, concurrent callback replay, request conflicts, cancellation and revoked reminders', async () => {
        const f = fixture(), s = await f.slot(1);
        const update = f.update(`book:${s.id}`, 2);
        const a = await Promise.all([f.run('booking_mock_update', update), f.run('booking_mock_update', update)]);
        expect(a[0].data.booking.id).toBe(a[1].data.booking.id);
        await expect(f.run('booking_mock_update', f.update(`book:${s.id}`, 3, 10002))).rejects.toThrow();
        const other = await f.slot();
        await expect(f.run('booking_mock_update', f.update(`book:${other.id}`, 2))).rejects.toThrow();
        await f.run('crm_cancel_booking', { bookingId: a[0].data.booking.id });
        expect((await f.run('booking_mock_update', update)).data.booking.status).toBe('cancelled');
        const b = (await f.run('booking_mock_update', f.update(`book:${s.id}`, 4, 10002))).data.booking;
        for (const status of ['granted', 'revoked'])
            await f.run('crm_record_consent', { contactId: b.customerId, purpose: 'booking', status, evidence: 'synthetic', policyVersion: 'v1', occurredAt: '2026-11-05T00:00:00Z' });
        const results = await Promise.all([f.run('booking_run_notifications'), f.run('booking_run_notifications')]);
        expect(results.flatMap(r => r.data)).toHaveLength(2);
        f.clock('2026-11-06T00:00:00Z');
        expect((await f.run('booking_run_notifications')).data.map((j: any) => j.reason).sort()).toEqual(['booking_cancelled', 'booking_consent_missing']);
    });
    it('phone staff intake, verification/consent gates and mock SMS/voice providers', async () => {
        const f = fixture();
        expect(toolDefs.filter(t => t.name.startsWith('booking_'))).toHaveLength(5);
        const c = (await f.run('crm_create_customer', { displayName: '電話テスト', source: 'phone' })).data;
        const contact = (await f.run('crm_add_contact', { customerId: c.id, kind: 'phone', value: '+819000000001' })).data;
        const s = await f.slot();
        const args = { contactId: contact.id, slotId: s.id, requestKey: 'phone-1', channel: 'voice' };
        const b = (await f.run('booking_phone_intake', args)).data;
        expect((await f.run('booking_phone_intake', args)).data.id).toBe(b.id);
        expect((await f.run('booking_run_notifications')).data[0].reason).toBe('unverified_contact');
        await f.run('crm_verify_contact', { contactId: contact.id, evidence: 'synthetic check' });
        await f.run('crm_record_consent', { contactId: contact.id, purpose: 'booking', status: 'granted', evidence: 'synthetic opt-in', policyVersion: 'v1', occurredAt: '2026-11-05T00:00:00Z' });
        const s2 = await f.slot();
        await f.run('booking_phone_intake', { ...args, slotId: s2.id, requestKey: 'phone-2', channel: 'sms' });
        expect((await f.run('booking_run_notifications')).data[0].status).toBe('mocked');
        f.clock('2026-11-06T00:00:00Z');
        expect((await f.run('booking_run_notifications')).data).toHaveLength(2);
        const provider = new MockCommunications();
        const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('network forbidden'));
        for (const channel of ['sms', 'voice'] as const)
            for (let i = 0; i < 2; i++)
                await provider.deliver({ idempotencyKey: channel, channel, destination: '+819000000001', text: 'synthetic' });
        expect(provider.calls.map(c => c.channel)).toEqual(['sms', 'voice']);
        expect(network).not.toHaveBeenCalled();
    });
    it('migrates existing storage and persists notification state across restart', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'th-phase2-'));
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
        const path = join(dir, 'test.sqlite');
        let handle = openNodeSqliteRepo(path);
        const crm = handle.repo.crm, now = '2026-11-05T00:00:00.000Z';
        const contact = await crm.telegramCustomer('bot', '100', 'Test', now);
        await crm.createSlot({ id: 's', title: 'Slot', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-01T01:00:00.000Z', capacity: 1, createdAt: now });
        await crm.book({ id: 'b', customerId: contact.customerId, slotId: 's', requestKey: 'k', status: 'confirmed', createdAt: now, cancelledAt: null });
        await crm.attachBookingRoute('b', contact.id, 'telegram', '100', null, 'mock');
        await crm.finishNotification('b:confirmation', 'mocked', 'mock_only', now);
        handle.close();
        handle = openNodeSqliteRepo(path);
        cleanup.push(() => handle.close());
        expect((await handle.repo.crm.notifications()).map(x => x.status)).toEqual(['mocked', 'pending']);
    });
});
