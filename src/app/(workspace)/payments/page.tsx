import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bookings, customers, organizations, payments } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { bookingDate, bookingMoney, bookingStatusLabel } from "@/lib/booking-format";

export const dynamic = "force-dynamic";
export default async function PaymentsPage() {
  const { organization } = await requirePermission("payment:view");
  const items = await getDb().select({
    id: payments.id, amount: payments.amountMinor, currency: payments.currency, provider: payments.provider,
    status: payments.status, method: payments.paymentMethod, type: payments.type, createdAt: payments.createdAt,
    bookingId: bookings.id, reference: bookings.bookingReference, customer: customers.name,
    timezone: organizations.timezone,
  }).from(payments).innerJoin(bookings, and(eq(bookings.id, payments.bookingId),
    eq(bookings.organizationId, organization.organizationId)))
    .innerJoin(organizations, eq(organizations.id, payments.organizationId))
    .leftJoin(customers, and(eq(customers.id, bookings.customerId), eq(customers.organizationId, organization.organizationId)))
    .where(eq(payments.organizationId, organization.organizationId))
    .orderBy(desc(payments.createdAt)).limit(50);
  return <div className="booking-ops-page"><header className="booking-page-head"><div>
    <p className="eyebrow">FRONT DESK / PAYMENTS</p><h1>Payments</h1>
    <p>Recent payment activity. Open a booking to record a payment or refund.</p></div>
    <Link href="/settings/payments" className="button button-secondary">Payment settings</Link></header>
    <section className="foundation-card payment-activity"><h2>Recent activity</h2>
      {!items.length ? <p>No payments recorded yet. Pay-at-venue bookings will appear here after staff records payment.</p> :
        <div className="payment-activity-list">{items.map(item =>
          <Link key={item.id} href={"/bookings/" + item.bookingId} className="payment-activity-row">
            <span><strong>{item.reference}</strong><small>{item.customer ?? "Guest"} · {bookingDate(item.createdAt, item.timezone)}</small></span>
            <span><strong>{bookingMoney(item.amount, item.currency)}</strong><small>{item.provider === "TEST" ? "Test payment" : bookingStatusLabel(item.method || item.type)} · {bookingStatusLabel(item.status)}</small></span>
          </Link>)}</div>}</section>
  </div>;
}


