import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, CircleDot, Clock3, Ticket, Timer } from "lucide-react";
import type { DashboardOperationsData } from "@/lib/dashboard-operations";
import { bookingDate, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { DashboardRefresh } from "@/components/dashboard-refresh";
import "@/app/dashboard-operations.css";

export function DashboardOperations({ data }: { data: DashboardOperationsData }) {
  const { counts, branches, at, branchId } = data;
  const branchQuery = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
  const bookingsHref = `/bookings?view=today${branchQuery}`;
  const multiple = branches.length > 1;
  const attentionCount = counts.lateCheckIn + counts.wrapUp;
  return <section className="dashboard-operations" aria-labelledby="dashboard-operations-title">
    <div className="dashboard-operations-heading"><div><p className="eyebrow">YOUR VENUE TODAY</p><h2 id="dashboard-operations-title">Keep the day moving</h2>
      <p>{multiple ? `${branches.length} locations · each branch’s local day` : `${branches[0].name} · ${bookingDate(at, branches[0].timezone, true)}`}</p></div>
      <DashboardRefresh /></div>
    <div className="dashboard-operation-metrics">
      <div><CalendarDays aria-hidden size={18} /><span>Scheduled today</span><strong>{counts.scheduled}</strong><small>Confirmed and fulfilled bookings</small></div>
      <div><CircleDot aria-hidden size={18} /><span>Active sessions</span><strong>{counts.live}</strong><small>Within their reserved time</small></div>
      <div><Clock3 aria-hidden size={18} /><span>Still to arrive</span><strong>{counts.arriving}</strong><small>Confirmed sessions later today</small></div>
      <div data-attention={attentionCount > 0}><CheckCircle2 aria-hidden size={18} /><span>Needs a status update</span><strong>{attentionCount}</strong><small>{counts.lateCheckIn} to check in · {counts.wrapUp} to finish</small></div>
    </div>
    <div className="dashboard-operation-columns">
      <section className="dashboard-agenda"><header><div><h3>Now & next</h3><p>Current sessions first, then the next arrivals.</p></div><Link href={bookingsHref}>Open bookings <ArrowRight size={14} aria-hidden /></Link></header>
        {data.sessions.length ? <ol>{data.sessions.map(row => {
          const live = row.startAt <= at && row.endAt > at;
          return <li key={row.id}><Link href={`/bookings/${row.id}`}>
            <span className="dashboard-session-time"><strong>{bookingTime(row.startAt, row.timezone)}</strong><small>to {bookingTime(row.endAt, row.timezone)}</small></span>
            <span className="dashboard-session-person"><strong>{row.customerName ?? "Guest / walk-in"}</strong><span>{row.resourceName}{multiple ? ` · ${row.branchName}` : ""}</span><small>{row.reference}{multiple ? ` · ${row.timezone}` : ""}</small></span>
            <span className={live ? "dashboard-session-state is-live" : "dashboard-session-state"}>{live ? "Now" : bookingStatusLabel(row.status)}</span><ArrowRight size={16} aria-hidden />
          </Link></li>;
        })}</ol> : <div className="dashboard-agenda-empty"><CalendarDays size={27} aria-hidden /><h4>{counts.scheduled ? "You’re up to date" : "A clear day ahead"}</h4><p>No current or upcoming confirmed sessions today. New bookings will appear here.</p>{data.canCreate && <Link href="/bookings/new" className="text-link">Add a booking <ArrowRight size={14} aria-hidden /></Link>}</div>}
        <footer><Clock3 size={13} aria-hidden /> Updated {bookingTime(at, branches[0].timezone)} · {multiple ? branches[0].timezone : "venue local time"}. Refresh for the latest.</footer>
      </section>
      <aside className="dashboard-action-panel"><h3>Front-desk checklist</h3>
        {data.attention.length ? <div className="dashboard-attention-list">{data.attention.map(row => <Link href={`/bookings/${row.id}`} key={row.id}>
          <span className="dashboard-attention-icon"><Timer size={17} aria-hidden /></span><span><strong>{row.status === "CONFIRMED" ? data.canCheckIn ? "Confirm arrival" : "Review arrival" : data.canUpdate ? "Finish session" : "Review session"}</strong><small>{row.resourceName}{multiple ? ` · ${row.branchName}` : ""} · {bookingTime(row.startAt, row.timezone)}</small></span><ArrowRight size={14} aria-hidden />
        </Link>)}</div> : <p className="dashboard-checklist-clear"><CheckCircle2 size={19} aria-hidden /> No check-in or completion updates waiting.</p>}
        <div className="dashboard-checklist-counts"><div><Ticket size={15} aria-hidden /><span>Active payment holds</span><strong>{counts.held}</strong></div>
          {data.canViewPayments && <Link href="/payments?view=outstanding"><span>Today’s bookings with a balance</span><strong>{counts.outstanding}</strong><ArrowRight size={14} aria-hidden /></Link>}</div>
        <nav aria-label="Front-desk shortcuts" className="dashboard-operation-shortcuts"><Link href="/calendar"><CalendarDays size={17} aria-hidden /> Open calendar <ArrowRight size={14} aria-hidden /></Link>
          <Link href="/available-now"><CircleDot size={17} aria-hidden /> Find an available space <ArrowRight size={14} aria-hidden /></Link>
          {data.canCreate && <Link href="/bookings/new?mode=walk-in"><Ticket size={17} aria-hidden /> Add a walk-in <ArrowRight size={14} aria-hidden /></Link>}</nav>
      </aside>
    </div>
  </section>;
}
