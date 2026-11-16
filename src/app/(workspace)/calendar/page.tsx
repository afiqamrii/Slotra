import type { Metadata } from "next";
import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Shield } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { availableSlotsForResources } from "@/lib/booking-availability";
import { staffCalendar } from "@/lib/booking-management";
import { bookingDate, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { calendarDatedHref } from "@/lib/booking-calendar-links";
import { calendarHref, calendarStatus, calendarTimeRange, hourlyStartSlots, normalizeCalendarQuery, overlapsDay, timelinePercent, timelineRange, timelineTicks } from "@/lib/calendar-presentation";
import { localDateAt } from "@/lib/booking-time";
import { branchContext } from "@/lib/branch-context";
import { authorizedMembership } from "@/lib/organization-service";
import { StatusBadge } from "@/components/ui";
import "./calendar.css";

export const metadata: Metadata = { title: "Calendar" };
type Params = Record<string, string | string[] | undefined>;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session } = await requirePermission("booking:view");
  const params = normalizeCalendarQuery(await searchParams);
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const data = await staffCalendar(getDb(), session.user.id, organization.organizationId, {
    branchId: params.branchId ?? (selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined),
    date: params.date, view: params.view === "week" ? "week" : "day",
  });
  const timezone = data.branch?.timezone ?? "Asia/Kuala_Lumpur";
  const today = localDateAt(new Date(), timezone);
  const day = Temporal.PlainDate.from(data.date ?? today.toString());
  const view = params.view;
  const branchSpaces = data.spaces.filter(item => item.branchId === data.branch?.id);
  const spacesById = new Map(branchSpaces.map(space => [space.id, space]));
  const activeIds = branchSpaces.filter(item => item.status === "ACTIVE").map(item => item.id);
  const [createAccess, blockAccess] = await Promise.all([
    authorizedMembership(getDb(), session.user.id, organization.organizationId, "booking:create", data.branch?.id),
    authorizedMembership(getDb(), session.user.id, organization.organizationId, "resource:manage", data.branch?.id),
  ]);
  const canCreate = !!data.branch && data.branch.isActive && !!createAccess;
  const canBlock = !!data.branch && !!blockAccess;
  const slots: Record<string, { startAt: Date; endAt: Date }[]> = {};
  if (canCreate && data.branch && view === "day") {
    for (let offset = 0; offset < activeIds.length; offset += 100) {
      Object.assign(slots, await availableSlotsForResources(getDb(), session.user.id, organization.organizationId,
        { branchId: data.branch.id, resourceIds: activeIds.slice(offset, offset + 100), localDate: day.toString() }));
    }
  }
  const href = (date: string, nextView = view) => calendarHref(date, nextView, data.branch?.id);
  const prev = day.subtract({ days: view === "week" ? 7 : 1 }).toString();
  const next = day.add({ days: view === "week" ? 7 : 1 }).toString();
  const monday = day.subtract({ days: day.dayOfWeek - 1 });
  const ticks = timelineTicks(data.from, data.to, timezone);
  const entries = [
    ...data.rows.map(row => ({ kind: "booking" as const, id: row.id, resourceId: row.resourceId, startAt: row.startAt,
      endAt: row.endAt, title: row.customerName ?? "Guest / walk-in", detail: row.reference, status: row.status })),
    ...data.blocks.map(block => ({ kind: "block" as const, id: block.id, resourceId: block.resourceId, startAt: block.startAt,
      endAt: block.endAt, title: bookingStatusLabel(block.type), detail: block.reason ?? "Space unavailable", status: "BLOCKED" })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
  const dayLabel = (value: Temporal.PlainDate) => value.toLocaleString("en-MY", { weekday: "short", day: "numeric", month: "short" });
  const timeRange = (start: Date, end: Date) => calendarTimeRange(start, end, timezone);

  return <div className="booking-ops-page calendar-page">
    <header className="booking-page-head"><div><p className="eyebrow">OPERATIONS</p><h1>Calendar</h1><p>Your schedule, bookings and blocked time in one place.</p></div>
      <div className="booking-head-actions"><Link className="button button-secondary" href={"/available-now" + (data.branch ? "?branchId=" + data.branch.id : "")}>Available Now</Link>
        {canBlock && <Link className="button button-secondary" href={calendarDatedHref("/calendar/block", day, data.branch?.id)}><Shield size={16} aria-hidden /> Block space</Link>}
        {canCreate && <Link className="button button-primary" href={calendarDatedHref("/bookings/new", day, data.branch?.id)}><Plus size={17} aria-hidden /> New booking</Link>}</div>
    </header>
    <section className="calendar-board" aria-label="Venue schedule">
      <div className="calendar-controls">
        <nav className="booking-tabs" aria-label="Calendar view">{([["day", "Timeline"], ["week", "Week"], ["agenda", "Agenda"]] as const).map(([value, label]) =>
          <Link key={value} className={view === value ? "booking-tab active" : "booking-tab"} aria-current={view === value ? "page" : undefined} href={href(day.toString(), value)}>{value === "agenda" ? <List size={15} aria-hidden /> : <CalendarDays size={15} aria-hidden />}{label}</Link>)}</nav>
        <div className="calendar-date-navigation"><Link className="calendar-arrow" aria-label={view === "week" ? "Previous week" : "Previous day"} href={href(prev)}><ChevronLeft size={18} aria-hidden /></Link>
          <strong>{view === "week" ? `${dayLabel(monday)} – ${dayLabel(monday.add({ days: 6 }))}` : dayLabel(day)}</strong>
          <Link className="calendar-arrow" aria-label={view === "week" ? "Next week" : "Next day"} href={href(next)}><ChevronRight size={18} aria-hidden /></Link>
          <Link className="button button-secondary" href={href(today.toString())}>Today</Link></div>
        <form action="/calendar" method="get" className="calendar-jump"><input name="view" type="hidden" value={view} />
          <label className="sr-only" htmlFor="calendar-date">Jump to date</label><input id="calendar-date" type="date" name="date" defaultValue={day.toString()} required />
          {data.branches.length > 1 ? <><label className="sr-only" htmlFor="calendar-branch">Branch</label><select id="calendar-branch" name="branchId" defaultValue={data.branch?.id}>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}{branch.isActive ? "" : " (inactive)"}</option>)}</select></> : <input name="branchId" type="hidden" value={data.branch?.id ?? ""} />}
          <button className="button button-secondary" type="submit">Go</button></form>
      </div>
      <div className="calendar-context"><span><strong>{data.branch?.name ?? "No branch"}</strong> · {timezone}</span><span>{data.rows.length} bookings · {data.blocks.length} blocks · {branchSpaces.length} spaces</span></div>
      {data.branch && !data.branch.isActive && <p className="calendar-notice">This branch is inactive. You can review its schedule, but it cannot accept new bookings.</p>}
      {(data.hasMoreBookings || data.hasMoreBlocks) && <p className="calendar-notice" role="status">This schedule shows the first 500 bookings and 500 blocks. {view === "week" ? "Open a single day for a more complete view." : "Use the booking list to find reservations beyond this limit."} <Link href={"/bookings?" + new URLSearchParams({ branchId: data.branch?.id ?? "", date: day.toString(), view: "all" })}>Open bookings</Link></p>}
      <div className="calendar-legend" aria-label="Schedule legend"><span><i className="booked" /> Confirmed</span><span><i className="active" /> Checked in / in progress</span><span><i className="held" /> Awaiting payment</span><span><i className="muted" /> Pending / completed / no-show</span><span><i className="blocked" /> Blocked</span></div>
      {!data.branch || !branchSpaces.length ? <div className="booking-empty"><CalendarDays size={30} aria-hidden /><h2>No spaces to display</h2><p>Add a branch and courts or spaces to see the calendar.</p></div> : view === "week" ?
        <div className="calendar-week-grid">{Array.from({ length: 7 }, (_, index) => monday.add({ days: index })).map(date => {
          const daily = entries.filter(entry => overlapsDay(entry.startAt, entry.endAt, date, timezone));
          return <section className={date.equals(today) ? "calendar-week-day is-today" : "calendar-week-day"} key={date.toString()}>
            <Link className="calendar-week-heading" href={href(date.toString(), "agenda")}><strong>{dayLabel(date)}</strong>{date.equals(today) && <span>Today</span>}</Link>
            <small>{daily.filter(entry => entry.kind === "booking").length} bookings · {daily.filter(entry => entry.kind === "block").length} blocks</small>
            {!daily.length && <p className="calendar-quiet">No bookings or blocks</p>}
            {daily.slice(0, 6).map(entry => {
              const content = <><span>{localDateAt(entry.startAt, timezone).toString() < date.toString() ? "Continues from previous day" : bookingTime(entry.startAt, timezone)}</span><strong>{entry.title}</strong><small>{spacesById.get(entry.resourceId)?.name}</small><small>{entry.kind === "block" ? "Blocked" : bookingStatusLabel(entry.status)}</small>{entry.kind === "block" && <small>{entry.detail}</small>}</>;
              return entry.kind === "booking" ? <Link key={entry.id} href={"/bookings/" + entry.id} className={"calendar-week-entry " + calendarStatus(entry.status)}>{content}</Link> : <div key={entry.id} className="calendar-week-entry blocked">{content}</div>;
            })}
            {daily.length > 6 && <Link className="text-link" href={href(date.toString(), "agenda")}>View all {daily.length} entries</Link>}
          </section>;
        })}</div> : view === "agenda" ? <div className="calendar-agenda">
          {!entries.length ? <div className="booking-empty"><CalendarDays size={30} aria-hidden /><h2>A clear schedule</h2><p>No bookings or blocks for {dayLabel(day)}.</p>{canCreate && <Link className="button button-primary" href={calendarDatedHref("/bookings/new", day, data.branch.id)}>Create booking</Link>}</div> : entries.map(entry =>
            <article className={"calendar-agenda-entry " + (entry.kind === "block" ? "blocked" : calendarStatus(entry.status))} key={entry.id}>
              <div className="calendar-agenda-time"><strong>{timeRange(entry.startAt, entry.endAt)}</strong>{entry.startAt < data.from && <small>Started {bookingDate(entry.startAt, timezone)}</small>}{entry.endAt > data.to && <small>Ends {bookingDate(entry.endAt, timezone)}</small>}</div>
              <div className="calendar-agenda-details">{entry.kind === "booking" ? <Link href={"/bookings/" + entry.id}>{entry.title}</Link> : <strong>{entry.title}</strong>}<span>{spacesById.get(entry.resourceId)?.name} · {spacesById.get(entry.resourceId)?.sportName}</span><small>{entry.detail}</small></div>
              <StatusBadge label={entry.kind === "block" ? "Blocked" : bookingStatusLabel(entry.status)} tone={entry.kind === "block" || entry.status === "AWAITING_PAYMENT" ? "warning" : "neutral"} />
              {entry.kind === "booking" && <Link className="calendar-detail-link" href={"/bookings/" + entry.id} aria-label={`View booking ${entry.detail}`}>Details <ChevronRight size={15} aria-hidden /></Link>}
            </article>)}
        </div> : <>
          <div className="calendar-timeline-help"><p>{canCreate ? "Scroll to explore the day. + shows one available start per hour for the space’s minimum session. New booking shows all times." : "Scroll to explore the day. Select a reservation to view its details."}</p><Link href={href(day.toString(), "agenda")} className="text-link">Prefer a list? Open agenda</Link></div>
          <div className="booking-timeline-scroll"><div className="booking-timeline"><div className="booking-timeline-header"><div className="booking-timeline-label">Court / space</div><div className="booking-timeline-track">{ticks.map(tick => <span className="booking-hour" key={tick.iso} style={{ left: tick.position + "%" }}>{tick.label}</span>)}</div></div>
            {branchSpaces.map(space => {
              const hourlySlots = hourlyStartSlots(slots[space.id] ?? [], data.from);
              return <div className="booking-timeline-row" key={space.id}><div className="booking-timeline-label"><strong>{space.name}</strong><small>{space.sportName}{space.status !== "ACTIVE" ? ` · ${bookingStatusLabel(space.status)}` : ""}</small></div><div className="booking-timeline-track">
                {ticks.map(tick => <i aria-hidden key={tick.iso} className="calendar-hour-line" style={{ left: tick.position + "%" }} />)}
                {data.blocks.filter(row => row.resourceId === space.id).map(block => <span key={block.id} className="booking-timeline-block" style={timelineRange(block.startAt, block.endAt, data.from, data.to)} title={`${bookingStatusLabel(block.type)} · ${timeRange(block.startAt, block.endAt)} · ${block.reason ?? "Blocked"}`}>{bookingStatusLabel(block.type)}</span>)}
                {data.rows.filter(row => row.resourceId === space.id).map(row => <Link key={row.id} className={"booking-timeline-event calendar-event-" + calendarStatus(row.status)} style={timelineRange(row.startAt, row.endAt, data.from, data.to)} href={"/bookings/" + row.id} title={`${row.reference} · ${row.customerName ?? "Guest"} · ${timeRange(row.startAt, row.endAt)} · ${bookingStatusLabel(row.status)}`}><strong>{row.customerName ?? "Guest"}</strong><small>{bookingTime(row.startAt, timezone)}</small></Link>)}
                {canCreate && hourlySlots.map(slot => <Link key={slot.startAt.toISOString()} className="booking-timeline-open" style={{ left: timelinePercent(slot.startAt, data.from, data.to) + "%" }} href={"/bookings/new?" + new URLSearchParams({ branchId: data.branch!.id, resourceId: space.id, date: day.toString(), startAt: slot.startAt.toISOString() })} title={`Available ${bookingTime(slot.startAt, timezone)} · ${space.minimumDurationMinutes} minutes`} aria-label={`Create booking for ${space.name} at ${bookingTime(slot.startAt, timezone)}`}>+</Link>)}
              </div></div>;
            })}</div></div>
        </>}
    </section>
  </div>;
}
