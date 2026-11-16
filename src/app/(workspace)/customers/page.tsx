import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Search, UsersRound, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { getDb } from "@/db/client";
import { requireOrganizationWidePermission } from "@/lib/authorization";
import { customerDirectoryHref, customerListFilters, listCustomers } from "@/lib/customer-service";
import "./customers.css";

export const metadata: Metadata = { title: "Customers" };
type Params = Record<string, string | string[] | undefined>;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session, member } = await requireOrganizationWidePermission("customer:view");
  const data = await listCustomers(getDb(), session.user.id, organization.organizationId, customerListFilters(await searchParams));
  const { filters } = data;
  const canExport = member.effectivePermissions.includes("report:view") && member.effectivePermissions.includes("report:export") && member.effectivePermissions.includes("report:view_financial");
  return <div className="customer-page">
    <header className="customer-page-header"><div><p className="eyebrow">YOUR COMMUNITY</p><h1>Customers</h1><p>Know your regulars. Keep every visit in view.</p></div>
      {canExport && <Link className="button button-secondary" href="/reports">Reports & exports <ArrowUpRight size={16} aria-hidden /></Link>}</header>
    <section className="customer-directory" aria-label="Customer directory">
      <div className="customer-directory-heading"><div className="customer-heading-icon"><UsersRound size={21} aria-hidden /></div><div><h2>Customer directory</h2><p>{data.total.toLocaleString()} {data.total === 1 ? "customer" : "customers"}{filters.q || filters.view !== "all" ? " matching your filters" : " across your venue"}</p></div></div>
      {data.access.canViewBookings && <nav className="customer-tabs" aria-label="Customer groups">{([ ["all", "Everyone"], ["returning", "Returning"], ["upcoming", "Upcoming bookings"], ["no_bookings", "No bookings"] ] as const).map(([view, label]) => <Link key={view} href={customerDirectoryHref(filters, { view, page: undefined })} aria-current={filters.view === view ? "page" : undefined}>{label}</Link>)}</nav>}
      <form key={JSON.stringify(filters)} className="customer-search-form" action="/customers" method="get">
        <input type="hidden" name="view" value={filters.view} />
        <label className="customer-search-field"><Search size={18} aria-hidden /><span className="sr-only">Search customers by name, phone or email</span><input name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="Search name, phone or email" /></label>
        <label className="customer-sort"><span>Sort by</span><select name="sort" defaultValue={filters.sort}><option value="newest">Recently added</option><option value="name">Name A–Z</option>{data.access.canViewBookings && <option value="recent">Latest booking</option>}</select></label>
        <button className="button button-primary" type="submit">Search</button>
      </form>
      {(filters.q || filters.view !== "all") && <div className="customer-filter-context"><span>{filters.view === "returning" ? "Two or more confirmed bookings, including completed and no-show visits." : filters.view === "upcoming" ? "Customers with a future booking or active checkout hold." : filters.view === "no_bookings" ? "Customer records without booking history." : `Results for “${filters.q}”`}</span><Link className="text-link" href="/customers">Clear filters <X size={13} aria-hidden /></Link></div>}
      {data.rows.length ? <div className="customer-directory-rows"><div className="customer-row-labels" aria-hidden><span>Customer</span><span>Contact</span><span>{data.access.canViewBookings ? "Booking activity" : "Added"}</span><span /></div>{data.rows.map(customer => <Link className="customer-directory-row" href={`/customers/${customer.id}`} key={customer.id}>
        <div className="customer-person"><span className="customer-avatar" aria-hidden>{customer.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{customer.name}</strong><small>View customer profile</small></div></div>
        <div className="customer-contact-cell"><span>{customer.phone}</span><small>{customer.email || "No email added"}</small></div>
        <div className="customer-activity-cell">{data.access.canViewBookings ? <><strong>{customer.bookingCount ?? 0} {(customer.bookingCount ?? 0) === 1 ? "booking" : "bookings"}</strong><small>{customer.upcomingCount ? `${customer.upcomingCount} upcoming` : "No upcoming bookings"}</small></> : <span>{new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(customer.createdAt)}</span>}</div><ArrowUpRight className="customer-open-icon" size={18} aria-hidden />
      </Link>)}</div> : <div className="customer-empty"><UsersRound size={34} aria-hidden /><h2>{filters.q || filters.view !== "all" ? "No customers match" : "Your community starts here"}</h2><p>{filters.q || filters.view !== "all" ? "Try a different name, phone number or customer group." : "Customers appear here after an online booking or when your team adds them to a booking."}</p>{filters.q || filters.view !== "all" ? <Link className="button button-secondary" href="/customers">Show all customers</Link> : data.access.canBook && <Link className="button button-primary" href="/bookings/new"><CalendarDays size={16} aria-hidden /> Create a booking</Link>}</div>}
      <nav className="customer-pagination" aria-label="Customer pages"><span>{data.total ? `${(filters.page - 1) * 30 + 1}–${Math.min(filters.page * 30, data.total)} of ${data.total}` : "0 customers"}</span><div>{filters.page > 1 && <Link className="button button-secondary" href={customerDirectoryHref(filters, { page: filters.page - 1 })}><ChevronLeft size={15} aria-hidden /> Previous</Link>}<span>Page {filters.page} of {data.pageCount}</span>{filters.page < data.pageCount && <Link className="button button-secondary" href={customerDirectoryHref(filters, { page: filters.page + 1 })}>Next <ChevronRight size={15} aria-hidden /></Link>}</div></nav>
    </section>
  </div>;
}
