import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CrmError, type Execution } from '@telegram-harness/db';
import { industryTemplates, type Industry } from '@telegram-harness/shared';
import type { Deps } from '../deps.js';
import { body, text, choice, date, page } from './crm.js';
type Obj = Record<string, unknown>;
interface Rule {
    field: 'tag' | 'source' | 'industry' | 'staff';
    op: 'eq' | 'neq';
    value: string;
}
interface Message {
    kind: 'text' | 'video';
    text?: string;
    videoId?: string;
}
interface Step {
    delayMinutes: number;
    message: Message;
    condition?: Rule;
    onTrue: number | null;
    onFalse: number | null;
}
const kinds = ['profiles', 'visits', 'calls', 'videos', 'video-events', 'segments', 'scenarios', 'campaigns'] as const;
function obj(v: unknown): Obj { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new CrmError('invalid_object', 400); return v as Obj; }
function integer(b: Obj, k: string, min: number, max: number) { const v = b[k]; if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new CrmError(`invalid_${k}`, 400); return v; }
function rule(v: unknown): Rule { const b = obj(v); return { field: choice(b, 'field', ['tag', 'source', 'industry', 'staff']), op: choice(b, 'op', ['eq', 'neq']), value: text(b, 'value', 120) }; }
function rules(v: unknown): Rule[] { if (!Array.isArray(v) || v.length > 10)
    throw new CrmError('invalid_rules', 400); return v.map(rule); }
function optional(b: Obj, key: string, max = 500): string { return b[key] === undefined || b[key] === '' ? '' : text(b, key, max); }
function https(value: string) { let u: URL; try {
    u = new URL(value);
}
catch {
    throw new CrmError('invalid_https_url', 400);
} if (u.protocol !== 'https:' || u.username || u.password)
    throw new CrmError('invalid_https_url', 400); return u.href; }
export function mountEngagement(app: Hono, deps: Deps) {
    const router = new Hono();
    router.use('*', bodyLimit({ maxSize: 65536, onError: c => c.json({ success: false, error: 'body_too_large' }, 413) }));
    router.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        if (deps.env.TELEGRAM_ENGAGEMENT_MOCK !== 'true' || deps.telegram.mode !== 'dry-run' || deps.env.TELEGRAM_ALLOW_NETWORK === 'true' || deps.env.TELEGRAM_USER_ALLOW_NETWORK === 'true')
            return c.json({ success: false, error: 'engagement_mock_disabled' }, 503);
        if (!deps.repo.crm)
            return c.json({ success: false, error: 'crm_storage_unavailable' }, 503);
        return next();
    });
    router.onError((e, c) => e instanceof CrmError ? c.json({ success: false, error: e.code }, e.status) : c.json({ success: false, error: 'engagement_error' }, 500));
    const crm = () => deps.repo.crm!, repo = () => crm().engagement, now = () => deps.now().toISOString();
    async function customer(id: string) { const v = await crm().getCustomer(id); if (!v)
        throw new CrmError('customer_not_found', 404); return v; }
    async function get(kind: string, id: string) { const v = await repo().get(kind, id); if (!v)
        throw new CrmError(`${kind}_not_found`, 404); return v; }
    async function save(kind: string, b: Obj, data: Obj, customerId: string | null = null) {
        if (customerId)
            await customer(customerId);
        return repo().put({ kind, id: text(b, 'requestKey', 100), customerId, data, createdAt: now() });
    }
    async function profile(id: string) {
        return repo().latestProfile(id);
    }
    async function match(customerId: string, rr: Rule[]) {
        const c = await customer(customerId), p = await profile(customerId);
        return rr.every(r => {
            const equal = r.field === 'tag' ? c.tags.includes(r.value) : r.field === 'source' ? c.source === r.value : r.field === 'industry' ? p?.data.industry === r.value : (p?.data.fields as Obj | undefined)?.preferredStaff === r.value;
            return r.op === 'eq' ? equal : !equal;
        });
    }
    async function eligibility(contactId: string, customerId: string, botId: string) {
        const c = await crm().getContact(contactId);
        if (!c || c.customerId !== customerId || c.kind !== 'telegram' || c.scope !== botId)
            return 'contact_scope_mismatch';
        if (!c.verifiedAt)
            return 'unverified_contact';
        if ((await repo().consent(c.id))?.status !== 'granted')
            return 'marketing_consent_missing';
        const p = await profile(customerId);
        if (p && industryTemplates[p.data.industry as Industry]?.night && (p.data.ageStatus !== 'verified' || p.data.serviceConsent !== 'granted'))
            return 'night_service_gate';
        return null;
    }
    async function message(v: unknown): Promise<Message> {
        const b = obj(v), kind = choice(b, 'kind', ['text', 'video']);
        if (kind === 'text')
            return { kind, text: text(b, 'text', 4000) };
        const videoId = text(b, 'videoId', 100);
        await get('videos', videoId);
        return { kind, videoId };
    }
    async function payload(m: Message, contactId: string) {
        const c = await crm().getContact(contactId);
        if (!c)
            throw new CrmError('contact_not_found', 404);
        if (m.kind === 'text')
            return { method: 'sendMessage', chat_id: c.value, text: m.text };
        const v = (await get('videos', m.videoId!)).data;
        return v.mode === 'telegram' ? { method: 'sendVideo', chat_id: c.value, video: v.url, caption: v.title } : { method: 'sendMessage', chat_id: c.value, text: `${v.title}\n${v.url}` };
    }
    router.get('/templates', c => c.json({ success: true, data: industryTemplates }));
    router.get('/records/:kind', async (c) => {
        const kind = choice({ kind: c.req.param('kind') }, 'kind', kinds), p = page(n => c.req.query(n));
        const items = await repo().list(kind, p.after, p.limit, c.req.query('customerId') ?? '');
        return c.json({ success: true, data: items, nextCursor: items.length === p.limit ? items.at(-1)!.id : null });
    });
    router.post('/profiles', async (c) => {
        const b = await body(c.req), industry = choice(b, 'industry', Object.keys(industryTemplates) as Industry[]), customerId = text(b, 'customerId', 100);
        const input = obj(b.fields), fields: Obj = {};
        for (const key of Object.keys(input)) {
            if (!(industryTemplates[industry].fields as readonly string[]).includes(key))
                throw new CrmError('unknown_profile_field', 400);
            fields[key] = text(input, key, 1000);
        }
        const data: Obj = { industry, fields, serviceConsent: choice(b, 'serviceConsent', ['granted', 'revoked']), consentEvidence: text(b, 'consentEvidence', 1000), policyVersion: text(b, 'policyVersion', 100), ageStatus: choice(b, 'ageStatus', ['verified', 'unverified']), ageEvidence: optional(b, 'ageEvidence', 1000) };
        if (data.ageStatus === 'verified') {
            data.ageYears = integer(b, 'ageYears', 0, 120);
            if (!data.ageEvidence)
                throw new CrmError('age_evidence_required', 400);
        }
        if (industryTemplates[industry].night && (data.ageStatus !== 'verified' || Number(data.ageYears) < 18 || !data.ageEvidence))
            throw new CrmError('night_age_verification_required', 400);
        const existing = await repo().get('profiles', text(b, 'requestKey', 100));
        // Request key, not arbitrary time, makes retried writes stable. the DB sequence orders revisions.
        const result = await save('profiles', b, data, customerId);
        return c.json({ success: true, data: result, replayed: !!existing }, 201);
    });
    router.post('/visits', async (c) => {
        const b = await body(c.req), customerId = text(b, 'customerId', 100), p = await profile(customerId);
        if (!p)
            throw new CrmError('profile_required', 400);
        if (p.data.serviceConsent !== 'granted')
            throw new CrmError('service_consent_required', 400);
        const alcohol = b.alcohol === true;
        if (b.alcohol !== undefined && typeof b.alcohol !== 'boolean')
            throw new CrmError('invalid_alcohol', 400);
        if (alcohol && (p.data.ageStatus !== 'verified' || Number(p.data.ageYears) < 20))
            throw new CrmError('alcohol_age_gate', 400);
        const occurredAt = date(b, 'occurredAt');
        if (occurredAt > now())
            throw new CrmError('future_visit', 400);
        const data = { occurredAt, staff: text(b, 'staff', 120), nomination: optional(b, 'nomination'), course: optional(b, 'course'), bottle: optional(b, 'bottle'), bottleExpiresAt: b.bottleExpiresAt ? date(b, 'bottleExpiresAt') : null, amountMinor: integer(b, 'amountMinor', 0, 100000000), currency: choice(b, 'currency', ['JPY', 'USD', 'EUR']), notes: optional(b, 'notes', 2000), alcohol, profileId: p.id };
        return c.json({ success: true, data: await save('visits', b, data, customerId) }, 201);
    });
    async function recordCall(b: Obj, source: 'manual' | 'webhook-mock') {
        const number = text(b, 'number', 16);
        if (!/^\+[1-9]\d{7,14}$/.test(number))
            throw new CrmError('invalid_phone', 400);
        const occurredAt = date(b, 'occurredAt');
        if (occurredAt > now())
            throw new CrmError('future_call', 400);
        const customerId = text(b, 'customerId', 100);
        return save('calls', b, { direction: choice(b, 'direction', ['incoming', 'outgoing']), occurredAt, number, notes: optional(b, 'notes', 2000), source }, customerId);
    }
    router.post('/calls', async (c) => c.json({ success: true, data: await recordCall(await body(c.req), 'manual') }, 201));
    router.post('/calls/webhook', async (c) => c.json({ success: true, data: await recordCall(await body(c.req), 'webhook-mock'), mode: 'mock' }, 201));
    router.post('/videos', async (c) => {
        const b = await body(c.req);
        return c.json({ success: true, data: await save('videos', b, { title: text(b, 'title', 120), mode: choice(b, 'mode', ['telegram', 'link']), url: https(text(b, 'url', 2000)), measurement: 'native_playback_unavailable' }) }, 201);
    });
    router.post('/video-events', async (c) => {
        const b = await body(c.req), videoId = text(b, 'videoId', 100);
        await get('videos', videoId);
        const occurredAt = date(b, 'occurredAt');
        if (occurredAt > now())
            throw new CrmError('future_event', 400);
        return c.json({ success: true, data: await save('video-events', b, { videoId, event: choice(b, 'event', ['link_clicked', 'self_reported_watched']), occurredAt, evidence: text(b, 'evidence', 1000), source: 'staff-mock', verifiedPlayback: false }, text(b, 'customerId', 100)) }, 201);
    });
    router.post('/segments', async (c) => { const b = await body(c.req); return c.json({ success: true, data: await save('segments', b, { name: text(b, 'name', 120), botId: text(b, 'botId', 64), rules: rules(b.rules), operator: 'AND' }) }, 201); });
    async function preview(b: Obj) {
        const s = await get('segments', text(b, 'segmentId', 100));
        const after = optional(b, 'after', 100), candidates = await repo().candidates(String(s.data.botId), after, 100), selected = [];
        for (const contact of candidates)
            if (await match(contact.customerId, s.data.rules as Rule[]))
                selected.push({ ...contact, reason: await eligibility(contact.id, contact.customerId, String(s.data.botId)) });
        return { segment: s, selected, scanned: candidates.length, nextCursor: candidates.length === 100 ? candidates.at(-1)!.id : null };
    }
    router.post('/segments/preview', async (c) => c.json({ success: true, data: await preview(await body(c.req)) }));
    router.post('/campaigns', async (c) => {
        const b = await body(c.req), requestKey = text(b, 'requestKey', 100), segmentId = text(b, 'segmentId', 100), after = optional(b, 'after', 100), m = await message(b.message);
        const dueAt = date(b, 'dueAt');
        const old = await repo().get('campaigns', requestKey);
        const spec = { segmentId, after, message: m, dueAt };
        if (old && JSON.stringify(old.data.spec) !== JSON.stringify(spec))
            throw new CrmError('idempotency_conflict');
        const plan = old ?? await (async () => { const p = await preview(b); return save('campaigns', b, { spec, botId: p.segment.data.botId, rules: p.segment.data.rules, recipients: p.selected.filter(x => !x.reason), excluded: p.selected.filter(x => x.reason), nextCursor: p.nextCursor }); })();
        // Durable plan first: replay recovers interrupted fan-out, with original recipients/content.
        for (const target of plan.data.recipients as {
            id: string;
            customerId: string;
        }[])
            await repo().start({ id: `campaign:${requestKey}:${target.id}`, customerId: target.customerId, contactId: target.id, state: 'active', dueAt, version: 0, data: { definitionId: plan.id, botId: plan.data.botId, rules: plan.data.rules, steps: [{ delayMinutes: 0, message: m, onTrue: null, onFalse: null }], cursor: 0, history: [] } });
        return c.json({ success: true, data: plan, mode: 'mock' }, 201);
    });
    router.post('/scenarios', async (c) => {
        const b = await body(c.req);
        if (!Array.isArray(b.steps) || !b.steps.length || b.steps.length > 30)
            throw new CrmError('invalid_steps', 400);
        const steps: Step[] = [], stepCount = b.steps.length;
        for (let i = 0; i < b.steps.length; i++) {
            const s = obj(b.steps[i]);
            const target = (k: string) => s[k] === null ? null : s[k] === undefined ? (i + 1 < stepCount ? i + 1 : null) : integer(s, k, i + 1, stepCount - 1);
            steps.push({ delayMinutes: integer(s, 'delayMinutes', 0, 525600), message: await message(s.message), ...(s.condition === undefined ? {} : { condition: rule(s.condition) }), onTrue: target('onTrue'), onFalse: target('onFalse') });
        }
        return c.json({ success: true, data: await save('scenarios', b, { name: text(b, 'name', 120), botId: text(b, 'botId', 64), steps }) }, 201);
    });
    router.post('/enrollments', async (c) => {
        const b = await body(c.req), s = await get('scenarios', text(b, 'scenarioId', 100)), contactId = text(b, 'contactId', 100), contact = await crm().getContact(contactId);
        if (!contact || contact.kind !== 'telegram' || contact.scope !== s.data.botId)
            throw new CrmError('contact_scope_mismatch', 400);
        const first = (s.data.steps as Step[])[0]!;
        const e = await repo().start({ id: `scenario:${s.id}:${contactId}`, customerId: contact.customerId, contactId, state: 'active', dueAt: new Date(deps.now().getTime() + first.delayMinutes * 60000).toISOString(), version: 0, data: { definitionId: s.id, botId: s.data.botId, steps: s.data.steps, cursor: 0, history: [] } });
        return c.json({ success: true, data: e }, 201);
    });
    router.get('/executions', async (c) => {
        const p = page(n => c.req.query(n), 400), data = await repo().executions(p.after, p.limit);
        return c.json({ success: true, data, nextCursor: data.length === p.limit ? data.at(-1)!.id : null });
    });
    router.post('/executions/stop', async (c) => {
        const b = await body(c.req), e = await repo().execution(text(b, 'executionId', 300));
        if (!e)
            throw new CrmError('execution_not_found', 404);
        if (e.state === 'active' && !await repo().advance(e, 'stopped', e.dueAt, { ...e.data, stopReason: 'staff' }))
            throw new CrmError('execution_changed_retry');
        return c.json({ success: true, data: await repo().execution(e.id) });
    });
    router.post('/run', async (c) => {
        const stamp = now(), results = [];
        for (const e of await repo().due(stamp)) {
            const data = e.data, steps = data.steps as Step[], cursor = Number(data.cursor), step = steps[cursor]!;
            const reason = await eligibility(e.contactId, e.customerId, String(data.botId)) ?? (data.rules && !await match(e.customerId, data.rules as Rule[]) ? 'segment_no_longer_matches' : null);
            const matched = !step.condition || await match(e.customerId, [step.condition]);
            const next = matched ? step.onTrue : step.onFalse;
            const entry = { step: cursor, at: stamp, status: reason ? 'skipped' : matched ? 'mocked' : 'branch_skipped', reason: reason ?? (matched ? 'mock_only' : 'condition_false'), ...(reason || !matched ? {} : { payload: await payload(step.message, e.contactId) }) };
            const state: Execution['state'] = reason ? 'stopped' : next === null ? 'completed' : 'active';
            const dueAt = next === null ? stamp : new Date(Date.parse(stamp) + steps[next]!.delayMinutes * 60000).toISOString();
            // One SQL statement atomically commits progress + mock delivery evidence. No external IO.
            if (await repo().advance(e, state, dueAt, { ...data, cursor: next, history: [...(data.history as unknown[]), entry] }))
                results.push({ id: e.id, ...entry, state, dueAt });
        }
        return c.json({ success: true, data: results, mode: 'mock', batchLimit: 100 });
    });
    app.route('/api/crm/engagement', router);
}
