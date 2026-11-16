import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Mail, Phone, UsersRound, ArrowUpRight, ChevronLeft, ChevronRight, FilePenLine } from "lucide-react";
import { getDb } from "@/db/client";
import { requireOrganizationWidePermission } from "@/lib/authorization";
import { customerHistoryFilters, getCustomerProfile } from "@/lib/customer-service";
import { BookingError } from "@/lib/booking-availability";
import { bookingDate, bookingMoney, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { StatusBadge } from "@/components/ui";
import { CustomerEditForm } from "@/components/customer-edit-form";
import "../customers.css";

export const metadata: Metadata = { title: "Customer profile" };
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization, session } = await requireOrganizationWidePermission("customer:view");
  const { id } = await params;
  const data = await getCustomerProfile(getDb(), session.user.id, organization.organizationId, id, customerHistoryFilters(await searchParams))
    .catch(error => { if (error instanceof BookingError && error.code === "CUSTOMER_NOT_FOUND") notFound(); throw error; });
  const { customer, access } = data;
  const href = (view: string, page = 1) => `/customers/${id}?${new URLSearchParams({ view, page: String(page) })}`;
  return <div className="customer-page"><Link className="customer-back" href="/customers"><ArrowLeft size={16} aria-hidden /> All customers</Link>
    <header className="customer-profile-header"><div className="customer-profile-identity"><span className="customer-profile-avatar" aria-hidden>{customer.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><p className="eyebrow">CUSTOMER PROFILE</p><h1>{customer.name}</h1><p>Customer since {bookingDate(customer.createdAt, "UTC")}</p></div></div>
      {access.canBook && <Link className="button button-primary" href={`/bookings/new?customerId=${customer.id}`}><CalendarDays size={16} aria-hidden /> New booking</Link>}</header>
    {data.activity && <section className="customer-stat-grid" aria-label="Customer booking activity">{[["Total bookings", data.activity.total], ["Completed visits", data.activity.completed], ["Upcoming", data.activity.upcoming], ["Cancelled / expired", data.activity.cancelled]].map(([label, value]) => <div key={label} className="customer-stat"><span>{label}</span><strong>{value}</strong></div>)}</section>}
    <div className="customer-profile-layout"><aside className="customer-profile-sidebar"><section className="customer-panel"><h2>Contact details</h2><div className="customer-contact-line"><Phone size={16} aria-hidden /><div><span>Phone</span><a href={`tel:${customer.phone.replace(/[^+\d]/g, "")}`}>{customer.phone}</a></div></div><div className="customer-contact-line"><Mail size={16} aria-hidden /><div><span>Email</span>{customer.email ? <a href={`mailto:${encodeURIComponent(customer.email)}`}>{customer.email}</a> : <p>No email added</p>}</div></div><p className="customer-muted">Contact links open your device’s phone or email app.</p></section>
      {!!data.money.length && <section className="customer-panel"><h2>Booking value & payments</h2>{data.money.map(value => <div className="customer-money" key={value.currency}><h3>{value.currency}</h3><dl><div><dt>Booked value</dt><dd>{bookingMoney(value.booked, value.currency)}</dd></div><div><dt>Net collected</dt><dd>{bookingMoney(value.collected, value.currency)}</dd></div><div className="customer-outstanding"><dt>Outstanding</dt><dd>{bookingMoney(value.outstanding, value.currency)}</dd></div></dl></div>)}<p className="customer-muted">Booked value and outstanding exclude pending, payment-hold, cancelled and expired bookings. Net collected includes retained payments after refunds across all bookings.</p></section>}
      <section className="customer-panel"><h2>Internal notes</h2><p className="customer-notes">{customer.notes || "No notes added."}</p></section>
    </aside><div className="customer-profile-main">
      {access.canViewBookings && <section className="customer-panel customer-history"><div className="customer-panel-title"><div><h2>Booking history</h2><p>{data.total} {data.total === 1 ? "booking" : "bookings"}{data.filters.view !== "all" ? " in this view" : " across all branches"}</p></div><CalendarDays size={20} aria-hidden /></div>
        <nav className="customer-tabs" aria-label="Booking history views">{([ ["all", "All bookings"], ["upcoming", "Upcoming"], ["past", "Past"], ["cancelled", "Cancelled"] ] as const).map(([view, label]) => <Link key={view} href={href(view)} aria-current={data.filters.view === view ? "page" : undefined}>{label}</Link>)}</nav>
        {data.history.length ? <div className="customer-history-list">{data.history.map(booking => <Link key={booking.id} className="customer-history-row" href={`/bookings/${booking.id}`}><div className="customer-history-date"><strong>{bookingDate(booking.startAt, booking.timezone)}</strong><span>{bookingTime(booking.startAt, booking.timezone)} – {bookingTime(booking.endAt, booking.timezone)}</span><small>{booking.timezone}</small></div><div className="customer-history-space"><strong>{booking.resourceName}</strong><span>{booking.branchName}</span><small>{booking.reference} · {bookingStatusLabel(booking.source)}</small></div><div className="customer-history-status"><StatusBadge label={bookingStatusLabel(booking.status)} tone={booking.status === "CANCELLED" || booking.status === "EXPIRED" || booking.status === "NO_SHOW" ? "warning" : "neutral"} />{booking.totalAmount !== undefined && booking.currency && <strong>{bookingMoney(booking.totalAmount, booking.currency)}</strong>}</div><ArrowUpRight size={16} aria-hidden /></Link>)}</div>
          : <div className="customer-empty customer-empty-compact"><CalendarDays size={28} aria-hidden /><h3>No bookings in this view</h3><p>{data.filters.view === "all" ? "A new booking will start this customer's history." : "Choose another view to see more of their booking history."}</p>{data.filters.view !== "all" && <Link href={href("all")} className="text-link">Show all bookings</Link>}</div>}
        <nav className="customer-pagination" aria-label="Booking history pages"><span>Page {data.filters.page} of {data.pageCount}</span><div>{data.filters.page > 1 && <Link className="button button-secondary" href={href(data.filters.view, data.filters.page - 1)}><ChevronLeft size={15} aria-hidden /> Previous</Link>}{data.filters.page < data.pageCount && <Link className="button button-secondary" href={href(data.filters.view, data.filters.page + 1)}>Next <ChevronRight size={15} aria-hidden /></Link>}</div></nav>
      </section>}
      {!access.canViewBookings && <section className="customer-panel customer-empty"><UsersRound size={28} aria-hidden /><h2>Contact profile</h2><p>Your role can view customer details. Booking history requires booking access.</p></section>}
      {access.canManage && <section className="customer-panel"><details className="customer-edit-details"><summary><span><FilePenLine size={18} aria-hidden /> Edit contact details & notes</span><span className="customer-edit-cue">Edit</span></summary><CustomerEditForm key={customer.id} customer={{ id: customer.id, name: customer.name, phone: customer.phone,
        email: customer.email, notes: customer.notes, updatedAt: customer.updatedAt.toISOString() }} /></details></section>}
    </div></div>
  </div>;
}
