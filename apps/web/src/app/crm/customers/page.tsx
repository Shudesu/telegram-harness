import Link from "next/link";
import { crmApi, type List } from "../api";
import { addCustomer } from "../actions";
import { CrmBadge, CrmButton, CrmField } from "../../../components/crm-ui";
export const dynamic = "force-dynamic";
interface Customer {
  id: string;
  displayName: string;
  source: string;
  tags: string[];
  createdAt: string;
}
export default async function Customers({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; notice?: string }>;
}) {
  const q = await searchParams;
  let list: List<Customer> = { data: [], nextCursor: null },
    error = "";
  try {
    list = await crmApi(
      `customers?limit=50&after=${encodeURIComponent(q.after ?? "")}`,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "読み込みに失敗しました";
  }
  return (
    <>
      <h1>顧客台帳</h1>
      <p className="crm-intro">
        Botやチャンネルが変わっても、顧客との関係を一つの台帳に。
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
        <h2>顧客を登録</h2>
        <form action={addCustomer} className="crm-grid">
          <CrmField
            label="表示名"
            name="displayName"
            placeholder="例：山田 花子"
          />
          <CrmField
            label="流入元"
            name="source"
            placeholder="例：予約フォーム"
          />
          <CrmField
            label="タグ（カンマ区切り・任意）"
            name="tags"
            placeholder="新規, 相談希望"
          />
          <CrmButton>登録する</CrmButton>
        </form>
      </section>
      <section className="crm-card">
        <h2>
          登録済み顧客 <CrmBadge>{list.data.length}件 / このページ</CrmBadge>
        </h2>
        <p className="crm-table-hint">表は横にスクロールして確認できます。</p>
        <div className="crm-table-wrap" role="region" aria-label="登録済み顧客" tabIndex={0}>
          <table className="crm-table">
            <thead>
              <tr>
                <th>顧客</th>
                <th>流入元</th>
                <th>タグ</th>
                <th>登録日</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.displayName}</strong>
                    <code>{c.id}</code>
                  </td>
                  <td>{c.source}</td>
                  <td>
                    {c.tags.length
                      ? c.tags.map((t) => <CrmBadge key={t}>{t}</CrmBadge>)
                      : "—"}
                  </td>
                  <td>
                    {new Date(c.createdAt).toLocaleDateString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.data.length && !error && (
          <p className="crm-empty">
            まだ顧客が登録されていません。最初の顧客を登録してください。
          </p>
        )}
        <div className="crm-pagination">
          <Link href="/crm/customers">先頭へ</Link>
          {list.nextCursor && (
            <Link
              href={`/crm/customers?after=${encodeURIComponent(list.nextCursor)}`}
            >
              次の50件 →
            </Link>
          )}
        </div>
      </section>
      <p className="crm-note">
        連絡先の登録・確認・目的別同意・台帳の書き出しは、CRM API /
        MCPから操作できます。登録だけでは配信同意になりません。
      </p>
    </>
  );
}
