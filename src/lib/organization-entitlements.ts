import { eq } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { planHasFeature, type PlanFeature, type StandardPlan } from "@/lib/plan-entitlements";

const planSchema = z.enum(["STARTER", "PROFESSIONAL", "BUSINESS", "PRO"]);

export async function organizationPlan(db: BookingDatabase, organizationId: string): Promise<StandardPlan> {
  const [organization] = await db.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  return planSchema.parse(organization.planCode);
}

export async function hasOrganizationFeature(db: BookingDatabase, organizationId: string, feature: PlanFeature) {
  return planHasFeature(await organizationPlan(db, organizationId), feature);
}

export async function requireOrganizationFeature(db: BookingDatabase, organizationId: string, feature: PlanFeature) {
  if (!await hasOrganizationFeature(db, organizationId, feature))
    throw new BookingError("PLAN_FEATURE_UNAVAILABLE", "Online payments and deposits are available from Professional");
}
