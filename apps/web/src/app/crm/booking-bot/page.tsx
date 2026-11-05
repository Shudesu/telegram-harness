import Link from 'next/link';
import { crmApi, type List } from '../api';
import { CrmBadge, CrmButton, CrmField } from '../../../components/crm-ui';
import { mockUpdate, phoneIntake, runNotifications, contactAction } from './actions';
export const dynamic = 'force-dynamic';
type Calendar = {
    month: string;
    slots: Array<{
        id: string;
        title: string;
        startsAt: string;
        capacity: number;
        booked: number;
    }>;
    reply_markup: {
        inline_keyboard: Array<Array<{
            text: string;
            callback_data: string;
        }>>;
    };
};
type Job = {
    id: string;
    bookingId: string;
    kind: string;
    dueAt: string;
    status: string;
    reason: string | null;
};
export default async function BookingBot({ searchParams }: {
    searchParams: Promise<{
        month?: string;
        notice?: string;
        after?: string;
        customerId?: string;
    }>;
}) {
    const q = await searchParams, selected = q.month ?? new Date().toISOString().slice(0, 7);
    let calendar: Calendar | undefined, jobs: List<Job> = { data: [], nextCursor: null }, error = '', contacts: Array<{
        id: string;
        kind: string;
        value: string;
        verifiedAt: string | null;
    }> = [];
    try {
        const [a, b] = await Promise.all([crmApi<{
                data: Calendar;
            }>(`booking-bot/calendar?month=${encodeURIComponent(selected)}`), crmApi<List<Job>>(`booking-bot/notifications?after=${encodeURIComponent(q.after ?? '')}`)]);
        calendar = a.data;
        jobs = b;
        if (q.customerId)
            contacts = (await crmApi<{
                data: {
                    contacts: typeof contacts;
                };
            }>(`customers/${encodeURIComponent(q.customerId)}`)).data.contacts;
    }
    catch (e) {
        error = e instanceof Error ? e.message : '取得に失敗しました';
    }
    const updateId = Date.now();
    return <>
    <h1>ボット予約・電話受付</h1><p className="crm-intro">Telegram Harness のローカル練習画面。合成データで予約と通知を確認できます。すべてモックです。</p>
    <CrmBadge>実送信なし</CrmBadge>
    {q.notice && <p role="status" className="crm-notice">{q.notice}</p>}{error && <p role="alert" className="crm-error">{error}</p>}
    <section className="crm-card"><h2>予約カレンダー</h2><p>日時はUTC。日本時間は9時間加算。月ごとに先頭100枠まで表示。空き枠ボタンの操作が下のモック受付と対応します。</p>
      <form method="get" className="crm-grid"><CrmField label="表示月（YYYY-MM）" name="month" defaultValue={selected}/><CrmButton>月を表示</CrmButton></form>
      {calendar?.slots.length === 0 && <p>この月の空き枠はありません。予約管理で枠を作成してください。</p>}
      <div className="booking-calendar">{calendar?.slots.map(s => <article key={s.id} className="crm-card"><h3>{s.startsAt.slice(5, 16).replace('T', ' ')} UTC</h3><p>{s.title} · 残り{Math.max(0, s.capacity - s.booked)}席</p><code>book:{s.id}</code></article>)}</div>
      <details><summary>インラインボタンのTelegram形式</summary><pre className="booking-json">{JSON.stringify(calendar?.reply_markup, null, 2)}</pre></details>
    </section>
    <section className="crm-card"><h2>Telegramからの受付を試す</h2><p>コマンドは /book または /book@harness_demo YYYY-MM。予約はカレンダーのボタンから選択。グループでは送信者本人に紐付き、トピックも保持します。</p>
      <form action={mockUpdate} className="crm-grid">
        <input type="hidden" name="calendarMonth" value={selected}/>
        <CrmField label="Bot名（モック識別子）" name="botId" defaultValue="harness_demo"/>
        <CrmField label="TelegramユーザーID（合成）" name="userId" defaultValue="10001"/>
        <CrmField label="表示名（合成）" name="displayName" defaultValue="予約テスト"/>
        <CrmField label="チャットID（グループは負数）" name="chatId" defaultValue="10001"/>
        <label className="crm-field">チャット種類<select name="chatType"><option value="private">1対1</option><option value="group">グループ</option><option value="supergroup">スーパーグループ</option></select></label>
        <label className="crm-field">トピックID（任意）<input name="threadId" type="number" min="1"/></label>
        <CrmField label="更新ID（再試行は同じ値）" name="updateId" defaultValue={String(updateId)}/>
        <CrmField label="コマンド" name="command" defaultValue={`/book ${selected}`}/>
        <label className="crm-field">インラインボタン操作<select name="callback"><option value="">コマンドを実行</option>{calendar?.reply_markup.inline_keyboard.flat().map(b => <option key={b.callback_data} value={b.callback_data}>{b.text}</option>)}</select></label>
        <CrmButton>モックTelegramで実行</CrmButton>
      </form>
    </section>
    <section className="crm-card"><h2>電話の手入力受付</h2><p>台帳の顧客に電話連絡先を登録し、その連絡先IDで予約します。本人確認・通知同意は別に記録します。</p>
      <form action={phoneIntake} className="crm-grid"><CrmField label="電話連絡先ID" name="contactId"/><CrmField label="予約枠ID" name="slotId"/><input type="hidden" name="requestKey" value={crypto.randomUUID()}/><label className="crm-field">通知方法<select name="channel"><option value="sms">SMS（モック）</option><option value="voice">音声（モック）</option></select></label><CrmButton>電話予約を登録</CrmButton></form>
    </section>
    <section className="crm-card"><h2>連絡先・予約通知の同意</h2><p>予約リマインダーは確認済み連絡先と最新の予約通知同意が必要です。本人から得た証跡だけを記録してください。</p>
      <form method="get" className="crm-grid"><CrmField label="顧客ID（連絡先を表示）" name="customerId" defaultValue={q.customerId}/><CrmButton>連絡先を表示</CrmButton></form>
      {contacts.map(c => <p key={c.id}><code>{c.id}</code> · {c.kind}: {c.value} · {c.verifiedAt ? '確認済み' : '未確認'}</p>)}
      <form action={contactAction} className="crm-grid"><input type="hidden" name="action" value="add"/><CrmField label="顧客ID" name="customerId"/><CrmField label="電話番号（E.164）" name="phone" placeholder="+819000000001"/><CrmButton>電話連絡先を追加</CrmButton></form>
      <form action={contactAction} className="crm-grid"><input type="hidden" name="action" value="verify"/><CrmField label="確認した連絡先ID" name="contactId"/><CrmField label="本人確認の証跡" name="evidence"/><CrmButton>確認証跡を記録</CrmButton></form>
      <form action={contactAction} className="crm-grid"><input type="hidden" name="action" value="consent"/><CrmField label="通知先の連絡先ID" name="contactId"/><CrmField label="本人の許可・撤回の証跡" name="evidence"/><label className="crm-field">予約通知の同意<select name="status"><option value="revoked">撤回</option><option value="granted">許可</option></select></label><CrmButton>予約通知の同意を記録</CrmButton></form>
    </section>
    <section className="crm-card"><h2>予約確認・リマインダー</h2><p>確認は受付時、リマインダーは開始24時間前に期限到来。ボタンで期限到来分を処理します。送信はモック、日時・取消・同意を毎回照合します。</p><form action={runNotifications}><CrmButton>期限到来の通知をモック処理</CrmButton></form>
      {jobs.data.length === 0 ? <p>通知はまだありません。</p> : <div className="crm-table-wrap"><table><thead><tr><th>予約ID</th><th>種類・期限（UTC）</th><th>状態・理由</th></tr></thead><tbody>{jobs.data.map(j => <tr key={j.id}><td>{j.bookingId}</td><td>{j.kind}<br />{j.dueAt}</td><td><CrmBadge>{j.status}</CrmBadge><br />{j.reason}</td></tr>)}</tbody></table></div>}
      {jobs.nextCursor && <Link href={`?after=${encodeURIComponent(jobs.nextCursor)}&month=${encodeURIComponent(selected)}`}>次の通知</Link>}
    </section>
  </>;
}
