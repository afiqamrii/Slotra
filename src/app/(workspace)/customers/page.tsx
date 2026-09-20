import Link from "next/link";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bookings, customers, organizations } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { organization } = await requirePermission("customer:view");
  const db = getDb();
  const organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "CUSTOMER_DATABASE")) return <div className="foundation-page"><h1>Customers unavailable</h1></div>;
  const [venue] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = await db.select({ id: customers.id, name: customers.name, phone: customers.phone,
    email: customers.email, createdAt: customers.createdAt, bookingCount: count(bookings.id),
    bookingValue: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} not in ('CANCELLED','EXPIRED')), 0)`.mapWith(Number),
  }).from(customers).leftJoin(bookings, and(eq(bookings.customerId, customers.id), eq(bookings.organizationId, organizationId)))
    .where(and(eq(customers.organizationId, organizationId), search ? or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.email, pattern)) : undefined))
    .groupBy(customers.id).orderBy(desc(customers.createdAt)).limit(51).offset((page - 1) * 50);
  const href = (next: number) => `/customers?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(next) })}`;
  return <div className="foundation-page starter-customers"><div className="starter-page-head"><div><p className="eyebrow">OPERATIONS</p><h1>Customers</h1><p>People who have booked with your venue.</p></div><Link className="button button-secondary" href="/reports">Reports & CSV</Link></div>
    <form className="starter-customer-search" action="/customers" method="get"><label htmlFor="customer-search">Find a customer</label><div><input id="customer-search" type="search" name="q" placeholder="Search name, phone or email" defaultValue={search} /><button className="button button-primary">Search</button>{search && <Link className="text-link" href="/customers">Clear</Link>}</div></form>
    {rows.length ? <div className="foundation-card starter-customer-list"><div className="starter-customer-list-head"><span>Customer</span><span>Bookings</span><span>Booking value</span></div>{rows.slice(0, 50).map(row => <div key={row.id} className="starter-customer-row"><div><strong>{row.name}</strong><small>{row.phone}{row.email ? ` · ${row.email}` : ""}</small></div><span>{row.bookingCount}</span><span>{new Intl.NumberFormat("en-MY", { style: "currency", currency: venue?.currency ?? "MYR" }).format(row.bookingValue / 100)}</span></div>)}</div> : <div className="foundation-card starter-panel"><h2>{search ? "No customers found" : "No customers yet"}</h2><p>{search ? "Try a different name, phone, or email." : "Customers appear here when they make a booking or your team creates one."}</p></div>}
    <div className="booking-pagination">{page > 1 && <Link className="button button-secondary" href={href(page - 1)}>Previous</Link>}<span>Page {page}</span>{rows.length > 50 && <Link className="button button-secondary" href={href(page + 1)}>Next</Link>}</div>
  </div>;
}
