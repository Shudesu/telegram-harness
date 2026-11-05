import type { D1Like } from './d1.js';
import { CrmError } from './crm.js';
export interface LedgerRecord {
    sequence?: number;
    kind: string;
    id: string;
    customerId: string | null;
    data: Record<string, unknown>;
    createdAt: string;
}
export interface Execution {
    id: string;
    customerId: string;
    contactId: string;
    state: 'active' | 'completed' | 'stopped';
    dueAt: string;
    version: number;
    data: Record<string, unknown>;
}
type Stored<T> = Omit<T, 'data'> & {
    data: string;
};
function decode<T extends {
    data: Record<string, unknown>;
}>(r: Stored<T>): T { return { ...r, data: JSON.parse(r.data) } as T; }
const recordCols = 'sequence,kind,id,customer_id AS customerId,data,created_at AS createdAt';
const executionCols = 'id,customer_id AS customerId,contact_id AS contactId,state,due_at AS dueAt,version,data';
export class EngagementRepo {
    constructor(private db: D1Like) { }
    async latestProfile(customerId: string) {
        const r = await this.db.prepare(`SELECT ${recordCols} FROM crm_engagement WHERE kind='profiles' AND customer_id=? ORDER BY sequence DESC LIMIT 1`).bind(customerId).first<Stored<LedgerRecord>>();
        return r ? decode<LedgerRecord>(r) : null;
    }
    async get(kind: string, id: string) {
        const r = await this.db.prepare(`SELECT ${recordCols} FROM crm_engagement WHERE kind=? AND id=?`).bind(kind, id).first<Stored<LedgerRecord>>();
        return r ? decode<LedgerRecord>(r) : null;
    }
    async list(kind: string, after = '', limit = 50, customerId = '') {
        const r = await this.db.prepare(`SELECT ${recordCols} FROM crm_engagement WHERE kind=? AND id>? ${customerId ? 'AND customer_id=?' : ''} ORDER BY id LIMIT ?`).bind(...(customerId ? [kind, after, customerId, limit] : [kind, after, limit])).all<Stored<LedgerRecord>>();
        return (r.results ?? []).map(decode<LedgerRecord>);
    }
    async put(r: LedgerRecord) {
        await this.db.prepare('INSERT OR IGNORE INTO crm_engagement(kind,id,customer_id,data,created_at) VALUES (?,?,?,?,?)').bind(r.kind, r.id, r.customerId, JSON.stringify(r.data), r.createdAt).run();
        const saved = await this.get(r.kind, r.id);
        if (!saved || saved.customerId !== r.customerId || JSON.stringify(saved.data) !== JSON.stringify(r.data))
            throw new CrmError('idempotency_conflict');
        return saved;
    }
    async execution(id: string) {
        const r = await this.db.prepare(`SELECT ${executionCols} FROM crm_executions WHERE id=?`).bind(id).first<Stored<Execution>>();
        return r ? decode<Execution>(r) : null;
    }
    async start(e: Execution) {
        await this.db.prepare('INSERT OR IGNORE INTO crm_executions VALUES (?,?,?,?,?,?,?)').bind(e.id, e.customerId, e.contactId, e.state, e.dueAt, e.version, JSON.stringify(e.data)).run();
        const saved = await this.execution(e.id);
        if (!saved || saved.customerId !== e.customerId || saved.contactId !== e.contactId || saved.data.definitionId !== e.data.definitionId)
            throw new CrmError('enrollment_conflict');
        return saved;
    }
    async executions(after = '', limit = 50) {
        const r = await this.db.prepare(`SELECT ${executionCols} FROM crm_executions WHERE id>? ORDER BY id LIMIT ?`).bind(after, limit).all<Stored<Execution>>();
        return (r.results ?? []).map(decode<Execution>);
    }
    async due(now: string) {
        const r = await this.db.prepare(`SELECT ${executionCols} FROM crm_executions WHERE state='active' AND due_at<=? ORDER BY due_at,id LIMIT 100`).bind(now).all<Stored<Execution>>();
        return (r.results ?? []).map(decode<Execution>);
    }
    async advance(e: Execution, state: Execution['state'], dueAt: string, data: Execution['data']) {
        const r = await this.db.prepare("UPDATE crm_executions SET state=?,due_at=?,data=?,version=version+1 WHERE id=? AND version=? AND state='active'").bind(state, dueAt, JSON.stringify(data), e.id, e.version).run();
        return r.meta?.changes === 1;
    }
    async consent(contactId: string) {
        return this.db.prepare("SELECT status FROM crm_consents WHERE contact_id=? AND purpose='marketing' ORDER BY occurred_at DESC,sequence DESC LIMIT 1").bind(contactId).first<{
            status: string;
        }>();
    }
    async candidates(botId: string, after: string, limit: number) {
        const r = await this.db.prepare(`SELECT id,customer_id AS customerId FROM crm_contacts WHERE kind='telegram' AND scope=? AND id>? ORDER BY id LIMIT ?`).bind(botId, after, limit).all<{
            id: string;
            customerId: string;
        }>();
        return r.results ?? [];
    }
}
