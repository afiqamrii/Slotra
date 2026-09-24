import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { bookingUsageRecords, bookings, customerMemberships, customerPackages, customers, membershipCreditUsages, membershipPlans,
  organizationSports, packagePlans, packageUsages, promotionRedemptions, promotions, resources } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";

const applicability = z.object({
  sportTypeIds: z.array(z.uuid()).max(30).nullable().optional(),
  resourceIds: z.array(z.uuid()).max(100).nullable().optional(),
});
const membershipInput = applicability.extend({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  priceMinor: z.number().int().nonnegative().max(2_147_483_647),
  billingPeriod: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  discountValue: z.number().int().nonnegative().default(0),
  advanceDays: z.number().int().min(1).max(365).nullable().optional(),
  monthlyCreditsMinutes: z.number().int().min(0).max(60_000).default(0),
}).refine(value => value.discountType !== "PERCENT" || value.discountValue <= 100, "Discount cannot exceed 100%");
const packageInput = applicability.extend({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  priceMinor: z.number().int().nonnegative().max(2_147_483_647),
  creditsMinutes: z.number().int().positive().max(60_000),
  validDays: z.number().int().positive().max(730).nullable().optional(),
});
const promoInput = applicability.extend({
  code: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9-]+$/),
  name: z.string().trim().min(2).max(100),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().int().positive().max(2_147_483_647),
  startsAt: z.date(), endsAt: z.date(),
  minimumSpendMinor: z.number().int().nonnegative().default(0),
  maximumDiscountMinor: z.number().int().positive().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  newCustomerOnly: z.boolean().default(false),
}).refine(value => value.endsAt > value.startsAt, "End must follow start")
  .refine(value => value.discountType !== "PERCENT" || value.discountValue <= 100, "Discount cannot exceed 100%");

async function requireGrowManager(database: BookingDatabase, actorId: string, organizationId: string,
  feature: "MEMBERSHIPS" | "PACKAGES" | "PROMOTIONS") {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:update"))
    throw new BookingError("PERMISSION_DENIED", "Growth settings access denied");
  await requireOrganizationFeature(database, organizationId, feature);
}
async function validateApplicability(database: BookingDatabase, organizationId: string,
  sports: string[] | null | undefined, spaces: string[] | null | undefined) {
  for (const id of sports ?? []) {
    const [sport] = await database.select({ id: organizationSports.sportTypeId }).from(organizationSports)
      .where(and(eq(organizationSports.organizationId, organizationId), eq(organizationSports.sportTypeId, id))).limit(1);
    if (!sport) throw new BookingError("SPORT_NOT_FOUND", "Choose a sport offered by your venue");
  }
  for (const id of spaces ?? []) {
    const [space] = await database.select({ id: resources.id }).from(resources)
      .where(and(eq(resources.organizationId, organizationId), eq(resources.id, id))).limit(1);
    if (!space) throw new BookingError("RESOURCE_NOT_FOUND", "Choose a space in your venue");
  }
}
function applies(sports: string[] | null, spaces: string[] | null, sportTypeId: string, resourceId: string) {
  return (!sports?.length || sports.includes(sportTypeId)) && (!spaces?.length || spaces.includes(resourceId));
}

export async function createMembershipPlan(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireGrowManager(database, actorId, organizationId, "MEMBERSHIPS");
  const input = membershipInput.parse(raw);
  await validateApplicability(database, organizationId, input.sportTypeIds, input.resourceIds);
  const [plan] = await database.insert(membershipPlans).values({
    ...input, organizationId, description: input.description ?? null,
    advanceDays: input.advanceDays ?? null, sportTypeIds: input.sportTypeIds ?? null,
    resourceIds: input.resourceIds ?? null,
  }).returning();
  return plan;
}

export async function assignCustomerMembership(database: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown) {
  await requireGrowManager(database, actorId, organizationId, "MEMBERSHIPS");
  const input = z.object({ customerId: z.uuid(), planId: z.uuid(), startsAt: z.date(), endsAt: z.date() })
    .refine(value => value.endsAt > value.startsAt, "End must follow start").parse(raw);
  const [[customer], [plan]] = await Promise.all([
    database.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, input.customerId))).limit(1),
    database.select().from(membershipPlans).where(and(eq(membershipPlans.organizationId, organizationId), eq(membershipPlans.id, input.planId), eq(membershipPlans.isActive, true))).limit(1),
  ]);
  if (!customer || !plan) throw new BookingError("MEMBERSHIP_NOT_FOUND", "Choose a customer and active plan in this venue");
  if (plan.monthlyCreditsMinutes > 0 && input.endsAt.getTime() - input.startsAt.getTime() > 32 * 86_400_000)
    throw new BookingError("CREDIT_CYCLE", "Assign monthly credits for one month at a time; renew manually");
  const [membership] = await database.insert(customerMemberships).values({
    organizationId, ...input, remainingCreditsMinutes: plan.monthlyCreditsMinutes,
  }).returning();
  return membership;
}

export async function createPackagePlan(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireGrowManager(database, actorId, organizationId, "PACKAGES");
  const input = packageInput.parse(raw);
  await validateApplicability(database, organizationId, input.sportTypeIds, input.resourceIds);
  const [plan] = await database.insert(packagePlans).values({
    ...input, organizationId, description: input.description ?? null, validDays: input.validDays ?? null,
    sportTypeIds: input.sportTypeIds ?? null, resourceIds: input.resourceIds ?? null,
  }).returning();
  return plan;
}

export async function issueCustomerPackage(database: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown, now = new Date()) {
  await requireGrowManager(database, actorId, organizationId, "PACKAGES");
  const input = z.object({ customerId: z.uuid(), planId: z.uuid() }).parse(raw);
  const [[customer], [plan]] = await Promise.all([
    database.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, input.customerId))).limit(1),
    database.select().from(packagePlans).where(and(eq(packagePlans.organizationId, organizationId), eq(packagePlans.id, input.planId), eq(packagePlans.isActive, true))).limit(1),
  ]);
  if (!customer || !plan) throw new BookingError("PACKAGE_NOT_FOUND", "Choose a customer and active package in this venue");
  const [issued] = await database.insert(customerPackages).values({
    organizationId, customerId: input.customerId, planId: plan.id,
    totalMinutes: plan.creditsMinutes, remainingMinutes: plan.creditsMinutes,
    expiresAt: plan.validDays ? new Date(now.getTime() + plan.validDays * 86_400_000) : null,
    createdByUserId: actorId,
  }).returning();
  return issued;
}

export async function eligibleCustomerPackages(database: BookingDatabase, actorId: string, organizationId: string,
  customerId: string, resourceId: string, durationMinutes: number, now = new Date()) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:create"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  await requireOrganizationFeature(database, organizationId, "PACKAGES");
  const [space] = await database.select({ id: resources.id, sportTypeId: resources.sportTypeId })
    .from(resources).where(and(eq(resources.organizationId, organizationId),
      eq(resources.id, z.uuid().parse(resourceId)))).limit(1);
  if (!space) throw new BookingError("RESOURCE_NOT_FOUND", "Space not found");
  const rows = await database.select({ owned: customerPackages, plan: packagePlans })
    .from(customerPackages).innerJoin(packagePlans, eq(customerPackages.planId, packagePlans.id))
    .where(and(eq(customerPackages.organizationId, organizationId),
      eq(customerPackages.customerId, z.uuid().parse(customerId)),
      eq(customerPackages.status, "ACTIVE"), gte(customerPackages.remainingMinutes, durationMinutes)))
    .orderBy(customerPackages.createdAt).limit(30);
  return rows.filter(({ owned, plan }) => (!owned.expiresAt || owned.expiresAt > now) &&
    applies(plan.sportTypeIds, plan.resourceIds, space.sportTypeId, space.id))
    .map(({ owned, plan }) => ({ id: owned.id, name: plan.name, remainingMinutes: owned.remainingMinutes,
      afterMinutes: owned.remainingMinutes - durationMinutes, expiresAt: owned.expiresAt?.toISOString() ?? null }));
}

export async function eligibleMembershipCredits(database: BookingDatabase, actorId: string, organizationId: string,
  customerId: string, resourceId: string, durationMinutes: number, bookingStartAt: Date) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:create"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  await requireOrganizationFeature(database, organizationId, "CREDITS");
  const [space] = await database.select({ id: resources.id, sportTypeId: resources.sportTypeId }).from(resources)
    .where(and(eq(resources.organizationId, organizationId), eq(resources.id, z.uuid().parse(resourceId)))).limit(1);
  if (!space) throw new BookingError("RESOURCE_NOT_FOUND", "Space not found");
  const rows = await database.select({ owned: customerMemberships, plan: membershipPlans }).from(customerMemberships)
    .innerJoin(membershipPlans, eq(customerMemberships.planId, membershipPlans.id))
    .where(and(eq(customerMemberships.organizationId, organizationId),
      eq(customerMemberships.customerId, z.uuid().parse(customerId)),
      eq(customerMemberships.status, "ACTIVE"), gte(customerMemberships.remainingCreditsMinutes, durationMinutes),
      lte(customerMemberships.startsAt, bookingStartAt), gt(customerMemberships.endsAt, bookingStartAt))).limit(30);
  return rows.filter(({ plan }) => applies(plan.sportTypeIds, plan.resourceIds, space.sportTypeId, space.id))
    .map(({ owned, plan }) => ({ id: owned.id, name: plan.name, remainingMinutes: owned.remainingCreditsMinutes,
      afterMinutes: owned.remainingCreditsMinutes - durationMinutes }));
}

export async function memberAdvanceBenefits(database: BookingDatabase, organizationId: string,
  customerId: string | null | undefined, bookingStartAt: Date) {
  if (!customerId || !await hasOrganizationFeature(database, organizationId, "MEMBERSHIPS")) return [];
  return database.select({ days: membershipPlans.advanceDays,
    sportTypeIds: membershipPlans.sportTypeIds, resourceIds: membershipPlans.resourceIds }).from(customerMemberships)
    .innerJoin(membershipPlans, and(eq(membershipPlans.organizationId, organizationId),
      eq(membershipPlans.id, customerMemberships.planId), eq(membershipPlans.isActive, true)))
    .where(and(eq(customerMemberships.organizationId, organizationId),
      eq(customerMemberships.customerId, z.uuid().parse(customerId)),
      eq(customerMemberships.status, "ACTIVE"),
      lte(customerMemberships.startsAt, bookingStartAt), gt(customerMemberships.endsAt, bookingStartAt))).limit(20);
}
export function memberAdvanceForSpace(benefits: Awaited<ReturnType<typeof memberAdvanceBenefits>>,
  sportTypeId: string, resourceId: string) {
  return benefits.reduce<number | null>((best, row) =>
    row.days === null || !applies(row.sportTypeIds, row.resourceIds, sportTypeId, resourceId) ? best :
      Math.max(best ?? 0, row.days), null);
}

export async function createPromotion(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireGrowManager(database, actorId, organizationId, "PROMOTIONS");
  const input = promoInput.parse(raw);
  await validateApplicability(database, organizationId, input.sportTypeIds, input.resourceIds);
  const [created] = await database.insert(promotions).values({
    ...input, organizationId, code: input.code.toUpperCase(),
    maximumDiscountMinor: input.maximumDiscountMinor ?? null, usageLimit: input.usageLimit ?? null,
    perCustomerLimit: input.perCustomerLimit ?? null, sportTypeIds: input.sportTypeIds ?? null,
    resourceIds: input.resourceIds ?? null,
  }).returning();
  return created;
}

export async function prepareBookingBenefits(database: BookingDatabase, organizationId: string,
  input: { customerId: string | null; sportTypeId: string; resourceId: string; subtotal: number;
    durationMinutes: number; customerPackageId?: string; customerMembershipId?: string;
    promoCode?: string; bookingStartAt: Date; now: Date }) {
  if ([input.customerPackageId, input.customerMembershipId, input.promoCode].filter(Boolean).length > 1)
    throw new BookingError("BENEFITS_CONFLICT", "Choose a package, membership credits or promo code");
  let membershipDiscount = 0;
  if (input.customerId && await hasOrganizationFeature(database, organizationId, "MEMBERSHIPS")) {
    const memberships = await database.select({ membership: customerMemberships, plan: membershipPlans })
      .from(customerMemberships).innerJoin(membershipPlans, eq(customerMemberships.planId, membershipPlans.id))
      .where(and(eq(customerMemberships.organizationId, organizationId), eq(customerMemberships.customerId, input.customerId),
        eq(customerMemberships.status, "ACTIVE"), lte(customerMemberships.startsAt, input.bookingStartAt), gt(customerMemberships.endsAt, input.bookingStartAt)))
      .orderBy(customerMemberships.createdAt).limit(10);
    for (const { plan } of memberships) {
      if (!applies(plan.sportTypeIds, plan.resourceIds, input.sportTypeId, input.resourceId)) continue;
      const discount = plan.discountType === "PERCENT" ? Math.round(input.subtotal * plan.discountValue / 100)
        : plan.discountType === "FIXED" ? plan.discountValue : 0;
      membershipDiscount = Math.max(membershipDiscount, Math.min(input.subtotal, discount));
    }
  }
  let packageUsage: { customerPackageId: string; minutes: number } | null = null;
  let membershipCreditUsage: { customerMembershipId: string; minutes: number } | null = null;
  if (input.customerMembershipId) {
    await requireOrganizationFeature(database, organizationId, "CREDITS");
    if (!input.customerId) throw new BookingError("CUSTOMER_REQUIRED", "Choose a customer to use membership credits");
    const [owned] = await database.select({ membership: customerMemberships, plan: membershipPlans })
      .from(customerMemberships).innerJoin(membershipPlans, eq(customerMemberships.planId, membershipPlans.id))
      .where(and(eq(customerMemberships.organizationId, organizationId),
        eq(customerMemberships.id, z.uuid().parse(input.customerMembershipId)),
        eq(customerMemberships.customerId, input.customerId))).for("update").limit(1);
    if (!owned || owned.membership.status !== "ACTIVE" || owned.plan.monthlyCreditsMinutes <= 0 ||
      owned.membership.startsAt > input.bookingStartAt || owned.membership.endsAt <= input.bookingStartAt ||
      !applies(owned.plan.sportTypeIds, owned.plan.resourceIds, input.sportTypeId, input.resourceId))
      throw new BookingError("MEMBERSHIP_CREDITS_UNAVAILABLE", "These membership credits cannot cover this booking");
    if (owned.membership.remainingCreditsMinutes < input.durationMinutes)
      throw new BookingError("MEMBERSHIP_CREDITS_BALANCE", "Not enough membership time remains");
    await database.update(customerMemberships).set({ remainingCreditsMinutes:
      owned.membership.remainingCreditsMinutes - input.durationMinutes, updatedAt: input.now })
      .where(and(eq(customerMemberships.organizationId, organizationId), eq(customerMemberships.id, owned.membership.id)));
    membershipCreditUsage = { customerMembershipId: owned.membership.id, minutes: input.durationMinutes };
  }
  if (input.customerPackageId) {
    await requireOrganizationFeature(database, organizationId, "PACKAGES");
    if (!input.customerId) throw new BookingError("CUSTOMER_REQUIRED", "Choose a customer to use a package");
    const [owned] = await database.select({ customerPackage: customerPackages, plan: packagePlans })
      .from(customerPackages).innerJoin(packagePlans, eq(customerPackages.planId, packagePlans.id))
      .where(and(eq(customerPackages.organizationId, organizationId), eq(customerPackages.id, input.customerPackageId),
        eq(customerPackages.customerId, input.customerId))).for("update").limit(1);
    if (!owned || owned.customerPackage.status !== "ACTIVE" ||
      (owned.customerPackage.expiresAt && owned.customerPackage.expiresAt <= input.bookingStartAt) ||
      !applies(owned.plan.sportTypeIds, owned.plan.resourceIds, input.sportTypeId, input.resourceId))
      throw new BookingError("PACKAGE_UNAVAILABLE", "This package cannot be used for this booking");
    if (owned.customerPackage.remainingMinutes < input.durationMinutes)
      throw new BookingError("PACKAGE_BALANCE", "Not enough package time remains");
    await database.update(customerPackages).set({
      remainingMinutes: owned.customerPackage.remainingMinutes - input.durationMinutes, updatedAt: input.now,
    }).where(and(eq(customerPackages.organizationId, organizationId), eq(customerPackages.id, input.customerPackageId)));
    packageUsage = { customerPackageId: input.customerPackageId, minutes: input.durationMinutes };
  }
  let promotion: { id: string; discountMinor: number } | null = null;
  if (input.promoCode) {
    await requireOrganizationFeature(database, organizationId, "PROMOTIONS");
    const code = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9-]+$/).parse(input.promoCode).toUpperCase();
    const [promo] = await database.select().from(promotions).where(and(
      eq(promotions.organizationId, organizationId), eq(promotions.code, code))).for("update").limit(1);
    if (!promo?.isActive || promo.startsAt > input.now || promo.endsAt <= input.now ||
      !applies(promo.sportTypeIds, promo.resourceIds, input.sportTypeId, input.resourceId) ||
      input.subtotal < promo.minimumSpendMinor)
      throw new BookingError("PROMO_UNAVAILABLE", "This promo code is not available for this booking");
    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit)
      throw new BookingError("PROMO_LIMIT", "This promo code has reached its usage limit");
    if (promo.perCustomerLimit !== null || promo.newCustomerOnly) {
      if (!input.customerId) throw new BookingError("CUSTOMER_REQUIRED", "Choose a customer to use this promo");
      if (promo.perCustomerLimit !== null) {
        const [count] = await database.select({ total: sql<number>`count(*)::int` }).from(promotionRedemptions)
          .where(and(eq(promotionRedemptions.organizationId, organizationId),
            eq(promotionRedemptions.promotionId, promo.id), eq(promotionRedemptions.customerId, input.customerId)));
        if (count.total >= promo.perCustomerLimit)
          throw new BookingError("PROMO_LIMIT", "This customer has already used this promo");
      }
      if (promo.newCustomerOnly) {
        const [prior] = await database.select({ id: bookingUsageRecords.id }).from(bookingUsageRecords)
          .innerJoin(bookings, and(eq(bookings.organizationId, bookingUsageRecords.organizationId),
            eq(bookings.id, bookingUsageRecords.bookingId)))
          .where(and(eq(bookingUsageRecords.organizationId, organizationId),
            eq(bookings.customerId, input.customerId)))
          .limit(1);
        if (prior) throw new BookingError("PROMO_UNAVAILABLE", "This promo is for first bookings only");
      }
    }
    const remaining = input.subtotal - membershipDiscount;
    let promoDiscount = promo.discountType === "PERCENT" ? Math.round(remaining * promo.discountValue / 100)
      : promo.discountValue;
    if (promo.maximumDiscountMinor !== null) promoDiscount = Math.min(promoDiscount, promo.maximumDiscountMinor);
    promoDiscount = Math.min(remaining, promoDiscount);
    if (promoDiscount <= 0) throw new BookingError("PROMO_UNAVAILABLE", "This promo has no discount for this booking");
    await database.update(promotions).set({ usedCount: promo.usedCount + 1, updatedAt: input.now })
      .where(and(eq(promotions.organizationId, organizationId), eq(promotions.id, promo.id)));
    promotion = { id: promo.id, discountMinor: promoDiscount };
  }
  return { discountAmount: packageUsage || membershipCreditUsage ? input.subtotal : membershipDiscount + (promotion?.discountMinor ?? 0),
    packageUsage, membershipCreditUsage, promotion };
}

export async function recordBookingBenefits(database: BookingDatabase, organizationId: string, bookingId: string,
  customerId: string | null, prepared: Awaited<ReturnType<typeof prepareBookingBenefits>>) {
  if (prepared.packageUsage) await database.insert(packageUsages).values({
    organizationId, bookingId, ...prepared.packageUsage,
  });
  if (prepared.membershipCreditUsage) await database.insert(membershipCreditUsages).values({
    organizationId, bookingId, ...prepared.membershipCreditUsage,
  });
  if (prepared.promotion) await database.insert(promotionRedemptions).values({
    organizationId, bookingId, customerId, promotionId: prepared.promotion.id,
    discountMinor: prepared.promotion.discountMinor,
  });
}

export async function reverseMembershipCreditUsage(database: BookingDatabase, organizationId: string,
  bookingId: string, now: Date) {
  const [usage] = await database.select().from(membershipCreditUsages).where(and(
    eq(membershipCreditUsages.organizationId, organizationId), eq(membershipCreditUsages.bookingId, bookingId)))
    .for("update").limit(1);
  if (!usage || usage.status !== "APPLIED") return;
  const [owned] = await database.select({ membership: customerMemberships, plan: membershipPlans })
    .from(customerMemberships).innerJoin(membershipPlans, eq(customerMemberships.planId, membershipPlans.id))
    .where(and(eq(customerMemberships.organizationId, organizationId),
      eq(customerMemberships.id, usage.customerMembershipId))).for("update").limit(1);
  if (!owned) throw new BookingError("MEMBERSHIP_NOT_FOUND", "Membership record not found");
  await database.update(customerMemberships).set({ remainingCreditsMinutes:
    Math.min(owned.plan.monthlyCreditsMinutes, owned.membership.remainingCreditsMinutes + usage.minutes), updatedAt: now })
    .where(and(eq(customerMemberships.organizationId, organizationId), eq(customerMemberships.id, owned.membership.id)));
  await database.update(membershipCreditUsages).set({ status: "REVERSED", reversedAt: now, updatedAt: now })
    .where(and(eq(membershipCreditUsages.organizationId, organizationId), eq(membershipCreditUsages.id, usage.id)));
}

export async function reversePackageUsage(database: BookingDatabase, organizationId: string, bookingId: string, now: Date) {
  const [usage] = await database.select().from(packageUsages).where(and(
    eq(packageUsages.organizationId, organizationId), eq(packageUsages.bookingId, bookingId))).for("update").limit(1);
  if (!usage || usage.status !== "APPLIED") return;
  const [owned] = await database.select().from(customerPackages).where(and(
    eq(customerPackages.organizationId, organizationId), eq(customerPackages.id, usage.customerPackageId))).for("update").limit(1);
  if (!owned) throw new BookingError("PACKAGE_NOT_FOUND", "Package record not found");
  await database.update(customerPackages).set({
    remainingMinutes: Math.min(owned.totalMinutes, owned.remainingMinutes + usage.minutes), updatedAt: now,
  }).where(and(eq(customerPackages.organizationId, organizationId), eq(customerPackages.id, owned.id)));
  await database.update(packageUsages).set({ status: "REVERSED", reversedAt: now, updatedAt: now })
    .where(and(eq(packageUsages.organizationId, organizationId), eq(packageUsages.id, usage.id)));
}
