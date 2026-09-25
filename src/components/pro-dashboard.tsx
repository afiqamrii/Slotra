import Link from "next/link";
import { bookingMoney } from "@/lib/booking-format";
import type { proExecutiveReport } from "@/lib/pro-reporting";

type Report = Awaited<ReturnType<typeof proExecutiveReport>>;
export function ProDashboard({ name, report, currency, bookingLimit, bookingUsed }: {
  name: string; report: Report; currency: string; bookingLimit: number; bookingUsed: number;
}) {
  const money = (minor: number) => bookingMoney(minor, currency);
  return <div className="foundation-page pro-reports"><header className="pro-page-head"><div>
    <p className="eyebrow">ALL BRANCHES / TODAY</p><h1>Good to see you, {name}</h1>
    <p>A clear view across your locations. Switch branches above to focus on one venue.</p></div>
    <div className="starter-head-actions"><Link className="button button-secondary" href="/settings/branch">Manage branches</Link>
      <Link className="button button-primary" href="/reports/branches">Compare branches</Link></div></header>
    <section className="starter-metric-grid" aria-label="All branches today">
      <div className="starter-metric"><span>Bookings today</span><strong>{report.totals.bookings}</strong><small>Confirmed or later</small></div>
      <div className="starter-metric"><span>Booking value</span><strong>{money(report.totals.bookingValue)}</strong><small>Across {report.branches.length} branches</small></div>
      <div className="starter-metric"><span>Collected</span><strong>{money(report.totals.collected)}</strong><small>Applied to today’s bookings</small></div>
      <div className="starter-metric"><span>Utilisation</span><strong>{report.totals.utilization === null ? "—" : `${report.totals.utilization}%`}</strong><small>Booked / usable time</small></div>
    </section>
    <p className="small-note">{report.totals.activeResources} active courts & spaces · {money(report.totals.outstanding)} outstanding across today’s bookings</p>
    <div className="starter-dashboard-columns"><section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">LOCATIONS</p><h2>Branch snapshot</h2></div><Link href="/reports/branches">Full comparison →</Link></div>
      {report.branches.length ? <div className="data-list">{report.branches.map(branch => <div className="data-row" key={branch.id}>
        <span><strong>{branch.name}</strong><small>{branch.bookings} bookings · {branch.timezone}</small></span>
        <span><strong>{money(branch.bookingValue)}</strong><small>{branch.utilization === null ? "—" : `${branch.utilization}%`} utilised</small></span>
      </div>)}</div> : <p>No branches yet.</p>}</section>
      <section className="foundation-card starter-panel"><p className="eyebrow">CAPACITY</p><h2>Plan usage</h2>
        <p><strong>{bookingUsed.toLocaleString()} / {bookingLimit.toLocaleString()}</strong> confirmed bookings this UTC month.</p>
        <progress value={bookingUsed} max={bookingLimit} aria-label="Monthly booking usage" />
        <p className="small-note">Existing bookings remain visible if you reach your plan limit. Branch-local report dates and UTC billing usage are different measures.</p>
        <Link className="button button-secondary" href="/settings/plan">Plan & usage</Link></section></div>
  </div>;
}
