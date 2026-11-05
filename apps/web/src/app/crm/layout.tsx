import type { ReactNode } from "react";
import Link from "next/link";
import "@cloudflare/kumo/styles/standalone";
import "./style.css";
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <Link href="/crm/customers" className="crm-brand">
          HARNESS<span>顧客と予約の管理</span>
        </Link>
        <nav aria-label="管理メニュー">
          <Link href="/crm/customers">顧客台帳</Link>
          <Link href="/crm/bookings">予約管理</Link>
          <Link href="/">投稿管理</Link>
        </nav>
        <p>
          LOCAL WORKSPACE
          <br />
          ローカル管理者用
        </p>
      </aside>
      <main className="crm-main">
        <div className="crm-topline">
          TELEGRAM HARNESS <span>フェーズ1 · 顧客管理</span>
        </div>
        {children}
      </main>
    </div>
  );
}
