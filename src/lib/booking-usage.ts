import { and, count, eq, gte, lt } from "drizzle-orm";
import { bookingUsageRecords, organizations } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { organizationBillingAccess } from "@/lib/subscription-access";
const configuredGrace = Number(process.env.STARTER_BOOKING_GRACE_PERCENT ?? "10");
export const starterGracePercent = Number.isInteger(configuredGrace) && configuredGrace >= 0 && configuredGrace <= 20
  ? configuredGrace : 10;

// Legacy fallback only. Subscribed venues use their anchored monthly usage window.
export function usagePeriod(at: Date) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end };
}

export function bookingUsageStage(used: number, included: number, grace: number) {
  if (used >= included + grace) return "LIMIT_REACHED" as const;
  if (used >= included) return "GRACE" as const;
  if (used >= Math.ceil(included * .9)) return "CRITICAL" as const;
  if (used >= Math.ceil(included * .8)) return "WARNING" as const;
  if (used >= Math.ceil(included * .7)) return "INFO" as const;
  return "NORMAL" as const;
}

function allowance(access: Awaited<ReturnType<typeof organizationBillingAccess>>) {
  const included = access.limits.MONTHLY_BOOKINGS ?? 0;
  const grace = access.plan === "STARTER" ? Math.floor(included * starterGracePercent / 100) : 0;
  return { included, grace };
}

export async function getBookingUsage(db: BookingDatabase, organizationId: string, now = new Date()) {
  const access = await organizationBillingAccess(db, organizationId, now);
  const { plan, period } = access;
  const [row] = await db.select({ used: count() }).from(bookingUsageRecords).where(and(
    eq(bookingUsageRecords.organizationId, organizationId), gte(bookingUsageRecords.confirmedAt, period.start), lt(bookingUsageRecords.confirmedAt, period.end)));
  const used = row?.used ?? 0;
  const { included, grace } = allowance(access);
  return { plan, used, included, grace, period, stage: bookingUsageStage(used, included, grace),
    canBook: access.writable && used < included + grace };
}

// Call inside the booking's transaction after obtaining the resource/booking locks.
// The organization row serializes confirmations across different resources.
export async function recordConfirmedBookingUsage(db: BookingDatabase, organizationId: string, bookingId: string, now: Date) {
  const [venue] = await db.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!venue) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  const [existing] = await db.select({ id: bookingUsageRecords.id }).from(bookingUsageRecords)
    .where(and(eq(bookingUsageRecords.organizationId, organizationId), eq(bookingUsageRecords.bookingId, bookingId))).limit(1);
  if (existing) return false;
  const access = await organizationBillingAccess(db, organizationId, now);
  if (!access.writable) throw new BookingError("VENUE_UNAVAILABLE", "Online booking is temporarily unavailable.");
  const { included, grace } = allowance(access);
  const { period } = access;
  const [row] = await db.select({ used: count() }).from(bookingUsageRecords).where(and(
    eq(bookingUsageRecords.organizationId, organizationId), gte(bookingUsageRecords.confirmedAt, period.start), lt(bookingUsageRecords.confirmedAt, period.end)));
  if ((row?.used ?? 0) >= included + grace)
    throw new BookingError("BOOKING_LIMIT_REACHED", "Your venue has reached its monthly booking limit. View Plan & Usage for next steps.");
  await db.insert(bookingUsageRecords).values({ organizationId, bookingId,
    periodStartAt: period.start, periodEndAt: period.end, confirmedAt: now });
  return true;
}
