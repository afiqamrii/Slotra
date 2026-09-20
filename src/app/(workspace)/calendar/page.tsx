import type { Metadata } from "next";
import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { availableSlotsForResources } from "@/lib/booking-availability";
import { staffCalendar } from "@/lib/booking-management";
import { bookingDate, bookingTime } from "@/lib/booking-format";
import { calendarDatedHref } from "@/lib/booking-calendar-links";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Calendar" };
type Params = { date?: string; view?: string; branchId?: string };
function position(value: Date, day: Temporal.PlainDate, timezone: string) {
  const zoned = Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO(timezone);
  const offset = Temporal.PlainDate.compare(zoned.toPlainDate(), day);
  return Math.max(0, Math.min(1440, offset * 1440 + zoned.hour * 60 + zoned.minute));
}
function timelineStyle(start: Date, end: Date, day: Temporal.PlainDate, timezone: string) {
  const left = position(start, day, timezone);
  const right = position(end, day, timezone);
  return { left: left / 1440 * 100 + "%", width: Math.max(0.4, (right - left) / 1440 * 100) + "%" };
}
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session, member } = await requirePermission("booking:view");
  const params = await searchParams;
  const data = await staffCalendar(getDb(), session.user.id, organization.organizationId, {
    branchId: params.branchId || undefined, date: params.date || undefined, view: params.view || undefined,
  });
  const day = Temporal.PlainDate.from(data.date ?? Temporal.Now.plainDateISO());
  const branchSpaces = data.spaces.filter(item => item.branchId === data.branch?.id);
  const activeIds = branchSpaces.filter(item => item.status === "ACTIVE").map(item => item.id);
  const slots = data.branch && data.view === "day" && activeIds.length ? await availableSlotsForResources(getDb(), session.user.id,
    organization.organizationId, { branchId: data.branch.id, resourceIds: activeIds.slice(0, 100), localDate: day.toString() }) : {};
  const canCreate = hasPermission(member.role, "booking:create");
  const canBlock = hasPermission(member.role, "resource:manage");
  const prev = day.subtract({ days: data.view === "week" ? 7 : 1 }).toString();
  const next = day.add({ days: data.view === "week" ? 7 : 1 }).toString();
  const href = (date: string, view = data.view) => "/calendar?" + new URLSearchParams({ date, view, ...(data.branch ? { branchId: data.branch.id } : {}) });
  const monday = day.subtract({ days: day.dayOfWeek - 1 });
  return <div className="booking-ops-page"><header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / SCHEDULE</p><h1>Calendar</h1><p>Bookings and blocked time by space. Times use {data.branch?.timezone ?? "your branch timezone"}.</p></div><div className="booking-head-actions"><Link className="button button-secondary" href="/available-now">Available Now</Link>{canBlock && <Link className="button button-secondary" href={calendarDatedHref("/calendar/block", day)}>Block Space</Link>}{canCreate && <Link className="button button-primary" href={calendarDatedHref("/bookings/new", day)}>New Booking</Link>}</div></header>
    <div className="booking-calendar-toolbar"><div className="booking-tabs"><Link className={data.view === "day" ? "booking-tab active" : "booking-tab"} href={href(day.toString(), "day")}>Day</Link><Link className={data.view === "week" ? "booking-tab active" : "booking-tab"} href={href(day.toString(), "week")}>Week</Link></div><div className="booking-calendar-date"><Link aria-label="Previous" href={href(prev)}>←</Link><strong>{data.view === "day" ? bookingDate(new Date(data.from), data.branch?.timezone ?? "UTC", true) : `Week of ${monday.toString()}`}</strong><Link aria-label="Next" href={href(next)}>→</Link></div><form action="/calendar" method="get"><input name="view" type="hidden" value={data.view} /><input name="branchId" type="hidden" value={data.branch?.id ?? ""} /><label className="sr-only" htmlFor="calendar-date">Jump to date</label><input id="calendar-date" type="date" name="date" defaultValue={day.toString()} /><button className="button button-secondary" type="submit">Go</button></form></div>
    {data.branches.length > 1 && <nav className="booking-tabs" aria-label="Branch">{data.branches.map(item => <Link key={item.id} className={item.id === data.branch?.id ? "booking-tab active" : "booking-tab"} href={"/calendar?" + new URLSearchParams({ date: day.toString(), view: data.view, branchId: item.id })}>{item.name}</Link>)}</nav>}
    {!data.branch || !branchSpaces.length ? <div className="booking-empty"><h2>No spaces to display</h2><p>Add a branch and courts or spaces to see the calendar.</p></div> : data.view === "week" ? <div className="booking-week-grid">{Array.from({ length: 7 }, (_, index) => monday.add({ days: index })).map(date => {
      const rows = data.rows.filter(row => Temporal.Instant.from(row.startAt.toISOString()).toZonedDateTimeISO(data.branch!.timezone).toPlainDate().toString() === date.toString());
      const blocks = data.blocks.filter(row => Temporal.Instant.from(row.startAt.toISOString()).toZonedDateTimeISO(data.branch!.timezone).toPlainDate().toString() === date.toString());
      return <section className="foundation-card booking-week-day" key={date.toString()}><Link href={href(date.toString(), "day")}><strong>{date.toLocaleString("en-MY", { weekday: "short", day: "numeric", month: "short" })}</strong></Link><small>{rows.length} bookings · {blocks.length} blocks</small>{rows.slice(0, 8).map(row => <Link className="booking-week-item" href={"/bookings/" + row.id} key={row.id}><span>{bookingTime(row.startAt, data.branch!.timezone)}</span><strong>{row.customerName ?? "Guest"}</strong><small>{branchSpaces.find(space => space.id === row.resourceId)?.name}</small></Link>)}{rows.length > 8 && <Link href={href(date.toString(), "day")}>+{rows.length - 8} more</Link>}</section>;
    })}</div> : <><p className="booking-help">Scroll horizontally to see the full day. Select an available start time to create a booking; select a reservation for details.</p><div className="booking-timeline-scroll"><div className="booking-timeline"><div className="booking-timeline-header"><div className="booking-timeline-label">Resource</div><div className="booking-timeline-track">{Array.from({ length: 24 }, (_, hour) => <span className="booking-hour" key={hour} style={{ left: hour / 24 * 100 + "%" }}>{String(hour).padStart(2, "0")}:00</span>)}</div></div>{branchSpaces.map(space => <div className="booking-timeline-row" key={space.id}><div className="booking-timeline-label"><strong>{space.name}</strong><small>{space.sportName}</small></div><div className="booking-timeline-track">{data.blocks.filter(row => row.resourceId === space.id).map(block => <span key={block.id} className="booking-timeline-block" style={timelineStyle(block.startAt, block.endAt, day, data.branch!.timezone)} title={`${block.type}: ${block.reason ?? "Blocked"}`}>{block.type === "MAINTENANCE" ? "Maintenance" : "Blocked"}</span>)}{data.rows.filter(row => row.resourceId === space.id).map(row => <Link key={row.id} className="booking-timeline-event" style={timelineStyle(row.startAt, row.endAt, day, data.branch!.timezone)} href={"/bookings/" + row.id} title={`${row.reference} · ${row.customerName ?? "Guest"} · ${bookingTime(row.startAt, data.branch!.timezone)}`}><strong>{row.customerName ?? "Guest"}</strong><small>{bookingTime(row.startAt, data.branch!.timezone)}</small></Link>)}{canCreate && (slots[space.id] ?? []).filter(slot => position(slot.startAt, day, data.branch!.timezone) % 60 === 0).map(slot => <Link key={slot.startAt.toISOString()} className="booking-timeline-open" style={{ left: position(slot.startAt, day, data.branch!.timezone) / 1440 * 100 + "%" }} href={"/bookings/new?" + new URLSearchParams({ resourceId: space.id, date: day.toString(), startAt: slot.startAt.toISOString() })} title={`Available ${bookingTime(slot.startAt, data.branch!.timezone)} — create booking`} aria-label={`Create booking for ${space.name} at ${bookingTime(slot.startAt, data.branch!.timezone)}`}>+</Link>)}</div></div>)}</div></div></>}
  </div>;
}
