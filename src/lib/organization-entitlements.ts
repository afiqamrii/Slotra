import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { planHasFeature, type PlanFeature, type PlanLimit } from "@/lib/plan-entitlements";
import { organizationBillingAccess } from "@/lib/subscription-access";

export async function organizationPlan(db: BookingDatabase, organizationId: string) {
  return (await organizationBillingAccess(db, organizationId)).plan;
}
export async function organizationLimit(db: BookingDatabase, organizationId: string, limit: PlanLimit) {
  return (await organizationBillingAccess(db, organizationId)).limits[limit];
}

export async function hasOrganizationFeature(db: BookingDatabase, organizationId: string, feature: PlanFeature) {
  return (await organizationBillingAccess(db, organizationId)).features[feature];
}

export async function requireOrganizationFeature(db: BookingDatabase, organizationId: string, feature: PlanFeature) {
  if (!await hasOrganizationFeature(db, organizationId, feature))
    throw new BookingError("PLAN_FEATURE_UNAVAILABLE",
      planHasFeature("PROFESSIONAL", feature) ? "This feature is available from Professional" :
        planHasFeature("BUSINESS", feature) ? "This feature is available from Business" :
          "This feature is available on Pro");
}
