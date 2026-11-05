import type { ToolDef } from './tools.js';
import type { TelegramHarnessClient } from '@telegram-harness/sdk';
const str = { type: 'string' }, object = { type: 'object' }, request = { requestKey: str };
const message = { type: 'object', properties: { kind: { type: 'string', enum: ['text', 'video'] }, text: str, videoId: str }, required: ['kind'] };
const rule = { type: 'object', properties: { field: { type: 'string', enum: ['tag', 'source', 'industry', 'staff'] }, op: { type: 'string', enum: ['eq', 'neq'] }, value: str }, required: ['field', 'op', 'value'] };
const defs: Array<[
    string,
    string,
    string,
    Record<string, unknown>,
    string[]
]> = [
    ['templates', 'templates', '業種テンプレと台帳項目', {}, []],
    ['list', 'records', '各台帳をページング取得', { kind: { type: 'string', enum: ['profiles', 'visits', 'calls', 'videos', 'video-events', 'segments', 'scenarios', 'campaigns'] }, customerId: str, after: str, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['kind']],
    ['profile', 'profiles', '業種別顧客情報・年齢確認・サービス同意を追記保存', { ...request, customerId: str, industry: { type: 'string', enum: ['beauty', 'restaurant', 'wellness', 'cabaret', 'host', 'bar'] }, fields: object, serviceConsent: { type: 'string', enum: ['granted', 'revoked'] }, consentEvidence: str, policyVersion: str, ageStatus: { type: 'string', enum: ['verified', 'unverified'] }, ageEvidence: str, ageYears: { type: 'integer', minimum: 0, maximum: 120 } }, ['requestKey', 'customerId', 'industry', 'fields', 'serviceConsent', 'consentEvidence', 'policyVersion', 'ageStatus']],
    ['visit', 'visits', '来店・担当・指名・コース・ボトルの台帳記録', { ...request, customerId: str, occurredAt: str, staff: str, nomination: str, course: str, bottle: str, bottleExpiresAt: str, amountMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string', enum: ['JPY', 'USD', 'EUR'] }, notes: str, alcohol: { type: 'boolean' } }, ['requestKey', 'customerId', 'occurredAt', 'staff', 'amountMinor', 'currency']],
    ['call', 'calls', '手入力の incoming/outgoing 通話記録。発信しない', { ...request, customerId: str, direction: { type: 'string', enum: ['incoming', 'outgoing'] }, occurredAt: str, number: str, notes: str }, ['requestKey', 'customerId', 'direction', 'occurredAt', 'number']],
    ['call_webhook', 'calls/webhook', '管理認証付き通話Webhook模擬入力。公開provider受信ではない', { ...request, customerId: str, direction: { type: 'string', enum: ['incoming', 'outgoing'] }, occurredAt: str, number: str, notes: str }, ['requestKey', 'customerId', 'direction', 'occurredAt', 'number']],
    ['video', 'videos', 'Telegram動画 / HTTPSリンク定義。ダウンロードしない', { ...request, title: str, mode: { type: 'string', enum: ['telegram', 'link'] }, url: str }, ['requestKey', 'title', 'mode', 'url']],
    ['video_event', 'video-events', 'リンククリック・本人視聴申告の模擬証跡。実再生証明ではない', { ...request, customerId: str, videoId: str, event: { type: 'string', enum: ['link_clicked', 'self_reported_watched'] }, occurredAt: str, evidence: str }, ['requestKey', 'customerId', 'videoId', 'event', 'occurredAt', 'evidence']],
    ['segment', 'segments', 'Bot内でAND条件のセグメントを定義', { ...request, name: str, botId: str, rules: { type: 'array', items: rule, maxItems: 10 } }, ['requestKey', 'name', 'botId', 'rules']],
    ['preview', 'segments/preview', '最大100連絡先を走査し対象・除外理由・次カーソルを表示', { segmentId: str, after: str }, ['segmentId']],
    ['campaign', 'campaigns', '宛先を固定してモック配信を予約。再試行は同じキー・本文・ページ', { ...request, segmentId: str, after: str, message, dueAt: str }, ['requestKey', 'segmentId', 'message', 'dueAt']],
    ['scenario', 'scenarios', '遅延と条件分岐のシナリオ。添字0始まり、遷移先は後方のみ、nullで終了', { ...request, name: str, botId: str, steps: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { delayMinutes: { type: 'integer', minimum: 0, maximum: 525600 }, message, condition: rule, onTrue: { type: ['integer', 'null'] }, onFalse: { type: ['integer', 'null'] } }, required: ['delayMinutes', 'message'] } } }, ['requestKey', 'name', 'botId', 'steps']],
    ['enroll', 'enrollments', '連絡先をシナリオ登録。同じシナリオ・連絡先は再開せず冪等', { scenarioId: str, contactId: str }, ['scenarioId', 'contactId']],
    ['executions', 'executions', '配信進行とモック結果・履歴を一覧', { after: str, limit: { type: 'integer', minimum: 1, maximum: 100 } }, []],
    ['stop', 'executions/stop', '配信実行を停止', { executionId: str }, ['executionId']],
    ['run', 'run', '期限到来分を最大100件・各1ステップ処理。送信ゼロ、同意再照合', {}, []],
];
export const engagementToolDefs: ToolDef[] = defs.map(([name, , description, properties, required]) => ({ name: `engagement_${name}`, description: `Telegram Harness: ${description}`, inputSchema: { type: 'object', properties, required } }));
export async function executeEngagementTool(client: TelegramHarnessClient, name: string, args: Record<string, unknown>) {
    const def = defs.find(d => `engagement_${d[0]}` === name);
    if (!def)
        throw Error('unknown_engagement_tool');
    let path = `/api/crm/engagement/${def[1]}`;
    if (['templates', 'list', 'executions'].includes(def[0])) {
        if (def[0] === 'list')
            path += `/${encodeURIComponent(String(args.kind))}`;
        const q = new URLSearchParams();
        for (const k of ['after', 'limit', 'customerId'])
            if (args[k] !== undefined)
                q.set(k, String(args[k]));
        return client.get(`${path}?${q}`);
    }
    return client.post(path, args);
}
