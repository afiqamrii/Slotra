import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { bookings, branches, customers, payments, paymentStatuses, refunds, refundStatuses, resources } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";

const schema = z.object({ view: z.enum(["activity", "outstanding", "refunds"]).default("activity"), q: z.string().trim().max(100).default(""), status: z.string().max(24).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) });
export function paymentWorkspaceFilters(raw: Record<string, unknown>) {
  const valid: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(schema.shape)) { if (Array.isArray(raw[key])) continue; const value = validator.safeParse(raw[key]); if (value.success) valid[key] = value.data; }
  const input = schema.parse(valid);
  const statuses: readonly string[] = input.view === "activity" ? paymentStatuses : input.view === "refunds" ? refundStatuses : [];
  if (!statuses.includes(input.status)) input.status = "";
  return input;
}

export async function paymentWorkspace(db: BookingDatabase, actorId: string, organizationId: string, raw: Record<string, unknown>, branchId?: string) {
  if (!await authorizedMembership(db, actorId, organizationId, "payment:view", branchId)) throw new BookingError("PERMISSION_DENIED", "Payment access denied");
  const filters = paymentWorkspaceFilters(raw);
  const scope: SQL[] = [eq(bookings.organizationId, organizationId), ...(branchId ? [eq(bookings.branchId, branchId)] : [])];
  const outstanding = [...scope, inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]), gt(bookings.totalAmount, bookings.amountPaid)];
  const totals = await db.select({ currency: bookings.currency, count: sql<number>`count(*)::integer`, amount: sql<number>`sum(${bookings.totalAmount}::bigint - ${bookings.amountPaid})`.mapWith(Number) })
    .from(bookings).where(and(...outstanding)).groupBy(bookings.currency).orderBy(asc(bookings.currency));
  const conditions = filters.view === "outstanding" ? [...outstanding] : [...scope];
  if (filters.q) { const pattern = `%${filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`; conditions.push(or(ilike(bookings.bookingReference, pattern), ilike(customers.name, pattern), ilike(customers.phone, pattern))!); }
  const common = { bookingId: bookings.id, reference: bookings.bookingReference, customer: customers.name, timezone: branches.timezone, branchName: branches.name, resourceName: resources.name, currency: bookings.currency };
  const branchJoin = and(eq(branches.id, bookings.branchId), eq(branches.organizationId, organizationId));
  const customerJoin = and(eq(customers.id, bookings.customerId), eq(customers.organizationId, organizationId));
  const spaceJoin = and(eq(resources.id, bookings.resourceId), eq(resources.organizationId, organizationId));
  const offset = (filters.page - 1) * 50;
  let rows;
  if (filters.view === "outstanding") {
    rows = await db.select({ ...common, id: bookings.id, at: bookings.startAt, status: bookings.status, amount: sql<number>`${bookings.totalAmount} - ${bookings.amountPaid}`.mapWith(Number), method: sql<string>`'Balance due'` })
      .from(bookings).innerJoin(branches, branchJoin).innerJoin(resources, spaceJoin).leftJoin(customers, customerJoin)
      .where(and(...conditions)).orderBy(asc(bookings.startAt), asc(bookings.id)).limit(51).offset(offset);
  } else if (filters.view === "refunds") {
    rows = await db.select({ ...common, id: refunds.id, at: refunds.createdAt, status: refunds.status, amount: refunds.amountMinor, method: sql<string>`case when ${payments.provider} = 'TEST' then 'Test refund' when ${payments.provider} = 'TOYYIBPAY_SANDBOX' then 'Sandbox refund' else coalesce(${payments.paymentMethod}, 'Refund') end`, currency: payments.currency })
      .from(refunds).innerJoin(bookings, and(eq(bookings.id, refunds.bookingId), eq(bookings.organizationId, refunds.organizationId)))
      .innerJoin(payments, and(eq(payments.id, refunds.paymentId), eq(payments.organizationId, refunds.organizationId)))
      .innerJoin(branches, branchJoin).innerJoin(resources, spaceJoin).leftJoin(customers, customerJoin)
      .where(and(eq(refunds.organizationId, organizationId), ...conditions, ...(filters.status ? [eq(refunds.status, filters.status)] : [])))
      .orderBy(desc(refunds.createdAt), desc(refunds.id)).limit(51).offset(offset);
  } else {
    rows = await db.select({ ...common, id: payments.id, at: payments.createdAt, status: payments.status, amount: payments.amountMinor,
      method: sql<string>`case when ${payments.provider} = 'TEST' then 'Test payment' when ${payments.provider} = 'TOYYIBPAY_SANDBOX' then 'Sandbox payment' else coalesce(${payments.paymentMethod}, ${payments.type}) end`, currency: payments.currency })
      .from(payments).innerJoin(bookings, and(eq(bookings.id, payments.bookingId), eq(bookings.organizationId, payments.organizationId)))
      .innerJoin(branches, branchJoin).innerJoin(resources, spaceJoin).leftJoin(customers, customerJoin)
      .where(and(eq(payments.organizationId, organizationId), ...conditions, ...(filters.status ? [eq(payments.status, filters.status)] : [])))
      .orderBy(desc(payments.createdAt), desc(payments.id)).limit(51).offset(offset);
  }
  return { filters, totals, rows: rows.slice(0, 50), hasMore: rows.length > 50 };
}
