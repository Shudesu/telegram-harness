import Link from 'next/link';
import type { ReactNode } from 'react';
import { crmApi, type List } from '../api';
import { CrmField, CrmButton, CrmBadge } from '../../../components/crm-ui';
import { engagementAction } from './actions';
export const dynamic = 'force-dynamic';
type Obj = Record<string, unknown>;
interface Preview {
    selected: Array<{
        id: string;
        customerId: string;
        reason: string | null;
    }>;
    nextCursor: string | null;
    scanned: number;
}
interface Row {
    id: string;
    customerId?: string;
    state?: string;
    dueAt?: string;
    createdAt?: string;
    data: Obj;
}
const labels: Record<string, string> = { executions: '配信進行', profiles: '業種別プロフィール', visits: '来店履歴', calls: '通話記録', videos: '動画', 'video-events': '動画反応', segments: 'セグメント', scenarios: 'シナリオ', campaigns: '配信予約' };
const fieldLabels: Record<string, string> = { preferredStaff: '希望担当・キャスト', service: '施術・サービス', allergyNote: 'アレルギー（必要な情報のみ）', preferences: '好み・接客メモ', nextVisit: '次回来店予定', seatPreference: '席の希望', course: 'コース', partySize: '人数', careNote: '施術メモ（必要な情報のみ）', contraindications: '禁忌・配慮事項', nomination: '指名区分', bottle: 'ボトル銘柄・管理番号', bottleExpiresAt: 'ボトル保管期限' };
function Select({ name, label, values }: {
    name: string;
    label: string;
    values: Record<string, string>;
}) { return <label className="crm-field"><span>{label}</span><select name={name} aria-label={label}>{Object.entries(values).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>; }
function Field({ name, label, optional = false, value }: {
    name: string;
    label: string;
    optional?: boolean;
    value?: string;
}) { return <CrmField name={name} label={label} defaultValue={value} required={!optional}/>; }
function Form({ operation, title, children, button = '保存する' }: {
    operation: string;
    title: string;
    children?: ReactNode;
    button?: string;
}) { return <section className="crm-card"><h2>{title}</h2><form action={engagementAction}><input type="hidden" name="operation" value={operation}/><div className="crm-grid">{children}<CrmButton>{button}</CrmButton></div></form></section>; }
function Key() { return <Field name="requestKey" label="記録ID（再試行は同じ値）" value={crypto.randomUUID()}/>; }
function Customer() { return <Field name="customerId" label="顧客ID"/>; }
function Message() { return <><Field name="messageText" label="メッセージ本文" optional/><Field name="videoId" label="動画ID（指定時は動画を優先）" optional/></>; }
export default async function Engagement({ searchParams }: {
    searchParams: Promise<Record<string, string | undefined>>;
}) {
    const q = await searchParams, kind = q.kind && labels[q.kind] ? q.kind : 'executions';
    let rows: List<Row> = { data: [], nextCursor: null }, templates: Record<string, {
        label: string;
        night: boolean;
        fields: string[];
    }> = {}, error = '', preview: Preview | null = null;
    try {
        const result = await Promise.all([crmApi<List<Row>>(`engagement/${kind === 'executions' ? 'executions' : `records/${kind}`}?limit=25&after=${encodeURIComponent(q.after ?? '')}&customerId=${encodeURIComponent(q.customerId ?? '')}`), crmApi<{
                data: typeof templates;
            }>('engagement/templates')]);
        rows = result[0];
        templates = result[1].data;
        if (q.segmentId)
            preview = (await crmApi<{
                data: Preview;
            }>('engagement/segments/preview', { segmentId: q.segmentId, after: q.previewAfter ?? '' })).data;
    }
    catch (e) {
        error = e instanceof Error ? e.message : '読み込みに失敗しました';
    }
    const industry = q.industry && templates[q.industry] ? q.industry : 'beauty', stamp = new Date().toISOString();
    return <>
    <h1>配信・業種別台帳</h1><p className="crm-intro">ステップ配信、動画、セグメント配信と来店・通話の記録。すべてモック処理・実送信なし。日時はUTCのISO形式です。</p>
    {q.notice && <p role="status" className="crm-notice">{q.notice}</p>}{error && <p role="alert" className="crm-error">{error}</p>}
    <nav className="crm-grid" aria-label="台帳の種類">{Object.entries(labels).map(([k, t]) => <Link key={k} href={`?kind=${k}`}>{t}</Link>)}</nav>
    <section className="crm-card"><h2>{labels[kind]}</h2>
      <form method="get" className="crm-grid"><input type="hidden" name="kind" value={kind}/><Field name="customerId" label="顧客IDで絞る（配信進行を除く）" optional value={q.customerId}/><CrmButton secondary>表示</CrmButton></form>
      {!rows.data.length ? <p>まだ記録がありません。下のフォームから追加できます。</p> : <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>記録ID / 顧客</th><th>概要</th><th>日時 / 状態</th><th>詳細</th></tr></thead><tbody>{rows.data.map(r => <tr key={r.id}><td>{r.id}<br />{r.customerId}</td><td>{String(r.data.name ?? r.data.title ?? r.data.industry ?? r.data.direction ?? r.data.event ?? r.data.staff ?? r.data.definitionId ?? '配信計画')}</td><td>{r.dueAt ?? r.data.occurredAt as string ?? r.createdAt}<br />{r.state && <CrmBadge>{r.state}</CrmBadge>}</td><td><details><summary>記録を見る</summary><pre className="engagement-json">{JSON.stringify(r.data, null, 2)}</pre></details>{r.state === 'active' && <form action={engagementAction}><input type="hidden" name="operation" value="executions/stop"/><input type="hidden" name="executionId" value={r.id}/><CrmButton secondary>停止する</CrmButton></form>}</td></tr>)}</tbody></table></div>}
      {rows.nextCursor && <Link href={`?kind=${kind}&after=${encodeURIComponent(rows.nextCursor)}&customerId=${encodeURIComponent(q.customerId ?? '')}`}>次の25件 →</Link>}
    </section>
    {kind === 'executions' && <><Form operation="run" title="期限到来分をモック処理" button="モック処理する"><p>1回につき最大100件・各1ステップ。確認済み連絡先とmarketing同意を再確認します。</p></Form><Form operation="enrollments" title="シナリオへ登録"><Field name="scenarioId" label="シナリオID"/><Field name="contactId" label="Telegram連絡先ID"/></Form></>}
    {kind === 'scenarios' && <Form operation="scenarios" title="ステップ配信を作る"><Key /><Field name="name" label="シナリオ名"/><Field name="botId" label="Botスコープ"/><Field name="delayMinutes" label="初回の遅延（分）" value="0"/><Message /><Field name="conditionTag" label="初回の条件タグ（不一致なら終了）" optional/><Field name="followupDelay" label="次の配信まで（分）" value="1440"/><Field name="followupText" label="2通目の本文" optional/><label className="crm-field"><span>詳細設定: ステップJSON（入力時はこちらを優先）</span><textarea name="steps" rows={5} placeholder={'[{"delayMinutes":0,"message":{"kind":"text","text":"こんにちは"},"onTrue":null,"onFalse":null}]'}/></label><p>条件と遷移先で分岐できます。遷移先は0始まりの後続ステップ、nullで終了。登録後は「配信進行」で対象連絡先を登録します。</p></Form>}
    {kind === 'videos' && <Form operation="videos" title="配信する動画を登録"><Key /><Field name="title" label="動画タイトル"/><Select name="mode" label="配信形式" values={{ telegram: 'Telegram動画', link: '動画ページへのリンク' }}/><Field name="url" label="動画またはページのHTTPS URL"/><p>登録した動画IDをステップ配信または配信予約で指定します。Telegram内の再生完了は取得できません。</p></Form>}
    {kind === 'video-events' && <Form operation="video-events" title="動画の反応を記録（模擬）"><Key /><Customer /><Field name="videoId" label="動画ID"/><Select name="event" label="確認できた反応" values={{ link_clicked: 'リンククリック', self_reported_watched: '本人の視聴申告' }}/><Field name="occurredAt" label="反応日時（UTC）" value={stamp}/><Field name="evidence" label="確認の証跡"/><p>スタッフによる模擬入力です。実測の視聴率には含めません。</p></Form>}
    {kind === 'segments' && <><Form operation="segments" title="セグメントを作る"><Key /><Field name="name" label="セグメント名"/><Field name="botId" label="Botスコープ"/><label className="crm-field"><span>AND条件（tag / source / industry / staff、eq / neq）</span><textarea name="rules" rows={4} defaultValue={'[{"field":"tag","op":"eq","value":"VIP"}]'}/></label></Form><section className="crm-card"><h2>対象と除外理由をプレビュー</h2><form method="get" className="crm-grid"><input type="hidden" name="kind" value="segments"/><Field name="segmentId" label="セグメントID" value={q.segmentId}/><CrmButton>確認</CrmButton></form>{preview && <><p>今回走査: {preview.scanned}件 / 配信可能: {preview.selected.filter(x => !x.reason).length}件</p><ul>{preview.selected.map(x => <li key={x.id}>{x.customerId} · {x.id} · {x.reason ?? '配信可能（モック）'}</li>)}</ul>{preview.nextCursor && <Link href={`?kind=segments&segmentId=${encodeURIComponent(q.segmentId!)}&previewAfter=${encodeURIComponent(preview.nextCursor)}`}>次の対象ページ →</Link>}</>}</section></>}
    {kind === 'campaigns' && <Form operation="campaigns" title="セグメント配信を予約（モック）"><Key /><Field name="segmentId" label="セグメントID"/><Field name="after" label="対象ページのカーソル（最初は空欄）" optional/><Field name="dueAt" label="配信予定日時（UTC）" value={stamp}/><Message /><p>1ページ最大100連絡先。保存結果のnextCursorがあれば、別の記録IDで次ページを予約します。進行画面から期限到来分を処理できます。</p></Form>}
    {kind === 'calls' && <Form operation="calls" title="通話記録（発信しません）"><Key /><Customer /><Select name="direction" label="方向" values={{ incoming: '着信 incoming', outgoing: '発信 outgoing' }}/><Select name="source" label="登録方法" values={{ manual: '手入力', 'webhook-mock': 'Webhook模擬入力' }}/><Field name="occurredAt" label="通話日時（UTC）" value={stamp}/><Field name="number" label="電話番号（+81形式）"/><Field name="notes" label="通話メモ" optional/></Form>}
    {kind === 'profiles' && <><section className="crm-card"><h2>業種を選ぶ</h2><form method="get" className="crm-grid"><input type="hidden" name="kind" value="profiles"/><Select name="industry" label="業種テンプレート" values={Object.fromEntries(Object.entries(templates).map(([k, t]) => [k, t.label]))}/><CrmButton>項目を切り替え</CrmButton></form></section><Form operation="profiles" title={`${templates[industry]?.label ?? '業種別'}の顧客情報`}><Key /><Customer /><input type="hidden" name="industry" value={industry}/>{templates[industry]?.fields.map(k => <Field key={k} name={`field_${k}`} label={fieldLabels[k] ?? k} optional/>)}<Select name="serviceConsent" label="サービス情報の保存・利用同意" values={{ granted: '許可', revoked: '撤回' }}/><Field name="consentEvidence" label="同意または撤回の証跡"/><Field name="policyVersion" label="同意文面の版" value="service-v1"/><Select name="ageStatus" label="年齢確認" values={{ unverified: '未確認', verified: '確認済み' }}/><Field name="ageYears" label="確認時の年齢" optional/><Field name="ageEvidence" label="年齢確認の方法・担当（証明書番号は不要）" optional/><p>変更は履歴として保存します。ナイト業種は18歳以上の年齢確認と証跡が必須です。来店登録には利用同意、飲酒記録には20歳以上の確認が必要です。</p></Form></>}
    {kind === 'visits' && <Form operation="visits" title="来店・担当・ボトルを記録"><Key /><Customer /><Field name="occurredAt" label="来店日時（UTC）" value={stamp}/><Field name="staff" label="担当スタッフ・キャスト"/><Field name="nomination" label="指名区分" optional/><Field name="course" label="施術・コース" optional/><Field name="bottle" label="ボトル銘柄・管理番号" optional/><Field name="bottleExpiresAt" label="保管期限（UTC）" optional/><Field name="amountMinor" label="金額（JPYは円 / USD・EURはセント）" value="0"/><Select name="currency" label="通貨" values={{ JPY: 'JPY', USD: 'USD', EUR: 'EUR' }}/><Select name="alcohol" label="飲酒の記録" values={{ false: 'なし', true: 'あり（20歳以上の確認が必要）' }}/><Field name="notes" label="来店メモ" optional/><p>先に業種別プロフィールとサービス利用同意を記録してください。</p></Form>}
  </>;
}
