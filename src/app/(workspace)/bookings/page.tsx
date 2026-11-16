import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus, Search, X, CalendarDays } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { listStaffBookings, normalizeBookingListInput } from "@/lib/booking-management";
import { bookingDate, bookingMoney, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { bookingListHref, bookingViewHref } from "@/lib/booking-list-navigation";
import { BookingFilterForm } from "@/components/booking-filter-form";
import { StatusBadge } from "@/components/ui";
import { branchContext } from "@/lib/branch-context";

export const metadata: Metadata = { title: "Bookings" };
type Params = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) => typeof value === "string" && value !== "" ? value : undefined;

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session, member } = await requirePermission("booking:view");
  const params = await searchParams;
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const input = normalizeBookingListInput({
    view: text(params.view) ?? (text(params.q) && !text(params.date) ? "all" : undefined), date: text(params.date),
    branchId: text(params.branchId) ?? (selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined),
    resourceId: text(params.resourceId), sportTypeId: text(params.sportTypeId),
    status: text(params.status), source: text(params.source), q: text(params.q), page: text(params.page),
  });
  const data = await listStaffBookings(getDb(), session.user.id, organization.organizationId, input);
  const canCreate = member.effectivePermissions.includes("booking:create");
  const resourceOptions = data.spaces.filter(space => space.branchId === data.branch?.id);
  const sports = [...new Map(resourceOptions.map(space => [space.sportTypeId, { id: space.sportTypeId, name: space.sportName }])).values()];
  const currentFilters = { ...data.filters, branchId: data.branch?.id };
  const pageHref = (page: number) => bookingListHref(currentFilters, { page });
  const branchQuery = data.branch ? `branchId=${data.branch.id}` : "";
  const newBookingHref = `/bookings/new${branchQuery ? `?${branchQuery}` : ""}`;
  const clearHref = bookingListHref({ view: data.filters.view, branchId: data.branch?.id });
  const activeFilters = [
    { key: "q", label: data.filters.q ? `Search: ${data.filters.q}` : undefined },
    { key: "date", label: data.filters.date },
    { key: "resourceId", label: resourceOptions.find(item => item.id === data.filters.resourceId)?.name },
    { key: "sportTypeId", label: sports.find(item => item.id === data.filters.sportTypeId)?.name },
    { key: "status", label: data.filters.status ? bookingStatusLabel(data.filters.status) : undefined },
    { key: "source", label: data.filters.source ? bookingStatusLabel(data.filters.source) : undefined },
  ].filter(item => item.label);
  const statusTone = (status: string) => status === "CONFIRMED" || status === "CHECKED_IN" || status === "COMPLETED" ? "success" as const
    : status === "CANCELLED" || status === "NO_SHOW" || status === "AWAITING_PAYMENT" ? "warning" as const : "neutral" as const;
  const paymentLabel = (row: typeof data.rows[number]) => {
    if (row.status === "CANCELLED" || row.status === "EXPIRED") return null;
    const balance = Math.max(0, row.totalAmount - row.amountPaid);
    return balance > 0 ? `${bookingMoney(balance, row.currency)} unpaid` : row.totalAmount > 0 ? "Paid in full" : "No payment due";
  };
  return <div className="booking-ops-page booking-index-page">
    <header className="booking-page-head"><div><p className="eyebrow">OPERATIONS</p><h1>Bookings</h1><p>View, search, and manage your venue bookings.</p></div>
      <div className="booking-head-actions"><Link className="button button-secondary" href={"/calendar" + (data.branch ? "?branchId=" + data.branch.id : "")}><CalendarDays size={16} aria-hidden /> Calendar</Link>{canCreate && <><Link className="button button-secondary" href={`/available-now${branchQuery ? `?${branchQuery}` : ""}`}>Available Now</Link><Link className="button button-secondary" href={`/bookings/new?mode=walk-in${branchQuery ? `&${branchQuery}` : ""}`}>New Walk-In</Link><Link className="button button-primary booking-page-create" href={newBookingHref}><Plus size={17} aria-hidden /> New Booking</Link></>}</div>
    </header>
    <section className="booking-board" aria-label="Booking management">
    <nav aria-label="Booking views" className="booking-tabs">
      {([ ["today", "Today"], ["upcoming", "Upcoming"], ["past", "Past"], ["cancelled", "Cancelled"], ["all", "All"] ] as const).map(([value, label]) =>
        <Link key={value} className={data.filters.view === value ? "booking-tab active" : "booking-tab"} aria-current={data.filters.view === value ? "page" : undefined} href={bookingViewHref(currentFilters, value)}>{label}</Link>)}
    </nav>
    <BookingFilterForm key={JSON.stringify(data.filters)} initialSearch={data.filters.q}>
      <input type="hidden" name="view" value={data.filters.view} />
      <div className="booking-filter-primary"><label className="booking-search"><Search size={17} aria-hidden /><span className="sr-only">Search bookings or customers</span><input name="q" type="search" maxLength={100} placeholder="Search reference, customer or phone" defaultValue={data.filters.q ?? ""} /></label>
      <label className="venue-field"><span>Date</span><input type="date" name="date" defaultValue={data.filters.date ?? ""} /></label>
      {data.branches.length > 1 && <label className="venue-field"><span>Branch</span><select name="branchId" defaultValue={data.branch?.id}>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      <button className="button button-primary" type="submit">Apply</button><Link className="text-link" href={clearHref}>Clear</Link></div>
      <details className="booking-more-filters" open={Boolean(data.filters.resourceId || data.filters.sportTypeId || data.filters.status || data.filters.source)}><summary>More filters</summary><div className="booking-filter-extra">
      <label className="venue-field"><span>Space</span><select name="resourceId" defaultValue={data.filters.resourceId ?? ""}><option value="">All spaces</option>{resourceOptions.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
      <label className="venue-field"><span>Sport</span><select name="sportTypeId" defaultValue={data.filters.sportTypeId ?? ""}><option value="">All sports</option>{sports.map(sport => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
      <label className="venue-field"><span>Status</span><select name="status" defaultValue={data.filters.status ?? ""}><option value="">All statuses</option>{["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED", "PENDING", "AWAITING_PAYMENT", "EXPIRED"].map(status => <option key={status} value={status}>{bookingStatusLabel(status)}</option>)}</select></label>
      <label className="venue-field"><span>Source</span><select name="source" defaultValue={data.filters.source ?? ""}><option value="">All sources</option>{["STAFF", "WALK_IN", "ONLINE", "IMPORT", "API"].map(source => <option key={source} value={source}>{bookingStatusLabel(source)}</option>)}</select></label>
      <button className="button button-secondary" type="submit">Apply filters</button></div></details>
    </BookingFilterForm>
    {activeFilters.length > 0 && <div className="booking-active-filters" aria-label="Active filters">{activeFilters.map(filter => <Link key={filter.key} className="booking-filter-tag" href={bookingListHref(currentFilters, { [filter.key]: undefined, page: undefined })} aria-label={`Remove filter: ${filter.label}`}>{filter.label}<X size={13} aria-hidden /></Link>)}<Link href={clearHref} className="text-link">Clear filters</Link></div>}
    <div className="booking-list-context"><strong>{data.filters.date ?? bookingStatusLabel(data.filters.view)} · {data.rows.length} {data.rows.length === 1 ? "booking" : "bookings"}{data.filters.page > 1 || data.hasMore ? " on this page" : ""}</strong><span>{data.branch ? data.branch.name + " · " + data.branch.timezone : "Set up a branch to begin"}</span></div>
    {!data.branch ? <div className="booking-empty"><ClipboardList size={30} aria-hidden /><h2>Set up a branch first</h2><p>Your bookings will appear after venue setup.</p><Link href="/onboarding" className="button button-primary">Set up venue</Link></div> : data.rows.length ? <>
      <div className="booking-list-desktop"><table className="booking-table"><caption className="sr-only">Bookings for {data.branch.name}</caption><thead><tr><th scope="col">Booking</th><th scope="col">Customer</th><th scope="col">Space</th><th scope="col">Date & time</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Amount</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td><Link className="booking-ref" href={"/bookings/" + row.id}>{row.reference}</Link></td><td>{row.customerName ?? "Guest / walk-in"}{row.customerPhone && <small>{row.customerPhone}</small>}</td><td>{row.resourceName}<small>{row.sportName}</small></td><td>{bookingDate(row.startAt, data.branch!.timezone)}<small>{bookingTime(row.startAt, data.branch!.timezone)} – {bookingTime(row.endAt, data.branch!.timezone)}</small></td><td><StatusBadge label={bookingStatusLabel(row.status)} tone={statusTone(row.status)} /></td><td>{bookingStatusLabel(row.source)}</td><td>{bookingMoney(row.totalAmount, row.currency)}{paymentLabel(row) && <small className={row.amountPaid < row.totalAmount ? "booking-payment-outstanding" : "booking-payment-settled"}>{paymentLabel(row)}</small>}</td></tr>)}</tbody></table></div>
      <div className="booking-list-mobile">{data.rows.map(row => <Link key={row.id} href={"/bookings/" + row.id} className="booking-card"><span className="booking-card-top"><strong>{row.customerName ?? "Guest / walk-in"}</strong><span>{bookingMoney(row.totalAmount, row.currency)}</span></span><span className="booking-card-meta">{row.reference} · {row.resourceName}</span><span className="booking-card-meta">{bookingDate(row.startAt, data.branch!.timezone)} · {bookingTime(row.startAt, data.branch!.timezone)} – {bookingTime(row.endAt, data.branch!.timezone)}</span><span className="booking-card-bottom"><StatusBadge label={bookingStatusLabel(row.status)} tone={statusTone(row.status)} />{paymentLabel(row) && <span className={row.amountPaid < row.totalAmount ? "booking-payment-outstanding" : "booking-payment-settled"}>{paymentLabel(row)}</span>}</span></Link>)}</div>
      <nav className="booking-pagination" aria-label="Booking pages">{data.filters.page > 1 && <Link className="button button-secondary" href={pageHref(data.filters.page - 1)}>Previous</Link>}<span>Page {data.filters.page}</span>{data.hasMore && <Link className="button button-secondary" href={pageHref(data.filters.page + 1)}>Next</Link>}</nav>
    </> : <div className="booking-empty"><ClipboardList size={30} aria-hidden /><h2>{data.filters.view === "today" && !activeFilters.length ? "No bookings today" : "No bookings match these filters"}</h2><p>{data.filters.view === "today" && !activeFilters.length ? "Online and walk-in bookings will appear here." : "Try another date, space or search term."}</p>{activeFilters.length > 0 ? <Link href={clearHref} className="button button-secondary">Clear filters</Link> : data.filters.page > 1 ? <Link href={pageHref(1)} className="button button-secondary">Back to first page</Link> : canCreate && <Link href={newBookingHref} className="button button-primary">Create Booking</Link>}</div>}
    </section>
  </div>;
}
