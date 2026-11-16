import { eq, sql, type SQLWrapper } from "drizzle-orm";
import { entitlementOverrides, organizations, organizationSubscriptions } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { planDefinitions, type PlanFeature, type PlanLimit } from "@/lib/plan-entitlements";
import { effectiveSubscription, monthlyUsagePeriod } from "@/lib/subscription-policy";

type Organization = typeof organizations.$inferSelect;
type Subscription = typeof organizationSubscriptions.$inferSelect;
type Override = typeof entitlementOverrides.$inferSelect;
type RawOverride = Omit<Override, "expiresAt" | "createdAt" | "revokedAt"> & { expiresAt: string; createdAt: string; revokedAt: string | null };
// One tenant lookup; aggregation avoids a parent row for every support override.
export function billingOverridesSelection(organizationColumn: SQLWrapper, now = new Date()) {
  return sql<RawOverride[]>`coalesce((select jsonb_agg(jsonb_build_object(
    'id', o.id, 'organizationId', o.organization_id, 'kind', o.kind, 'key', o.key, 'value', o.value,
    'reason', o.reason, 'expiresAt', o.expires_at, 'createdByUserId', o.created_by_user_id,
    'createdAt', o.created_at, 'revokedAt', o.revoked_at) order by o.created_at desc, o.id desc)
    from app.entitlement_overrides o where o.organization_id = ${organizationColumn}
      and o.expires_at > ${now} and o.revoked_at is null), '[]'::jsonb)`;
}
export function resolveOrganizationBillingAccess(organization: Organization, subscription: Subscription | null,
  rawOverrides: RawOverride[], now = new Date()) {
  const state = effectiveSubscription(subscription, organization, now);
  const overrides = rawOverrides.map(row => ({ ...row, expiresAt: new Date(row.expiresAt), createdAt: new Date(row.createdAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null }));
  const features = { ...planDefinitions[state.plan].features };
  const limits = { ...planDefinitions[state.plan].limits };
  const applied = new Set<string>();
  for (const override of overrides) {
    const key = override.kind + ":" + override.key;
    if (applied.has(key)) continue;
    applied.add(key);
    if (override.kind === "FEATURE" && Object.hasOwn(features, override.key))
      features[override.key as PlanFeature] = override.value === 1;
    if (override.kind === "LIMIT" && Object.hasOwn(limits, override.key)) {
      const limit = override.key as PlanLimit;
      limits[limit] = (limits[limit] ?? 0) + override.value;
    }
  }
  if (!state.writable) for (const feature of Object.keys(features) as PlanFeature[])
    features[feature] = ["CUSTOMER_DATABASE", "BASIC_REPORTS", "CSV_EXPORT", "MANUAL_PAYMENTS"].includes(feature);
  const calendarStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const period = subscription && !state.legacy
    ? monthlyUsagePeriod(subscription.currentPeriodStart, subscription.currentPeriodEnd, now)
    : { start: calendarStart, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
  const trialDaysRemaining = subscription?.trialEnd ? Math.max(0, Math.ceil((subscription.trialEnd.getTime() - now.getTime()) / 86_400_000)) : 0;
  return { ...state, features, limits, period, subscription, organization, overrides, trialDaysRemaining };
}
export async function organizationBillingAccess(db: BookingDatabase, organizationId: string, now = new Date()) {
  const [row] = await db.select({ organization: organizations, subscription: organizationSubscriptions,
    overrides: billingOverridesSelection(organizations.id, now) }).from(organizations)
    .leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!row) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  return resolveOrganizationBillingAccess(row.organization, row.subscription, row.overrides, now);
}
export async function assertOrganizationOperational(db: BookingDatabase, organizationId: string, now = new Date()) {
  const access = await organizationBillingAccess(db, organizationId, now);
  if (!access.writable) throw new BookingError("VENUE_UNAVAILABLE", "Online booking is temporarily unavailable.");
  return access;
}
