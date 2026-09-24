import { Temporal } from "@js-temporal/polyfill";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { InferSelectModel } from "drizzle-orm";
import { branches, organizationSports, pricingRules, resources } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

const ruleInput = z.object({
  branchId: z.uuid(),
  sportTypeId: z.uuid(),
  resourceId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(80),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  amountMinor: z.number().int().min(0).max(2_147_483_647),
}).refine(value => value.startMinute < value.endMinute, "Closing time must follow opening time")
  .refine(value => new Set(value.weekdays).size === value.weekdays.length, "Choose each day once");

function overlappingDay(a: readonly number[], b: readonly number[]) {
  return a.some(day => b.includes(day));
}

export async function createPricingRule(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:update"))
    throw new BookingError("PERMISSION_DENIED", "Pricing access denied");
  await requireOrganizationFeature(database, organizationId, "DYNAMIC_PRICING");
  const input = ruleInput.parse(raw);
  return database.transaction(async tx => {
    // Serializes rule edits for this branch, including concurrent submissions.
    const [branch] = await tx.select({ id: branches.id }).from(branches)
      .where(and(eq(branches.organizationId, organizationId), eq(branches.id, input.branchId)))
      .for("update").limit(1);
    if (!branch) throw new BookingError("BRANCH_NOT_FOUND", "Venue not found");
    const [sport] = await tx.select({ id: organizationSports.sportTypeId }).from(organizationSports)
      .where(and(eq(organizationSports.organizationId, organizationId), eq(organizationSports.sportTypeId, input.sportTypeId))).limit(1);
    if (!sport) throw new BookingError("SPORT_NOT_FOUND", "Choose a sport offered here");
    if (input.resourceId) {
      const [space] = await tx.select({ id: resources.id }).from(resources).where(and(
        eq(resources.organizationId, organizationId), eq(resources.branchId, input.branchId),
        eq(resources.sportTypeId, input.sportTypeId), eq(resources.id, input.resourceId))).limit(1);
      if (!space) throw new BookingError("RESOURCE_NOT_FOUND", "Choose a space in this venue and sport");
    }
    const scope = input.resourceId ? eq(pricingRules.resourceId, input.resourceId) : isNull(pricingRules.resourceId);
    const existing = await tx.select().from(pricingRules).where(and(
      eq(pricingRules.organizationId, organizationId), eq(pricingRules.branchId, input.branchId),
      eq(pricingRules.sportTypeId, input.sportTypeId), scope, eq(pricingRules.isActive, true)));
    const overlap = existing.find(rule => overlappingDay(rule.weekdays, input.weekdays) &&
      rule.startMinute < input.endMinute && rule.endMinute > input.startMinute);
    if (overlap) {
      const day = input.weekdays.find(value => overlap.weekdays.includes(value))!;
      const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
      throw new BookingError("PRICING_RULE_OVERLAP", `This pricing rule overlaps with ${overlap.name} on ${dayName}.`);
    }
    const [created] = await tx.insert(pricingRules).values({ ...input, organizationId,
      resourceId: input.resourceId ?? null, weekdays: [...input.weekdays].sort() }).returning();
    return created;
  });
}

export async function listPricingRules(database: BookingDatabase, actorId: string, organizationId: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:view"))
    throw new BookingError("PERMISSION_DENIED", "Pricing access denied");
  await requireOrganizationFeature(database, organizationId, "DYNAMIC_PRICING");
  return database.select().from(pricingRules).where(eq(pricingRules.organizationId, organizationId))
    .orderBy(pricingRules.createdAt);
}

export function businessRateForStart(rules: readonly InferSelectModel<typeof pricingRules>[],
  resourceId: string, startAt: Date, timezone: string) {
  const local = Temporal.Instant.from(startAt.toISOString()).toZonedDateTimeISO(timezone);
  const weekday = local.dayOfWeek % 7;
  const minute = local.hour * 60 + local.minute;
  const matches = rules.filter(rule => (rule.resourceId === null || rule.resourceId === resourceId) &&
    rule.weekdays.includes(weekday) && rule.startMinute <= minute && minute < rule.endMinute);
  const specific = matches.find(rule => rule.resourceId === resourceId);
  return (specific ?? matches.find(rule => rule.resourceId === null))?.amountMinor ?? null;
}

export async function matchingBusinessRate(database: BookingDatabase, organizationId: string,
  branchId: string, sportTypeId: string, resourceId: string, startAt: Date, timezone: string) {
  const rules = await database.select().from(pricingRules).where(and(
    eq(pricingRules.organizationId, organizationId), eq(pricingRules.branchId, branchId),
    eq(pricingRules.sportTypeId, sportTypeId), eq(pricingRules.isActive, true)));
  return businessRateForStart(rules, resourceId, startAt, timezone);
}
