import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup } from "@/lib/booking-management";
import { bookingMoney } from "@/lib/booking-format";
import { basicReport } from "@/lib/starter-reporting";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

type Params = Record<string, string | string[] | undefined>;
const value = (input: string | string[] | undefined) => typeof input === "string" ? input : undefined;
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session } = await requirePermission("booking:view");
  const db = getDb();
  const organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "BASIC_REPORTS")) return <div className="foundation-page"><h1>Reports unavailable</h1></div>;
  const params = await searchParams;
  const setup = await bookingSetup(db, session.user.id, organizationId);
  const timezone = setup.branches[0]?.timezone ?? "Asia/Kuala_Lumpur";
  const input = { range: value(params.range), from: value(params.from), to: value(params.to) };
  const report = await basicReport(db, organizationId, timezone, input);
  const query = new URLSearchParams({ range: report.range, from: report.fromDate, to: report.toDate });
  return <div className="foundation-page starter-reports"><p className="eyebrow">OPERATIONS / REPORTS</p><h1>Reports</h1><p className="foundation-lead">A clear view of bookings and payments, without the noise.</p>
    <nav className="booking-tabs" aria-label="Report period">{([ ["today", "Today"], ["week", "This week"], ["month", "This month"] ] as const).map(([range, label]) => <Link key={range} className={report.range === range ? "booking-tab active" : "booking-tab"} href={`/reports?range=${range}`}>{label}</Link>)}</nav>
    <form action="/reports" method="get" className="starter-report-form"><input type="hidden" name="range" value="custom" /><label>From<input type="date" name="from" defaultValue={report.range === "custom" ? report.fromDate : ""} required /></label><label>To<input type="date" name="to" defaultValue={report.range === "custom" ? report.toDate : ""} required /></label><button className="button button-secondary">Apply dates</button></form>
    <p className="starter-report-period">{report.fromDate} – {report.toDate} · {timezone}</p>
    <section className="starter-metric-grid" aria-label="Report totals"><div className="starter-metric"><span>Bookings</span><strong>{report.totals.bookings}</strong></div><div className="starter-metric"><span>Booking value</span><strong>{bookingMoney(report.totals.bookingValue, setup.currency)}</strong></div><div className="starter-metric"><span>Collected</span><strong>{bookingMoney(report.totals.collected, setup.currency)}</strong></div><div className="starter-metric"><span>Outstanding</span><strong>{bookingMoney(report.totals.outstanding, setup.currency)}</strong></div></section>
    <section className="foundation-card starter-panel"><h2>Booking outcomes</h2><div className="starter-month-grid"><div><span>Completed</span><strong>{report.totals.completed}</strong></div><div><span>Cancelled</span><strong>{report.totals.cancelled}</strong></div><div><span>All bookings</span><strong>{report.totals.bookings}</strong></div></div><p className="starter-muted">Booking value excludes cancelled and expired bookings. Collected is the net amount paid against bookings scheduled in this period, not a cash-flow report. Outstanding excludes cancelled and expired bookings.</p></section>
    <section className="foundation-card starter-panel"><h2>Download your data</h2><p>CSV files open in most spreadsheet apps. Exports are limited to 10,000 rows at a time.</p><div className="starter-head-actions"><a className="button button-secondary" href={`/api/exports/bookings?${query}`}>Bookings CSV</a><a className="button button-secondary" href="/api/exports/customers">Customers CSV</a><a className="button button-secondary" href={`/api/exports/payments?${query}`}>Payments CSV</a></div></section>
    <section className="starter-premium-preview"><span>PROFESSIONAL PREVIEW</span><h2>Go deeper when you’re ready</h2><p>Peak hours, court utilisation and customer trends are planned for Professional.</p><Link href="/settings/plans">Compare plans →</Link></section>
  </div>;
}
