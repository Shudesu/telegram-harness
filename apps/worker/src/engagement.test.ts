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
const clean: Array<() => void> = [];
afterEach(() => { while (clean.length)
    clean.pop()!(); vi.restoreAllMocks(); });
function fixture(env: Record<string, string> = {}) {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../../packages/db/schema.sql', import.meta.url), 'utf8'));
    clean.push(() => db.close());
    const repo = new D1Repo(createNodeSqliteD1(db)), telegram = new DryRunTelegram();
    let stamp = '2026-11-05T00:00:00.000Z';
    const app = createApp({ repo, telegram, env: { API_KEY: 'synthetic-engagement-key', INTAKE_API_KEY: 'intake', TELEGRAM_ENGAGEMENT_MOCK: 'true', ...env }, now: () => new Date(stamp) });
    const client = new TelegramHarnessClient('http://local.test', 'synthetic-engagement-key', ((url, init) => app.request(String(url), init)) as typeof fetch);
    const run = (name: string, args: Record<string, unknown> = {}) => executeTool(client, name.startsWith('crm_') ? name : `engagement_${name}`, args) as Promise<any>;
    let seq = 0;
    const seed = async (bot = 'demo', grant = true, tags = ['VIP']) => {
        const c = (await run('crm_create_customer', { displayName: '合成', source: 'store', tags })).data;
        const contact = (await run('crm_add_contact', { customerId: c.id, kind: 'telegram', value: String(1000 + ++seq), scope: bot })).data;
        await run('crm_verify_contact', { contactId: contact.id, evidence: 'synthetic' });
        if (grant)
            await consent(contact.id, 'granted');
        return { c, contact };
    };
    const consent = (id: string, status: string) => run('crm_record_consent', { contactId: id, purpose: 'marketing', status, evidence: 'synthetic', policyVersion: 'v1', occurredAt: stamp });
    const scenario = (steps: unknown[], id = 's') => run('scenario', { requestKey: id, name: id, botId: 'demo', steps });
    const profile = (customerId: string, extra: Record<string, unknown> = {}) => run('profile', { requestKey: crypto.randomUUID(), customerId, industry: 'bar', fields: { preferredStaff: 'A', bottle: 'B-1' }, serviceConsent: 'granted', consentEvidence: 'synthetic opt-in', policyVersion: 'v1', ageStatus: 'verified', ageYears: 25, ageEvidence: 'synthetic staff check', ...extra });
    return { app, db, repo, telegram, client, run, seed, consent, scenario, profile, clock: (v: string) => { stamp = v; } };
}
const textMessage = { kind: 'text', text: '合成メッセージ' };
describe('Phase3 engagement mock', () => {
    it('real HTTP and MCP E2E: delayed branch → native video mock → completion, no network delivery', async () => {
        const f = fixture(), { c, contact } = await f.seed();
        await f.profile(c.id);
        const server = serve({ fetch: f.app.fetch, port: 0, hostname: '127.0.0.1' });
        clean.push(() => server.close());
        await new Promise<void>(r => server.listening ? r() : server.once('listening', r));
        const address = server.address();
        if (!address || typeof address === 'string')
            throw Error('port');
        const client = new TelegramHarnessClient(`http://127.0.0.1:${address.port}`, 'synthetic-engagement-key');
        const run = (name: string, args: Record<string, unknown> = {}) => executeTool(client, `engagement_${name}`, args) as Promise<any>;
        await run('video', { requestKey: 'video', title: '説明', mode: 'telegram', url: 'https://example.com/demo.mp4' });
        await run('scenario', { requestKey: 'steps', name: 'welcome', botId: 'demo', steps: [{ delayMinutes: 5, message: textMessage, condition: { field: 'tag', op: 'eq', value: 'absent' }, onTrue: 1, onFalse: 2 }, { delayMinutes: 0, message: textMessage, onTrue: null }, { delayMinutes: 2, message: { kind: 'video', videoId: 'video' }, onTrue: null }] });
        const e = (await run('enroll', { scenarioId: 'steps', contactId: contact.id })).data;
        expect((await run('run')).data).toEqual([]);
        f.clock('2026-11-05T00:05:00.000Z');
        expect((await run('run')).data[0]).toMatchObject({ status: 'branch_skipped', dueAt: '2026-11-05T00:07:00.000Z' });
        f.clock('2026-11-05T00:06:59.000Z');
        expect((await run('run')).data).toEqual([]);
        f.clock('2026-11-05T00:07:00.000Z');
        expect((await run('run')).data[0]).toMatchObject({ state: 'completed', payload: { method: 'sendVideo', chat_id: contact.value, video: 'https://example.com/demo.mp4' } });
        expect((await run('enroll', { scenarioId: 'steps', contactId: contact.id })).data.state).toBe('completed');
        expect((await run('executions')).data[0].data.history).toHaveLength(2);
        expect((await f.repo.crm.engagement.execution(e.id))?.version).toBe(2);
        expect(f.telegram.calls).toEqual([]);
    });
    it('concurrent runs commit a mock exactly once, stop and revoked consent stay stopped', async () => {
        const f = fixture(), { contact } = await f.seed();
        await f.scenario([{ delayMinutes: 0, message: textMessage }, { delayMinutes: 0, message: textMessage }]);
        const e = (await f.run('enroll', { scenarioId: 's', contactId: contact.id })).data;
        const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('external network forbidden'));
        const results = await Promise.all([f.run('run'), f.run('run')]);
        expect(results.flatMap(x => x.data)).toHaveLength(1);
        await f.consent(contact.id, 'revoked');
        expect((await f.run('run')).data[0]).toMatchObject({ status: 'skipped', reason: 'marketing_consent_missing', state: 'stopped' });
        await f.consent(contact.id, 'granted');
        expect((await f.run('run')).data).toEqual([]);
        expect((await f.run('stop', { executionId: e.id })).data.state).toBe('stopped');
        expect(spy).not.toHaveBeenCalled();
    });
    it('segment scope, current tags/consent, immutable recipient plan and idempotent fan-out', async () => {
        const f = fixture(), a = await f.seed(), b = await f.seed('demo', false), other = await f.seed('other');
        await f.run('segment', { requestKey: 'seg', name: 'VIP', botId: 'demo', rules: [{ field: 'tag', op: 'eq', value: 'VIP' }] });
        const preview = (await f.run('preview', { segmentId: 'seg' })).data;
        expect(preview.selected).toHaveLength(2);
        expect(preview.selected.map((x: any) => x.id)).not.toContain(other.contact.id);
        expect(preview.selected.find((x: any) => x.id === b.contact.id).reason).toBe('marketing_consent_missing');
        const args = { requestKey: 'camp', segmentId: 'seg', message: textMessage, dueAt: '2026-11-05T00:00:00Z' };
        const campaign = (await f.run('campaign', args)).data;
        expect(campaign.data.recipients).toHaveLength(1);
        await f.consent(b.contact.id, 'granted');
        await f.run('campaign', args);
        expect((await f.run('executions')).data).toHaveLength(1);
        await expect(f.run('campaign', { ...args, message: { kind: 'text', text: 'changed' } })).rejects.toThrow('idempotency_conflict');
        await f.run('crm_update_customer', { customerId: a.c.id, displayName: '合成', source: 'store', tags: [] });
        expect((await f.run('run')).data[0].reason).toBe('segment_no_longer_matches');
    });
    it('supports true branch, link video and response records without claiming playback', async () => {
        const f = fixture(), { c, contact } = await f.seed();
        await f.run('video', { requestKey: 'v', title: 'リンク', mode: 'link', url: 'https://example.com/watch' });
        await f.scenario([{ delayMinutes: 0, message: { kind: 'video', videoId: 'v' }, condition: { field: 'source', op: 'eq', value: 'store' }, onTrue: null, onFalse: null }]);
        await f.run('enroll', { scenarioId: 's', contactId: contact.id });
        expect((await f.run('run')).data[0].payload).toMatchObject({ method: 'sendMessage', text: 'リンク\nhttps://example.com/watch' });
        for (const event of ['link_clicked', 'self_reported_watched'])
            expect((await f.run('video_event', { requestKey: event, customerId: c.id, videoId: 'v', event, occurredAt: '2026-11-05T00:00:00Z', evidence: 'synthetic' })).data.data.verifiedPlayback).toBe(false);
        await expect(f.run('video_event', { requestKey: 'x', customerId: c.id, videoId: 'v', event: 'completed', occurredAt: '2026-11-05T00:00:00Z', evidence: 'synthetic' })).rejects.toThrow();
    });
    it('all six industry profiles, audited consent withdrawal, age and alcohol gates, visits', async () => {
        const f = fixture(), { c } = await f.seed();
        const templates = (await f.run('templates')).data;
        expect(Object.keys(templates)).toHaveLength(6);
        for (const industry of Object.keys(templates))
            await f.profile(c.id, { industry, fields: { preferredStaff: 'A' } });
        for (const extra of [{ ageStatus: 'unverified' }, { ageYears: 17 }, { ageEvidence: '' }, { fields: { secretField: 'x' } }])
            await expect(f.profile(c.id, extra)).rejects.toThrow();
        const visit = { requestKey: 'visit', customerId: c.id, occurredAt: '2026-11-05T00:00:00Z', staff: 'A', nomination: '本指名', course: 'standard', bottle: 'B-1', amountMinor: 5000, currency: 'JPY', alcohol: true };
        const r = (await f.run('visit', visit)).data;
        expect((await f.run('visit', visit)).data.id).toBe(r.id);
        await f.profile(c.id, { ageYears: 19 });
        await expect(f.run('visit', { ...visit, requestKey: 'under20' })).rejects.toThrow('alcohol_age_gate');
        await f.profile(c.id, { serviceConsent: 'revoked' });
        await expect(f.run('visit', { ...visit, requestKey: 'revoked' })).rejects.toThrow('service_consent_required');
        expect((await f.run('list', { kind: 'profiles', customerId: c.id, limit: 100 })).data).toHaveLength(8);
    });
    it('night consent withdrawal stops queued marketing; eligibility cannot cross bot', async () => {
        const f = fixture(), { c, contact } = await f.seed();
        await f.profile(c.id);
        await f.scenario([{ delayMinutes: 0, message: textMessage }]);
        const outsider = await f.seed('other');
        await expect(f.run('enroll', { scenarioId: 's', contactId: outsider.contact.id })).rejects.toThrow('contact_scope_mismatch');
        await f.run('enroll', { scenarioId: 's', contactId: contact.id });
        await f.profile(c.id, { serviceConsent: 'revoked' });
        expect((await f.run('run')).data[0].reason).toBe('night_service_gate');
    });
    it('manual + webhook calls store directions, number, customer, time and notes; no dialing', async () => {
        const f = fixture(), { c } = await f.seed();
        for (const [tool, direction] of [['call', 'incoming'], ['call_webhook', 'outgoing']]) {
            const args = { requestKey: tool, customerId: c.id, direction, number: '+819000000001', occurredAt: '2026-11-05T00:00:00Z', notes: 'synthetic' };
            expect((await f.run(tool!, args)).data.customerId).toBe(c.id);
            await f.run(tool!, args);
            await expect(f.run(tool!, { ...args, number: '+819000000002' })).rejects.toThrow('idempotency_conflict');
        }
        expect((await f.run('list', { kind: 'calls' })).data).toHaveLength(2);
        await expect(f.run('call', { requestKey: 'bad', customerId: 'missing', direction: 'incoming', number: '+819000000001', occurredAt: '2026-11-05T00:00:00Z' })).rejects.toThrow('customer_not_found');
    });
    it('all routes require admin and mock mode; intake key rejected, malformed/oversize rejected', async () => {
        const paths = [['templates', 'GET'], ['records/calls', 'GET'], ['executions', 'GET'], ...['profiles', 'visits', 'calls', 'calls/webhook', 'videos', 'video-events', 'segments', 'segments/preview', 'campaigns', 'scenarios', 'enrollments', 'executions/stop', 'run'].map(x => [x, 'POST'])];
        const f = fixture();
        for (const [path, method] of paths)
            for (const key of ['', 'intake'])
                expect((await f.app.request(`/api/crm/engagement/${path}`, { method, headers: { authorization: `Bearer ${key}` } })).status).toBe(401);
        for (const env of [{ TELEGRAM_ENGAGEMENT_MOCK: 'false' }, { TELEGRAM_ALLOW_NETWORK: 'true' }, { TELEGRAM_USER_ALLOW_NETWORK: 'true' }])
            expect((await fixture(env).app.request('/api/crm/engagement/templates', { headers: { authorization: 'Bearer synthetic-engagement-key' } })).status).toBe(503);
        for (const raw of ['{', '[]', 'x'.repeat(65537)])
            expect((await f.app.request('/api/crm/engagement/calls', { method: 'POST', headers: { authorization: 'Bearer synthetic-engagement-key', 'content-type': 'application/json' }, body: raw })).status).toBe(raw.length > 65536 ? 413 : 400);
    });
    it('rejects backwards loops, missing videos, invalid delays and unsafe URL schemes', async () => {
        const f = fixture();
        for (const steps of [[{ delayMinutes: 0, message: textMessage, onTrue: 0 }], [{ delayMinutes: -1, message: textMessage }], [{ delayMinutes: 0, message: { kind: 'video', videoId: 'missing' } }], []])
            await expect(f.scenario(steps)).rejects.toThrow();
        for (const url of ['javascript:alert(1)', 'http://example.com/x', 'https://user:pass@example.com/x'])
            await expect(f.run('video', { requestKey: 'v', title: 'x', mode: 'link', url })).rejects.toThrow();
    });
    it('paged segments scan all contacts once and use caller-supplied explicit page cursor', async () => {
        const f = fixture();
        for (let i = 0; i < 103; i++)
            await f.seed();
        await f.run('segment', { requestKey: 's', name: 'all', botId: 'demo', rules: [] });
        const a = (await f.run('preview', { segmentId: 's' })).data, b = (await f.run('preview', { segmentId: 's', after: a.nextCursor })).data;
        expect(a.scanned).toBe(100);
        expect(b.scanned).toBe(3);
        expect(b.nextCursor).toBeNull();
        expect(new Set([...a.selected, ...b.selected].map((x: any) => x.id)).size).toBe(103);
    });
    it('recovers a partially created campaign plan and keeps completed recipients unchanged', async () => {
        const f = fixture(), a = await f.seed(), b = await f.seed();
        await f.run('segment', { requestKey: 'seg', name: 'VIP', botId: 'demo', rules: [] });
        const args = { requestKey: 'recover', segmentId: 'seg', message: textMessage, dueAt: '2026-11-05T00:00:00Z' };
        const original = f.repo.crm.engagement.start.bind(f.repo.crm.engagement);
        let calls = 0;
        const interrupted = vi.spyOn(f.repo.crm.engagement, 'start').mockImplementation(async (e) => { if (++calls === 2)
            throw Error('synthetic storage interruption'); return original(e); });
        await expect(f.run('campaign', args)).rejects.toThrow();
        interrupted.mockRestore();
        expect((await f.run('list', { kind: 'campaigns' })).data).toHaveLength(1);
        expect((await f.run('executions')).data).toHaveLength(1);
        await f.run('run');
        await f.consent(b.contact.id, 'revoked');
        await f.run('campaign', args);
        expect((await f.run('executions')).data).toHaveLength(2);
        await f.run('run');
        const executions = (await f.run('executions')).data;
        expect(executions.every((e: any) => e.data.history.length === 1)).toBe(true);
        expect(executions.map((e: any) => e.customerId).sort()).toEqual([a.c.id, b.c.id].sort());
    });
    it('current profile selection resists old-request replay and segment AND/neq sees latest fields', async () => {
        const f = fixture(), { c } = await f.seed();
        const old = { requestKey: 'old', industry: 'bar', fields: { preferredStaff: 'A' } };
        await f.profile(c.id, old);
        await f.profile(c.id, { requestKey: 'new', fields: { preferredStaff: 'B' }, serviceConsent: 'revoked' });
        await f.profile(c.id, old);
        expect((await f.repo.crm.engagement.latestProfile(c.id))?.data.serviceConsent).toBe('revoked');
        await f.run('segment', { requestKey: 'segment', name: 'latest', botId: 'demo', rules: [{ field: 'industry', op: 'eq', value: 'bar' }, { field: 'staff', op: 'neq', value: 'A' }, { field: 'tag', op: 'eq', value: 'VIP' }] });
        expect((await f.run('preview', { segmentId: 'segment' })).data.selected).toMatchObject([{ customerId: c.id, reason: 'night_service_gate' }]);
    });
    it('unverified contacts cannot deliver and long execution IDs can be paged', async () => {
        const f = fixture(), a = await f.seed(), b = await f.seed();
        f.db.prepare('UPDATE crm_contacts SET verified_at=NULL,verification_evidence=NULL WHERE id=?').run(a.contact.id);
        const id = 's'.repeat(100);
        await f.scenario([{ delayMinutes: 0, message: textMessage }], id);
        for (const contact of [a.contact, b.contact])
            await f.run('enroll', { scenarioId: id, contactId: contact.id });
        const first = (await f.run('executions', { limit: 1 }));
        expect(first.nextCursor.length).toBeGreaterThan(100);
        expect((await f.run('executions', { limit: 1, after: first.nextCursor })).data).toHaveLength(1);
        const results = (await f.run('run')).data;
        expect(results.map((x: any) => x.reason).sort()).toEqual(['mock_only', 'unverified_contact']);
    });
    it('migration from phase2 preserves data, pending progress and evidence survive reopening', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'th-phase3-'));
        clean.push(() => rmSync(dir, { recursive: true, force: true }));
        const path = join(dir, 'test.sqlite');
        const old = new DatabaseSync(path);
        old.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
        for (const name of ['0001_init.sql', '0002_user_account.sql', '0003_crm_core.sql', '0004_booking_delivery.sql']) {
            old.exec(readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8'));
            old.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(name, '2026-11-04');
        }
        old.close();
        let h = openNodeSqliteRepo(path);
        const c = await h.repo.crm.telegramCustomer('demo', '1', '合成', '2026-11-05T00:00:00.000Z');
        await h.repo.crm.engagement.put({ kind: 'calls', id: 'persist', customerId: c.customerId, data: { direction: 'incoming' }, createdAt: '2026-11-05T00:00:00.000Z' });
        await h.repo.crm.engagement.start({ id: 'e', customerId: c.customerId, contactId: c.id, state: 'active', dueAt: '2026-11-06T00:00:00.000Z', version: 0, data: { definitionId: 's', cursor: 0, history: [] } });
        h.close();
        h = openNodeSqliteRepo(path);
        clean.push(() => h.close());
        expect((await h.repo.crm.engagement.get('calls', 'persist'))?.data.direction).toBe('incoming');
        expect((await h.repo.crm.engagement.execution('e'))?.state).toBe('active');
        expect((await h.repo.crm.getCustomer(c.customerId))?.displayName).toBe('合成');
        expect(toolDefs.filter(x => x.name.startsWith('engagement_'))).toHaveLength(16);
    });
});
