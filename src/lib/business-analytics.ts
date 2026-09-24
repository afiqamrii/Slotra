import { and, countDistinct, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { bookings, customerMemberships, customerPackages, membershipPlans, organizations,
  packageUsages, promotionRedemptions } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { customerSegments } from "@/lib/business-segments";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { professionalReport } from "@/lib/professional-reporting";

const countedStatuses = ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"] as const;

/** Operational benefit metrics only: no membership/package sale is inferred from a manual assignment. */
export async function businessAnalytics(database: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown = {}, now = new Date()) {
  if (!await authorizedMembership(database, actorId, organizationId, "report:view") ||
    !await authorizedMembership(database, actorId, organizationId, "customer:view"))
    throw new BookingError("PERMISSION_DENIED", "Business analytics access denied");
  await requireOrganizationFeature(database, organizationId, "CUSTOMER_SEGMENTATION");
  const [organization] = await database.select({ currency: organizations.currency }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  const [report, segments] = await Promise.all([
    professionalReport(database, organizationId, raw, now),
    customerSegments(database, actorId, organizationId, {}, now),
  ]);
  const period = and(gte(bookings.startAt, report.from), lt(bookings.startAt, report.to),
    inArray(bookings.status, countedStatuses));
  const expiringBefore = new Date(now.getTime() + 30 * 86_400_000);
  const [activeMemberships, membershipPlansCount, memberBookings, packagesIssued, packageBalance,
    packageUses, promotionActivity] = await Promise.all([
    database.select({ count: sql<number>`count(*)::int` }).from(customerMemberships).where(and(
      eq(customerMemberships.organizationId, organizationId), eq(customerMemberships.status, "ACTIVE"),
      lte(customerMemberships.startsAt, now), gt(customerMemberships.endsAt, now))),
    database.select({ count: sql<number>`count(*)::int` }).from(membershipPlans).where(and(
      eq(membershipPlans.organizationId, organizationId), eq(membershipPlans.isActive, true))),
    database.select({ count: countDistinct(bookings.id) }).from(bookings).innerJoin(customerMemberships, and(
      eq(customerMemberships.organizationId, organizationId), eq(customerMemberships.customerId, bookings.customerId),
      eq(customerMemberships.status, "ACTIVE"),
      sql`${customerMemberships.startsAt} <= ${bookings.startAt}`,
      sql`${customerMemberships.endsAt} > ${bookings.startAt}`))
      .where(and(eq(bookings.organizationId, organizationId), period)),
    database.select({ count: sql<number>`count(*)::int` }).from(customerPackages).where(and(
      eq(customerPackages.organizationId, organizationId),
      gte(customerPackages.createdAt, report.from), lt(customerPackages.createdAt, report.to))),
    database.select({
      remainingMinutes: sql<number>`coalesce(sum(${customerPackages.remainingMinutes}), 0)::int`,
      expiryRisk: sql<number>`count(*) filter (where ${customerPackages.expiresAt} > ${now}
        and ${customerPackages.expiresAt} <= ${expiringBefore} and ${customerPackages.remainingMinutes} > 0)::int`,
    }).from(customerPackages).where(and(eq(customerPackages.organizationId, organizationId),
      eq(customerPackages.status, "ACTIVE"))),
    database.select({ minutes: sql<number>`coalesce(sum(${packageUsages.minutes}), 0)::int` })
      .from(packageUsages).innerJoin(bookings, and(eq(bookings.organizationId, packageUsages.organizationId),
        eq(bookings.id, packageUsages.bookingId)))
      .where(and(eq(packageUsages.organizationId, organizationId), eq(packageUsages.status, "APPLIED"), period)),
    database.select({
      redemptions: sql<number>`count(*)::int`,
      discountMinor: sql<number>`coalesce(sum(${promotionRedemptions.discountMinor}), 0)::int`,
      bookingValueMinor: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)::int`,
    }).from(promotionRedemptions).innerJoin(bookings, and(eq(bookings.organizationId, promotionRedemptions.organizationId),
      eq(bookings.id, promotionRedemptions.bookingId)))
      .where(and(eq(promotionRedemptions.organizationId, organizationId), period)),
  ]);
  return {
    fromDate: report.fromDate, toDate: report.toDate, timezone: report.timezone,
    currency: organization.currency, range: report.filter.range,
    memberships: {
      active: Number(activeMemberships[0]?.count ?? 0),
      activePlans: Number(membershipPlansCount[0]?.count ?? 0),
      memberBookings: Number(memberBookings[0]?.count ?? 0),
      revenueMinor: null as number | null,
    },
    packages: {
      issued: Number(packagesIssued[0]?.count ?? 0),
      creditsUsedMinutes: Number(packageUses[0]?.minutes ?? 0),
      creditsRemainingMinutes: Number(packageBalance[0]?.remainingMinutes ?? 0),
      expiringWithin30Days: Number(packageBalance[0]?.expiryRisk ?? 0),
      sold: null as number | null,
    },
    promotions: {
      redemptions: Number(promotionActivity[0]?.redemptions ?? 0),
      discountMinor: Number(promotionActivity[0]?.discountMinor ?? 0),
      bookingValueMinor: Number(promotionActivity[0]?.bookingValueMinor ?? 0),
    },
    retention: {
      inactive30: segments.counts.inactive_30,
      inactive60: segments.counts.inactive_60,
      regularInactive30: segments.regularInactive30,
      returningRate: report.customers.returningRate,
      returning: report.customers.returning,
      new: report.customers.new,
    },
  };
}
