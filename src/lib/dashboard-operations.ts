import "server-only";
import { and, asc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { bookings, branches, customers, resources } from "@/db/schema";
import { type BookingDatabase } from "@/lib/booking-availability";
import { bookingSetup } from "@/lib/booking-management";
import { localDateAt, localDayBounds } from "@/lib/booking-time";
import { authorizedMembership } from "@/lib/organization-service";

// This is deliberately independent of financial reporting and plan tiers: a
// receptionist needs today's operations without receiving revenue aggregates.
export async function dashboardOperations(db: BookingDatabase, actorId: string, organizationId: string,
  branchId?: string, now = new Date()) {
  if (!await authorizedMembership(db, actorId, organizationId, "booking:view", branchId)) return null;
  const setup = await bookingSetup(db, actorId, organizationId);
  const selected = setup.branches.filter(branch => branch.isActive && (!branchId || branch.id === branchId));
  if (!selected.length) return null;
  const [createAccess, paymentAccess, checkInAccess, updateAccess] = await Promise.all([
    authorizedMembership(db, actorId, organizationId, "booking:create", branchId),
    authorizedMembership(db, actorId, organizationId, "payment:view", branchId),
    authorizedMembership(db, actorId, organizationId, "booking:check_in", branchId),
    authorizedMembership(db, actorId, organizationId, "booking:update", branchId),
  ]);
  const windows = selected.map(branch => ({ ...branch, ...localDayBounds(localDateAt(now, branch.timezone), branch.timezone) }));
  const today = or(...windows.map(branch => and(eq(bookings.branchId, branch.id),
    lt(bookings.startAt, branch.to), gt(bookings.endAt, branch.from))));
  const scheduledToday = or(...windows.map(branch => and(eq(bookings.branchId, branch.id),
    gte(bookings.startAt, branch.from), lt(bookings.startAt, branch.to))));
  const liveStatuses = inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"]);
  const live = and(liveStatuses, lte(bookings.startAt, now), gt(bookings.endAt, now));
  const arriving = and(eq(bookings.status, "CONFIRMED"), gt(bookings.startAt, now));
  const lateCheckIn = and(eq(bookings.status, "CONFIRMED"), lte(bookings.startAt, now), gt(bookings.endAt, now));
  const wrapUp = and(inArray(bookings.status, ["CHECKED_IN", "IN_PROGRESS"]), lte(bookings.endAt, now));
  const held = and(eq(bookings.status, "AWAITING_PAYMENT"), gt(bookings.holdExpiresAt, now));
  const outstanding = and(inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]),
    gt(bookings.totalAmount, bookings.amountPaid));
  const scope = and(eq(bookings.organizationId, organizationId), today);
  const [totals, sessions, attention] = await Promise.all([
    db.select({
      scheduled: sql<number>`count(*) filter (where ${scheduledToday} and ${inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"])})`.mapWith(Number),
      live: sql<number>`count(*) filter (where ${live})`.mapWith(Number),
      arriving: sql<number>`count(*) filter (where ${arriving})`.mapWith(Number),
      lateCheckIn: sql<number>`count(*) filter (where ${lateCheckIn})`.mapWith(Number),
      wrapUp: sql<number>`count(*) filter (where ${wrapUp})`.mapWith(Number),
      held: sql<number>`count(*) filter (where ${held})`.mapWith(Number),
      outstanding: paymentAccess ? sql<number>`count(*) filter (where ${outstanding})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    }).from(bookings).where(scope),
    db.select({ id: bookings.id, reference: bookings.bookingReference, startAt: bookings.startAt, endAt: bookings.endAt,
      status: bookings.status, resourceName: resources.name, customerName: customers.name,
      branchName: branches.name, timezone: branches.timezone })
      .from(bookings)
      .innerJoin(resources, and(eq(resources.id, bookings.resourceId), eq(resources.organizationId, organizationId)))
      .innerJoin(branches, and(eq(branches.id, bookings.branchId), eq(branches.organizationId, organizationId)))
      .leftJoin(customers, and(eq(customers.id, bookings.customerId), eq(customers.organizationId, organizationId)))
      .where(and(scope, liveStatuses, gt(bookings.endAt, now))).orderBy(asc(bookings.startAt), asc(bookings.id)).limit(8),
    db.select({ id: bookings.id, reference: bookings.bookingReference, resourceName: resources.name,
      status: bookings.status, startAt: bookings.startAt, endAt: bookings.endAt, timezone: branches.timezone, branchName: branches.name })
      .from(bookings)
      .innerJoin(resources, and(eq(resources.id, bookings.resourceId), eq(resources.organizationId, organizationId)))
      .innerJoin(branches, and(eq(branches.id, bookings.branchId), eq(branches.organizationId, organizationId)))
      .where(and(scope, or(lateCheckIn, wrapUp))).orderBy(asc(bookings.startAt), asc(bookings.id)).limit(4),
  ]);
  return { at: now, branches: selected, branchId, canCreate: !!createAccess, canViewPayments: !!paymentAccess,
    canCheckIn: !!checkInAccess, canUpdate: !!updateAccess,
    counts: totals[0], sessions, attention };
}

export type DashboardOperationsData = NonNullable<Awaited<ReturnType<typeof dashboardOperations>>>;
