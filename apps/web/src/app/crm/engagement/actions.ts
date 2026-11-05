'use server';
import { redirect } from 'next/navigation';
import { crmApi } from '../api';
const value = (f: FormData, k: string) => String(f.get(k) ?? '');
export async function engagementAction(f: FormData) {
    let notice = '', selected = 'executions';
    const operation = value(f, 'operation');
    try {
        const key = value(f, 'requestKey'), customerId = value(f, 'customerId');
        let path = operation, data: Record<string, unknown> = {};
        const msg = () => value(f, 'videoId') ? { kind: 'video', videoId: value(f, 'videoId') } : { kind: 'text', text: value(f, 'messageText') };
        switch (operation) {
            case 'profiles': {
                const templates = await crmApi<{
                    data: Record<string, {
                        fields: string[];
                    }>;
                }>('engagement/templates');
                const template = templates.data[value(f, 'industry')];
                if (!template)
                    throw Error('業種を選択してください');
                const fields: Record<string, string> = {};
                for (const name of template.fields)
                    if (value(f, `field_${name}`))
                        fields[name] = value(f, `field_${name}`);
                data = { requestKey: key, customerId, industry: value(f, 'industry'), fields, serviceConsent: value(f, 'serviceConsent'), consentEvidence: value(f, 'consentEvidence'), policyVersion: value(f, 'policyVersion'), ageStatus: value(f, 'ageStatus'), ageEvidence: value(f, 'ageEvidence'), ...(value(f, 'ageYears') ? { ageYears: Number(value(f, 'ageYears')) } : {}) };
                selected = 'profiles';
                break;
            }
            case 'visits':
                data = { requestKey: key, customerId, occurredAt: value(f, 'occurredAt'), staff: value(f, 'staff'), nomination: value(f, 'nomination'), course: value(f, 'course'), bottle: value(f, 'bottle'), bottleExpiresAt: value(f, 'bottleExpiresAt'), amountMinor: Number(value(f, 'amountMinor')), currency: value(f, 'currency'), notes: value(f, 'notes'), alcohol: value(f, 'alcohol') === 'true' };
                selected = 'visits';
                break;
            case 'calls':
                data = { requestKey: key, customerId, direction: value(f, 'direction'), occurredAt: value(f, 'occurredAt'), number: value(f, 'number'), notes: value(f, 'notes') };
                if (value(f, 'source') === 'webhook-mock')
                    path = 'calls/webhook';
                selected = 'calls';
                break;
            case 'videos':
                data = { requestKey: key, title: value(f, 'title'), mode: value(f, 'mode'), url: value(f, 'url') };
                selected = 'videos';
                break;
            case 'video-events':
                data = { requestKey: key, customerId, videoId: value(f, 'videoId'), event: value(f, 'event'), occurredAt: value(f, 'occurredAt'), evidence: value(f, 'evidence') };
                selected = 'video-events';
                break;
            case 'segments':
                data = { requestKey: key, name: value(f, 'name'), botId: value(f, 'botId'), rules: value(f, 'rules').trim() ? JSON.parse(value(f, 'rules')) : [] };
                selected = 'segments';
                break;
            case 'campaigns':
                data = { requestKey: key, segmentId: value(f, 'segmentId'), after: value(f, 'after'), dueAt: value(f, 'dueAt'), message: msg() };
                selected = 'campaigns';
                break;
            case 'scenarios': {
                const steps = value(f, 'steps').trim() ? JSON.parse(value(f, 'steps')) : [{ delayMinutes: Number(value(f, 'delayMinutes')), message: msg(), ...(value(f, 'conditionTag') ? { condition: { field: 'tag', op: 'eq', value: value(f, 'conditionTag') }, onTrue: 1, onFalse: null } : {}) }, { delayMinutes: Number(value(f, 'followupDelay')), message: { kind: 'text', text: value(f, 'followupText') }, onTrue: null, onFalse: null }];
                data = { requestKey: key, name: value(f, 'name'), botId: value(f, 'botId'), steps };
                selected = 'scenarios';
                break;
            }
            case 'enrollments':
                data = { scenarioId: value(f, 'scenarioId'), contactId: value(f, 'contactId') };
                break;
            case 'executions/stop':
                data = { executionId: value(f, 'executionId') };
                break;
            case 'run': break;
            default: throw Error('操作を選択してください');
        }
        const r = await crmApi<{
            data: {
                id?: string;
            } | unknown[];
        }>(`engagement/${path}`, data);
        notice = Array.isArray(r.data) ? `モック処理: ${r.data.length}件` : `保存しました: ${r.data.id ?? ''}`;
    }
    catch (e) {
        notice = e instanceof SyntaxError ? '条件またはステップのJSON形式を確認してください' : e instanceof Error ? e.message : '保存に失敗しました';
    }
    redirect(`/crm/engagement?kind=${selected}&notice=${encodeURIComponent(notice)}`);
}
