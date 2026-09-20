import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus, Search } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { listStaffBookings } from "@/lib/booking-management";
import { bookingDate, bookingMoney, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { hasPermission } from "@/lib/permissions";
import { StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Bookings" };
type Params = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) => typeof value === "string" && value !== "" ? value : undefined;

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session, member } = await requirePermission("booking:view");
  const params = await searchParams;
  const input = {
    view: text(params.q) && !text(params.date) ? "all" : text(params.view), date: text(params.date), branchId: text(params.branchId),
    resourceId: text(params.resourceId), sportTypeId: text(params.sportTypeId),
    status: text(params.status), source: text(params.source), q: text(params.q), page: text(params.page),
  };
  const data = await listStaffBookings(getDb(), session.user.id, organization.organizationId, input);
  const canCreate = hasPermission(member.role, "booking:create");
  const resourceOptions = data.spaces.filter(space => space.branchId === data.branch?.id);
  const sports = [...new Map(resourceOptions.map(space => [space.sportTypeId, { id: space.sportTypeId, name: space.sportName }])).values()];
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") query.set(key, value);
    query.set("page", String(page));
    return "/bookings?" + query.toString();
  };
  return <div className="booking-ops-page">
    <header className="booking-page-head"><div><p className="eyebrow">OPERATIONS</p><h1>Bookings</h1><p>View, search, and manage your venue bookings.</p></div>
      {canCreate && <div className="booking-head-actions"><Link className="button button-secondary" href="/available-now">Available Now</Link><Link className="button button-secondary" href="/bookings/new?mode=walk-in">New Walk-In</Link><Link className="button button-primary booking-page-create" href="/bookings/new"><Plus size={17} aria-hidden /> New Booking</Link></div>}
    </header>
    <section className="booking-board" aria-label="Booking management">
    <nav aria-label="Booking views" className="booking-tabs">
      {([ ["today", "Today"], ["upcoming", "Upcoming"], ["past", "Past"], ["cancelled", "Cancelled"], ["all", "All"] ] as const).map(([value, label]) =>
        <Link key={value} className={data.filters.view === value ? "booking-tab active" : "booking-tab"} href={"/bookings?view=" + value}>{label}</Link>)}
    </nav>
    <form className="booking-filters" action="/bookings" method="get">
      <input type="hidden" name="view" value={data.filters.view} />
      <div className="booking-filter-primary"><label className="booking-search"><Search size={17} aria-hidden /><span className="sr-only">Search bookings or customers</span><input name="q" type="search" placeholder="Search reference, customer or phone" defaultValue={data.filters.q ?? ""} /></label>
      <label className="venue-field"><span>Date</span><input type="date" name="date" defaultValue={data.filters.date ?? ""} /></label>
      {data.branches.length > 1 && <label className="venue-field"><span>Branch</span><select name="branchId" defaultValue={data.branch?.id}>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      <button className="button button-primary" type="submit">Apply</button><Link className="text-link" href="/bookings">Clear</Link></div>
      <details className="booking-more-filters" open={Boolean(data.filters.resourceId || data.filters.sportTypeId || data.filters.status || data.filters.source)}><summary>More filters</summary><div className="booking-filter-extra">
      <label className="venue-field"><span>Space</span><select name="resourceId" defaultValue={data.filters.resourceId ?? ""}><option value="">All spaces</option>{resourceOptions.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="venue-field"><span>Sport</span><select name="sportTypeId" defaultValue={data.filters.sportTypeId ?? ""}><option value="">All sports</option>{sports.map(sport => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
      <label className="venue-field"><span>Status</span><select name="status" defaultValue={data.filters.status ?? ""}><option value="">All statuses</option>{["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED", "PENDING", "AWAITING_PAYMENT", "EXPIRED"].map(status => <option key={status} value={status}>{bookingStatusLabel(status)}</option>)}</select></label>
      <label className="venue-field"><span>Source</span><select name="source" defaultValue={data.filters.source ?? ""}><option value="">All sources</option>{["STAFF", "WALK_IN", "ONLINE", "IMPORT", "API"].map(source => <option key={source} value={source}>{bookingStatusLabel(source)}</option>)}</select></label>
      <button className="button button-secondary" type="submit">Apply filters</button></div></details>
    </form>
    <div className="booking-list-context"><strong>{bookingStatusLabel(data.filters.view)} · {data.rows.length} {data.rows.length === 1 ? "booking" : "bookings"}{data.filters.page > 1 ? " on this page" : ""}</strong><span>{data.branch ? data.branch.name + " · " + data.branch.timezone : "Set up a branch to begin"}</span></div>
    {!data.branch ? <div className="booking-empty"><ClipboardList size={30} aria-hidden /><h2>Set up a branch first</h2><p>Your bookings will appear after venue setup.</p><Link href="/onboarding" className="button button-primary">Set up venue</Link></div> : data.rows.length ? <>
      <div className="booking-list-desktop"><table className="booking-table"><thead><tr><th>Booking</th><th>Customer</th><th>Space</th><th>Date & time</th><th>Status</th><th>Source</th><th>Amount</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td><Link className="booking-ref" href={"/bookings/" + row.id}>{row.reference}</Link></td><td>{row.customerName ?? "Guest / walk-in"}{row.customerPhone && <small>{row.customerPhone}</small>}</td><td>{row.resourceName}<small>{row.sportName}</small></td><td>{bookingDate(row.startAt, data.branch!.timezone)}<small>{bookingTime(row.startAt, data.branch!.timezone)} – {bookingTime(row.endAt, data.branch!.timezone)}</small></td><td><StatusBadge label={bookingStatusLabel(row.status)} tone={row.status === "CONFIRMED" || row.status === "CHECKED_IN" ? "success" : row.status === "CANCELLED" || row.status === "NO_SHOW" ? "warning" : "neutral"} /></td><td>{bookingStatusLabel(row.source)}</td><td>{bookingMoney(row.totalAmount, row.currency)}</td></tr>)}</tbody></table></div>
      <div className="booking-list-mobile">{data.rows.map(row => <Link key={row.id} href={"/bookings/" + row.id} className="booking-card"><span className="booking-card-top"><strong>{row.customerName ?? "Guest / walk-in"}</strong><span>{bookingMoney(row.totalAmount, row.currency)}</span></span><span className="booking-card-meta">{row.reference} · {row.resourceName}</span><span className="booking-card-meta">{bookingDate(row.startAt, data.branch!.timezone)} · {bookingTime(row.startAt, data.branch!.timezone)} – {bookingTime(row.endAt, data.branch!.timezone)}</span><StatusBadge label={bookingStatusLabel(row.status)} /></Link>)}</div>
      <div className="booking-pagination">{data.filters.page > 1 && <Link className="button button-secondary" href={pageHref(data.filters.page - 1)}>Previous</Link>}<span>Page {data.filters.page}</span>{data.hasMore && <Link className="button button-secondary" href={pageHref(data.filters.page + 1)}>Next</Link>}</div>
    </> : <div className="booking-empty"><ClipboardList size={30} aria-hidden /><h2>{data.filters.view === "today" && !data.filters.q ? "No bookings today" : "No bookings match these filters"}</h2><p>{data.filters.view === "today" && !data.filters.q ? "Online and walk-in bookings will appear here." : "Try another date, space or search term."}</p>{canCreate && <Link href="/bookings/new" className="button button-primary">Create Booking</Link>}</div>}
    </section>
  </div>;
}
