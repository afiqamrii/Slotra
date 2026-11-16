import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CreditCard, Search, Wallet } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingDate, bookingMoney, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { branchContext } from "@/lib/branch-context";
import { paymentWorkspace } from "@/lib/payment-workspace";
import { paymentStatuses, refundStatuses } from "@/db/schema";
import { StatusBadge } from "@/components/ui";
import "@/app/payments-workspace.css";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization, session, member } = await requirePermission("payment:view");
  const db = getDb();
  const context = await branchContext(db, organization.organizationId, session.user.id);
  const branchId = context.selected && context.selected !== "all" ? context.selected : undefined;
  const data = await paymentWorkspace(db, session.user.id, organization.organizationId, await searchParams, branchId);
  const { filters } = data;
  const branchName = context.branches.find(item => item.id === branchId)?.name ?? "All branches";
  const href = (changes: Record<string, string | number> = {}) => `/payments?${new URLSearchParams(Object.entries({ ...filters, ...changes }).filter(([, value]) => value !== "").map(([key, value]) => [key, String(value)]))}`;
  const canOpen = member.effectivePermissions.includes("booking:view");
  const titles = { activity: "Payment activity", outstanding: "Outstanding balances", refunds: "Refund history" };
  const activeFilters = !!(filters.q || filters.status);
  return <div className="booking-ops-page payments-workspace"><header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / PAYMENTS</p><h1>Payments</h1><p>Track money received, find unpaid bookings, and review refunds.</p></div>
    {member.effectivePermissions.includes("payment:manage_settings") && <Link href="/settings/payments" className="button button-secondary">Payment settings</Link>}
  </header>
  <section className="payment-balance-overview" aria-label="Outstanding summary"><div className="payment-balance-heading"><Wallet size={23} aria-hidden /><div><strong>Still to collect</strong><span>{branchName} · All outstanding bookings</span></div></div>
    {data.totals.length ? data.totals.map(total => <Link key={total.currency} href={href({ view: "outstanding", page: 1, q: "", status: "" })} className="payment-balance-total"><strong>{bookingMoney(total.amount, total.currency)}</strong><span>{total.count} {total.count === 1 ? "booking" : "bookings"}<ArrowUpRight size={14} aria-hidden /></span></Link>) : <div className="payment-balance-total"><strong>All caught up</strong><span>No outstanding confirmed bookings</span></div>}
    <p>Balances exclude cancelled bookings and unconfirmed payment holds.</p>
  </section>
  <section className="booking-board"><nav className="booking-tabs" aria-label="Payment views">{([ ["activity", "Activity"], ["outstanding", "Outstanding"], ["refunds", "Refunds"] ] as const).map(([value, label]) => <Link key={value} href={href({ view: value, page: 1, status: "" })} aria-current={filters.view === value ? "page" : undefined} className={filters.view === value ? "booking-tab active" : "booking-tab"}>{label}</Link>)}</nav>
    <form className="payment-workspace-filters" method="get" action="/payments" key={JSON.stringify(filters)}><input type="hidden" name="view" value={filters.view} />
      <label className="booking-search"><Search size={18} aria-hidden /><span className="sr-only">Search payments</span><input type="search" name="q" maxLength={100} defaultValue={filters.q} placeholder="Search reference, customer or phone" /></label>
      {filters.view !== "outstanding" && <label className="venue-field"><span>Status</span><select name="status" defaultValue={filters.status}><option value="">All statuses</option>{(filters.view === "refunds" ? refundStatuses : paymentStatuses).map(status => <option key={status} value={status}>{bookingStatusLabel(status)}</option>)}</select></label>}
      <button className="button button-primary" type="submit">Apply</button>{activeFilters && <Link className="text-link" href={href({ q: "", status: "", page: 1 })}>Clear filters</Link>}
    </form>
    <div className="booking-list-context"><strong>{titles[filters.view]} · {data.rows.length} {data.hasMore || filters.page > 1 ? "on this page" : data.rows.length === 1 ? "record" : "records"}</strong><span>{branchName}</span></div>
    {filters.view === "refunds" && <p className="payment-workspace-note">Only succeeded refunds represent money recorded as returned. Manual refunds are recorded after returning funds outside the app.</p>}
    {filters.view === "activity" && <p className="payment-workspace-note">Original payment amounts are shown here. Refund amounts are listed separately under Refunds.</p>}
    {data.rows.length ? <div className="payment-workspace-rows">{data.rows.map(row => {
      const content = <><div className="payment-row-description"><strong>{row.customer ?? "Guest / walk-in"}</strong><span>{row.reference} · {row.resourceName}</span><small>{bookingDate(row.at, row.timezone)} · {bookingTime(row.at, row.timezone)}{context.selected === "all" ? ` · ${row.branchName}` : ""}</small></div><div className="payment-row-amount"><strong>{bookingMoney(row.amount, row.currency)}</strong><StatusBadge label={filters.view === "outstanding" ? "Unpaid" : bookingStatusLabel(row.status)} tone={row.status === "PAID" || row.status === "SUCCEEDED" ? "success" : row.status === "FAILED" || filters.view === "outstanding" ? "warning" : "neutral"} /><small>{row.method ? bookingStatusLabel(row.method) : "Refund"}</small></div>{canOpen && <ArrowUpRight className="payment-open-icon" size={17} aria-hidden />}</>;
      return canOpen ? <Link key={row.id} href={`/bookings/${row.bookingId}`} className="payment-workspace-row" aria-label={`Open booking ${row.reference}, ${bookingMoney(row.amount, row.currency)}`}>{content}</Link> : <div key={row.id} className="payment-workspace-row">{content}</div>;
    })}</div> : <div className="booking-empty"><CreditCard size={30} aria-hidden /><h2>{activeFilters ? "No records match these filters" : filters.view === "outstanding" ? "No outstanding balances" : filters.view === "refunds" ? "No refunds recorded" : "No payments recorded yet"}</h2><p>{activeFilters ? "Try another reference, customer or status." : filters.view === "outstanding" ? "Confirmed bookings with an unpaid balance will appear here." : "Records appear here after a payment or refund is recorded against a booking."}</p>{activeFilters ? <Link className="button button-secondary" href={href({ q: "", status: "", page: 1 })}>Clear filters</Link> : filters.page > 1 ? <Link className="button button-secondary" href={href({ page: 1 })}>Back to first page</Link> : canOpen && <Link className="button button-secondary" href="/bookings">View bookings</Link>}</div>}
    {(data.rows.length > 0 || filters.page > 1) && <nav className="booking-pagination" aria-label="Payment pages">{filters.page > 1 && <Link className="button button-secondary" href={href({ page: filters.page - 1 })}>Previous</Link>}<span>Page {filters.page}</span>{data.hasMore && <Link className="button button-secondary" href={href({ page: filters.page + 1 })}>Next</Link>}</nav>}
  </section></div>;
}
