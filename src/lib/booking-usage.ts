import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { bookingUsageRecords, organizations } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { planLimit, type StandardPlan } from "@/lib/plan-entitlements";

const planSchema = z.enum(["STARTER", "PROFESSIONAL", "BUSINESS", "PRO"]);
const configuredGrace = Number(process.env.STARTER_BOOKING_GRACE_PERCENT ?? "10");
export const starterGracePercent = Number.isInteger(configuredGrace) && configuredGrace >= 0 && configuredGrace <= 20
  ? configuredGrace : 10;

// Temporary adapter: UTC calendar months. A subscription period resolver can replace this
// without changing the immutable period stored on each existing usage record.
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

function allowance(plan: StandardPlan) {
  const included = planLimit(plan, "MONTHLY_BOOKINGS") ?? 0;
  const grace = plan === "STARTER" ? Math.floor(included * starterGracePercent / 100) : 0;
  return { included, grace };
}

export async function getBookingUsage(db: BookingDatabase, organizationId: string, now = new Date()) {
  const [venue] = await db.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!venue) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  const plan = planSchema.parse(venue.planCode);
  const period = usagePeriod(now);
  const [row] = await db.select({ used: count() }).from(bookingUsageRecords).where(and(
    eq(bookingUsageRecords.organizationId, organizationId), eq(bookingUsageRecords.periodStartAt, period.start)));
  const used = row?.used ?? 0;
  const { included, grace } = allowance(plan);
  return { plan, used, included, grace, period, stage: bookingUsageStage(used, included, grace),
    canBook: used < included + grace };
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
  const plan = planSchema.parse(venue.planCode);
  const { included, grace } = allowance(plan);
  const period = usagePeriod(now);
  const [row] = await db.select({ used: count() }).from(bookingUsageRecords).where(and(
    eq(bookingUsageRecords.organizationId, organizationId), eq(bookingUsageRecords.periodStartAt, period.start)));
  if ((row?.used ?? 0) >= included + grace)
    throw new BookingError("BOOKING_LIMIT_REACHED", "Your venue has reached its monthly booking limit. View Plan & Usage for next steps.");
  await db.insert(bookingUsageRecords).values({ organizationId, bookingId,
    periodStartAt: period.start, periodEndAt: period.end, confirmedAt: now });
  return true;
}
