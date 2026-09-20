import Link from "next/link";
import { ArrowUpRight, CalendarDays, Download, TrendingUp } from "lucide-react";
import { bookingMoney } from "@/lib/booking-format";
import type { professionalReport } from "@/lib/professional-reporting";

type Report = Awaited<ReturnType<typeof professionalReport>>;
type Section = "overview" | "revenue" | "bookings" | "resources" | "customers";
const sections: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "revenue", label: "Revenue" },
  { id: "bookings", label: "Bookings" }, { id: "resources", label: "Courts & spaces" },
  { id: "customers", label: "Customers" },
];
function amount(value: number, currency: string) { return bookingMoney(value, currency); }
function Percent({ value }: { value: number | null }) { return <>{value === null ? "—" : `${value}%`}</>; }
function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="pro-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
function Chart({ report, currency, mode }: { report: Report; currency: string; mode: "value" | "bookings" }) {
  const points = report.series;
  const max = Math.max(1, ...points.map(point => mode === "bookings" ? point.bookings : Math.max(point.bookingValue, point.collected)));
  if (!points.some(point => point.bookings)) return <p className="pro-empty">Not enough booking data yet. Insights will appear as customers start booking.</p>;
  const shown = points.length > 35 ? points.filter((_, index) => index % Math.ceil(points.length / 35) === 0) : points;
  return <div className="pro-chart" role="img" aria-label={mode === "bookings" ? "Bookings by local date" : "Booking value and collected amount by local date"}>
    {shown.map(point => <div className="pro-chart-day" key={point.date} title={`${point.date}: ${point.bookings} bookings; booked ${amount(point.bookingValue, currency)}; collected ${amount(point.collected, currency)}`}>
      <div className="pro-chart-bars">{mode === "bookings" ? <i style={{ height: `${Math.max(3, point.bookings / max * 100)}%` }} /> :
        <><i style={{ height: `${Math.max(3, point.bookingValue / max * 100)}%` }} /><i className="collected" style={{ height: `${Math.max(3, point.collected / max * 100)}%` }} /></>}</div>
      <small>{point.date.slice(5)}</small>
    </div>)}
  </div>;
}
function Heatmap({ report }: { report: Report }) {
  const max = Math.max(1, ...report.heatmap.flat());
  return <div className="pro-heatmap-scroll"><div className="pro-heatmap">
    <span />{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <strong key={day}>{day}</strong>)}
    {report.heatmap.map((row, period) => <div className="pro-heatmap-row" key={period}>
      <span>{String(period * 2).padStart(2, "0")}:00</span>{row.map((count, weekday) =>
        <div key={weekday} className="pro-heatmap-cell" data-level={count === 0 ? 0 : Math.ceil(count / max * 4)}
          title={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday]} ${String(period * 2).padStart(2, "0")}:00–${String((period + 1) * 2).padStart(2, "0")}:00: ${count} booking starts`}
          aria-label={`${count} bookings started on ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday]} between ${period * 2}:00 and ${(period + 1) * 2}:00`}>{count || "·"}</div>)}
    </div>)}
  </div></div>;
}
function ValueList({ rows, currency }: { rows: { name: string; bookingValue: number; subtitle?: string }[]; currency: string }) {
  const max = Math.max(1, ...rows.map(row => row.bookingValue));
  return rows.length ? <div className="pro-ranked-list">{rows.map((row, index) => <div key={index}>
    <div><strong>{row.name}</strong>{row.subtitle && <small>{row.subtitle}</small>}</div>
    <span className="pro-ranked-track"><i style={{ width: `${row.bookingValue / max * 100}%` }} /></span>
    <b>{amount(row.bookingValue, currency)}</b>
  </div>)}</div> : <p className="pro-empty">No data for this period.</p>;
}
export function ProfessionalInsights({ report, currency, section }: { report: Report; currency: string; section: Section }) {
  const query = new URLSearchParams({ range: report.filter.range, from: report.fromDate, to: report.toDate, section,
    ...(report.filter.sport ? { sport: report.filter.sport } : {}),
    ...(report.filter.resource ? { resource: report.filter.resource } : {}),
    ...(report.filter.status !== "ALL" ? { status: report.filter.status } : {}) });
  const show = (name: Section) => section === "overview" || section === name;
  const activeResources = report.utilization.resources.filter(item => item.percent !== null);
  const ranked = [...activeResources].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return <div className="foundation-page pro-reports"><header className="pro-page-head"><div><p className="eyebrow">INSIGHTS / PROFESSIONAL</p><h1>Reports</h1><p>Understand your business, one clear view at a time.</p></div><div className="starter-head-actions"><Link className="button button-secondary" href="/reports/schedules">Scheduled reports</Link><Link className="button button-secondary" prefetch={false} href={`/api/reports/professional.csv?${query}`}><Download size={16} /> Export CSV</Link></div></header>
    <nav className="pro-section-tabs" aria-label="Report section">{sections.map(item => <Link key={item.id}
      className={section === item.id ? "active" : ""} href={`/reports?${new URLSearchParams({ ...Object.fromEntries(query), section: item.id })}`}>{item.label}</Link>)}</nav>
    <form className="pro-filter-bar" action="/reports" method="get"><input type="hidden" name="section" value={section} />
      <label>Period<select name="range" defaultValue={report.filter.range}><option value="today">Today</option><option value="last7">Last 7 days</option><option value="this_month">This month</option><option value="last_month">Last month</option><option value="last30">Last 30 days</option><option value="custom">Custom dates</option></select></label>
      <label>From<input name="from" type="date" defaultValue={report.filter.range === "custom" ? report.fromDate : ""} /></label>
      <label>To<input name="to" type="date" defaultValue={report.filter.range === "custom" ? report.toDate : ""} /></label>
      <label>Sport<select name="sport" defaultValue={report.filter.sport ?? ""}><option value="">All sports</option>{[...new Map(report.availableResources.map(item => [item.sportTypeId, item.sportName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Space<select name="resource" defaultValue={report.filter.resource ?? ""}><option value="">All spaces</option>{report.availableResources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={report.filter.status}><option value="ALL">All statuses</option>{["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
      <button className="button button-primary">Apply</button>
    </form>
    <p className="pro-period"><CalendarDays size={15} /> {report.fromDate} – {report.toDate} · {report.timezone}</p>
    {show("revenue") && <><section className="pro-metrics" aria-label="Revenue"><Metric label="Booking value" value={amount(report.totals.bookingValue, currency)} note="Confirmed and fulfilled booking totals" /><Metric label="Collected" value={amount(report.totals.collected, currency)} note="Net paid against bookings in this period" /><Metric label="Outstanding" value={amount(report.totals.outstanding, currency)} note="Unpaid balance on active bookings" /><Metric label="Refunds" value={amount(report.totals.refunds, currency)} note="Succeeded refunds on these bookings" /></section>
      <section className="foundation-card pro-panel"><div className="pro-panel-head"><div><p className="eyebrow">REVENUE</p><h2>Booked vs collected</h2></div><span><i /> Booking value <i className="collected" /> Collected</span></div><Chart report={report} currency={currency} mode="value" /><p className="pro-note">Amounts are attributed to booking date, not payment date. Refunded amounts are already reflected in net paid.</p></section></>}
    {show("bookings") && <div className="pro-two-columns"><section className="foundation-card pro-panel"><div className="pro-panel-head"><div><p className="eyebrow">BOOKINGS</p><h2>Volume over time</h2></div></div><Chart report={report} currency={currency} mode="bookings" /></section>
      <section className="foundation-card pro-panel"><p className="eyebrow">OUTCOMES</p><h2>Booking performance</h2><div className="pro-outcomes"><Metric label="All bookings" value={report.totals.bookings} /><Metric label="Completed" value={report.totals.completed} /><Metric label="Cancelled" value={report.totals.cancelled} note={`${report.totals.cancellationRate ?? "—"}% of all bookings`} /><Metric label="No-shows" value={report.totals.noShows} note={`${report.totals.noShowRate ?? "—"}% of confirmed bookings`} /></div>{report.totals.cancelled ? <p className="pro-note">Cancelled booking value: {amount(report.totals.cancellationValue, currency)}. Expired holds are excluded.</p> : <p className="pro-note">No cancellations during this period.</p>}</section></div>}
    {show("resources") && <><div className="pro-two-columns"><section className="foundation-card pro-panel"><p className="eyebrow">CAPACITY</p><h2>Space utilisation</h2><div className="pro-feature-number"><Percent value={report.utilization.percent} /></div><p className="pro-note">Booked usable minutes ÷ available opening minutes. Blocks and maintenance time are removed. Only confirmed, checked-in, in-progress and completed bookings occupy time.</p><div className="pro-ranked-list">{ranked.map(item => <div key={item.id}><strong>{item.name}</strong><span className="pro-ranked-track"><i style={{ width: `${item.percent ?? 0}%` }} /></span><b><Percent value={item.percent} /></b></div>)}</div>{!ranked.length && <p className="pro-empty">No opening hours to calculate utilisation.</p>}</section>
      <section className="foundation-card pro-panel"><p className="eyebrow">SPACE PERFORMANCE</p><h2>Booking value by space</h2><ValueList currency={currency} rows={report.resourceRevenue.map(item => ({ name: item.name, subtitle: item.sport, bookingValue: item.bookingValue }))} /></section></div>
      <section className="foundation-card pro-panel"><div className="pro-panel-head"><div><p className="eyebrow">PEAK TIMES</p><h2>When customers play</h2></div><span>Booking starts by local 2-hour period</span></div><div className="pro-peak"><span>Busiest day <strong>{report.peak.day ?? "Not enough data"}</strong></span><span>Busiest period <strong>{report.peak.period ?? "Not enough data"}</strong></span></div><Heatmap report={report} /></section></>}
    {show("customers") && <div className="pro-two-columns"><section className="foundation-card pro-panel"><p className="eyebrow">CUSTOMERS</p><h2>New & returning</h2><div className="pro-outcomes"><Metric label="New" value={report.customers.new} /><Metric label="Returning" value={report.customers.returning} /><Metric label="Returning rate" value={report.customers.returningRate === null ? "—" : `${report.customers.returningRate}%`} /></div><p className="pro-note">New means the first confirmed booking was in this period. Returning means a customer booked again after an earlier confirmation.</p></section>
      <section className="foundation-card pro-panel"><p className="eyebrow">LOYALTY</p><h2>Top customers</h2><ValueList currency={currency} rows={report.customers.top.map(item => ({ name: item.name, bookingValue: item.bookingValue, subtitle: `${item.bookings} bookings` }))} /></section></div>}
    <div className="pro-report-footer"><span><TrendingUp size={17} /> Based on your venue’s actual bookings</span><Link href="/settings/plan">Professional plan <ArrowUpRight size={15} /></Link></div>
  </div>;
}
