import Link from "next/link";
import { getDb } from "@/db/client";
import { bookingMoney } from "@/lib/booking-format";
import { requirePermission } from "@/lib/authorization";
import { proExecutiveReport } from "@/lib/pro-reporting";
import { branchContext } from "@/lib/branch-context";

type Params = { range?: string; from?: string; to?: string; branchId?: string; sort?: string };
export default async function BranchComparisonPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session } = await requirePermission("report:view_financial");
  const params = await searchParams;
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const report = await proExecutiveReport(getDb(), session.user.id, organization.organizationId, {
    range: params.range, from: params.from, to: params.to,
    branchId: params.branchId || (selectedBranch.selected !== "all" && !selectedBranch.canSwitch
      ? selectedBranch.selected ?? undefined : undefined), sort: params.sort,
  });
  const money = (amount: number) => bookingMoney(amount, report.currency);
  const pct = (value: number | null) => value === null ? "—" : `${value}%`;
  return <div className="foundation-page pro-reports"><header className="pro-page-head"><div>
    <p className="eyebrow">INSIGHTS / PRO</p><h1>Branch performance</h1>
    <p>Compare your locations using bookings scheduled in each branch’s local timezone.</p></div>
    <Link className="button button-secondary" href="/reports">Standard reports</Link></header>
    <form action="/reports/branches" method="get" className="pro-filter-bar">
      <label>Period<select name="range" defaultValue={report.filter.range}><option value="today">Today</option>
        <option value="last7">Last 7 days</option><option value="this_month">This month</option>
        <option value="last_month">Last month</option><option value="last30">Last 30 days</option>
        <option value="custom">Custom dates</option></select></label>
      <label>From<input type="date" name="from" defaultValue={params.from ?? ""} /></label>
      <label>To<input type="date" name="to" defaultValue={params.to ?? ""} /></label>
      <label>Branch<select name="branchId" defaultValue={report.filter.branchId ?? ""}><option value="">All branches</option>
        {report.branchOptions.map(branch => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label>Sort by<select name="sort" defaultValue={report.filter.sort}><option value="bookingValue">Booking value</option>
        <option value="bookings">Bookings</option><option value="collected">Collected</option>
        <option value="utilization">Utilisation</option></select></label>
      <button className="button button-primary">Apply</button>
    </form>
    <section className="starter-metric-grid" aria-label="All selected branches">
      <div className="starter-metric"><span>Bookings</span><strong>{report.totals.bookings}</strong><small>Confirmed or later</small></div>
      <div className="starter-metric"><span>Booking value</span><strong>{money(report.totals.bookingValue)}</strong><small>Scheduled bookings</small></div>
      <div className="starter-metric"><span>Collected</span><strong>{money(report.totals.collected)}</strong><small>Net paid against these bookings</small></div>
      <div className="starter-metric"><span>Utilisation</span><strong>{pct(report.totals.utilization)}</strong><small>Booked / usable hours</small></div>
    </section>
    <section className="foundation-card starter-panel"><h2>Branch comparison</h2>
      {report.branches.length ? <div className="booking-list-desktop"><table className="booking-table"><thead><tr>
        <th>Branch</th><th>Bookings</th><th>Booking value</th><th>Collected</th><th>Outstanding</th><th>Utilisation</th>
      </tr></thead><tbody>{report.branches.map(branch => <tr key={branch.id}><td><strong>{branch.name}</strong>
        <small>{branch.fromDate} – {branch.toDate} · {branch.timezone}{!branch.isActive ? " · Paused" : ""}</small></td>
        <td>{branch.bookings}</td><td>{money(branch.bookingValue)}</td><td>{money(branch.collected)}</td>
        <td>{money(branch.outstanding)}</td><td>{pct(branch.utilization)}</td></tr>)}</tbody></table></div> :
        <p>No branches to compare yet.</p>}
      <p className="small-note">Totals add each branch once. Collected is net payment allocated to bookings in this period, not cash received during the period. Current hours and maintenance state estimate historical utilisation.</p>
    </section>
    <section className="foundation-card starter-panel"><h2>Courts & spaces performance</h2>
      {report.resources.length ? <div className="data-list">{report.resources.slice(0, 20).map(resource =>
        <div className="data-row" key={resource.id}><span><strong>{resource.name}</strong><small>{resource.branchName} · {resource.bookedHours} booked hours · {pct(resource.utilization)} utilised</small></span>
          <span>{money(resource.bookingValue)}<small>{money(resource.collected)} collected</small></span></div>)}</div> :
        <p>No spaces or bookings in this period.</p>}
      <p className="small-note">This is revenue performance, not profit; operating costs are not tracked.</p>
    </section>
    <section className="foundation-card starter-panel"><h2>Corporate account usage</h2>
      {report.corporate.length ? <div className="data-list">{report.corporate.map(account =>
        <div className="data-row" key={account.id}><span><strong>{account.name}</strong><small>{account.bookings} bookings</small></span>
          <span>{money(account.valueMinor)} booking value</span></div>)}</div> : <p>No corporate bookings in this period.</p>}
      <p className="small-note">Usage is a booking charge, not collected revenue or an issued invoice.</p>
    </section>
  </div>;
}
