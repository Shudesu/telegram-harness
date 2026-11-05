import Link from "next/link";
import { crmApi, type List } from "../api";
import { addSlot, bookSlot, cancelBooking } from "../actions";
import { CrmBadge, CrmButton, CrmField } from "../../../components/crm-ui";
export const dynamic = "force-dynamic";
interface Slot {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
}
interface Booking {
  id: string;
  customerId: string;
  slotId: string;
  status: string;
}
const when = (s: string) =>
  new Date(s).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  });
export default async function Bookings({
  searchParams,
}: {
  searchParams: Promise<{
    after?: string;
    slotAfter?: string;
    notice?: string;
  }>;
}) {
  const q = await searchParams;
  let slots: List<Slot> = { data: [], nextCursor: null },
    bookings: List<Booking> = { data: [], nextCursor: null },
    error = "";
  try {
    [slots, bookings] = await Promise.all([
      crmApi<List<Slot>>(
        `slots?limit=50&after=${encodeURIComponent(q.slotAfter ?? "")}`,
      ),
      crmApi<List<Booking>>(
        `bookings?limit=50&after=${encodeURIComponent(q.after ?? "")}`,
      ),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "読み込みに失敗しました";
  }
  return (
    <>
      <h1>予約管理</h1>
      <p className="crm-intro">
        予約枠と空き状況を確認し、受付からキャンセルまで管理。
      </p>
      {q.notice && (
        <p role="status" className="crm-notice">
          {q.notice}
        </p>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <section className="crm-card">
        <h2>予約枠を作成</h2>
        <form action={addSlot} className="crm-grid">
          <CrmField label="枠の名前" name="title" placeholder="個別相談" />
          <CrmField
            label="開始日時（ISO・時差付き）"
            name="startsAt"
            placeholder="2026-12-01T13:00:00+09:00"
          />
          <CrmField
            label="終了日時（ISO・時差付き）"
            name="endsAt"
            placeholder="2026-12-01T14:00:00+09:00"
          />
          <CrmField
            label="定員"
            name="capacity"
            type="number"
            defaultValue="1"
          />
          <CrmButton>枠を作成</CrmButton>
        </form>
      </section>
      <section className="crm-card">
        <h2>
          予約枠 <CrmBadge>表示時刻：日本時間</CrmBadge>
        </h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>枠</th>
                <th>日時</th>
                <th>予約 / 定員</th>
                <th>空き</th>
              </tr>
            </thead>
            <tbody>
              {slots.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.title}</strong>
                    <code>{s.id}</code>
                  </td>
                  <td>
                    <time>{when(s.startsAt)}</time>
                    <br />
                    <time>〜 {when(s.endsAt)}</time>
                  </td>
                  <td>
                    {s.booked} / {s.capacity}
                  </td>
                  <td>
                    <CrmBadge>{Math.max(0, s.capacity - s.booked)}席</CrmBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!slots.data.length && !error && (
          <p className="crm-empty">予約枠はまだありません。</p>
        )}
        {slots.nextCursor && (
          <Link
            href={`/crm/bookings?slotAfter=${encodeURIComponent(slots.nextCursor)}`}
          >
            次の予約枠 →
          </Link>
        )}
      </section>
      <section className="crm-card">
        <h2>予約を登録</h2>
        <form action={bookSlot} className="crm-grid">
          <CrmField label="顧客ID（顧客台帳からコピー）" name="customerId" />
          <CrmField label="予約枠ID" name="slotId" />
          <input type="hidden" name="requestKey" value={crypto.randomUUID()} />
          <CrmButton>予約する</CrmButton>
        </form>
      </section>
      <section className="crm-card">
        <h2>予約一覧</h2>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>予約ID</th>
                <th>顧客ID / 予約枠ID</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {bookings.data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <code>{b.id}</code>
                  </td>
                  <td>
                    <code>{b.customerId}</code>
                    <code>{b.slotId}</code>
                  </td>
                  <td>
                    <CrmBadge>
                      {b.status === "confirmed" ? "予約確定" : "キャンセル済み"}
                    </CrmBadge>
                  </td>
                  <td>
                    {b.status === "confirmed" && (
                      <form action={cancelBooking}>
                        <input type="hidden" name="id" value={b.id} />
                        <CrmButton secondary>キャンセル</CrmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!bookings.data.length && !error && (
          <p className="crm-empty">予約はまだありません。</p>
        )}
        <div className="crm-pagination">
          <Link href="/crm/bookings">先頭へ</Link>
          {bookings.nextCursor && (
            <Link
              href={`/crm/bookings?after=${encodeURIComponent(bookings.nextCursor)}`}
            >
              次の50件 →
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
