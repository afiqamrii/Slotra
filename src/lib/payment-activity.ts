import { and, desc, eq } from "drizzle-orm";
import { bookings, branches, customers, payments } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";

export async function recentPaymentActivity(db: BookingDatabase, actorId: string, organizationId: string, branchId?: string) {
  if (!await authorizedMembership(db, actorId, organizationId, "payment:view", branchId))
    throw new BookingError("PERMISSION_DENIED", "Payment access denied");
  return db.select({
    id: payments.id, amount: payments.amountMinor, currency: payments.currency, provider: payments.provider,
    status: payments.status, method: payments.paymentMethod, type: payments.type, createdAt: payments.createdAt,
    bookingId: bookings.id, reference: bookings.bookingReference, customer: customers.name,
    timezone: branches.timezone,
  }).from(payments).innerJoin(bookings, and(eq(bookings.id, payments.bookingId),
    eq(bookings.organizationId, organizationId)))
    .innerJoin(branches, and(eq(branches.id, bookings.branchId), eq(branches.organizationId, organizationId)))
    .leftJoin(customers, and(eq(customers.id, bookings.customerId), eq(customers.organizationId, organizationId)))
    .where(and(eq(payments.organizationId, organizationId), ...(branchId ? [eq(bookings.branchId, branchId)] : [])))
    .orderBy(desc(payments.createdAt)).limit(50);
}
