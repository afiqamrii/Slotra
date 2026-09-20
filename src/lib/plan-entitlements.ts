export type StandardPlan = "STARTER" | "PROFESSIONAL" | "BUSINESS" | "PRO";
export type PlanFeature = "PUBLIC_BOOKING" | "WALK_IN_BOOKING" | "CUSTOMER_DATABASE" |
  "BASIC_REPORTS" | "CSV_EXPORT" | "MANUAL_PAYMENTS" | "ONLINE_PAYMENTS" | "DEPOSITS" |
  "ONLINE_REFUNDS" | "ADVANCED_ANALYTICS" | "MEMBERSHIPS" | "PACKAGES" |
  "WHATSAPP" | "AUTOMATIONS" | "MULTI_BRANCH" | "CUSTOM_DOMAIN" | "API_ACCESS";
export type PlanLimit = "MONTHLY_BOOKINGS" | "BRANCHES" | "RESOURCES" | "OWNER_SEATS" | "STAFF_SEATS";

type Features = Readonly<Record<PlanFeature, boolean>>;
type Limits = Readonly<Record<PlanLimit, number | null>>;
const starter: Features = {
  PUBLIC_BOOKING: true, WALK_IN_BOOKING: true, CUSTOMER_DATABASE: true, BASIC_REPORTS: true,
  CSV_EXPORT: true, MANUAL_PAYMENTS: true, ONLINE_PAYMENTS: false, DEPOSITS: false,
  ONLINE_REFUNDS: false, ADVANCED_ANALYTICS: false, MEMBERSHIPS: false, PACKAGES: false,
  WHATSAPP: false, AUTOMATIONS: false, MULTI_BRANCH: false, CUSTOM_DOMAIN: false, API_ACCESS: false,
};
const professional: Features = { ...starter, ONLINE_PAYMENTS: true, DEPOSITS: true, ONLINE_REFUNDS: true };
const business: Features = { ...professional };
const pro: Features = { ...business, MULTI_BRANCH: true };

// null means the cap is not finalized here; it does not promise unlimited commercial use.
export const planLimits: Readonly<Record<StandardPlan, Limits>> = {
  STARTER: { MONTHLY_BOOKINGS: 200, BRANCHES: 1, RESOURCES: 10, OWNER_SEATS: 1, STAFF_SEATS: 1 },
  PROFESSIONAL: { MONTHLY_BOOKINGS: 1000, BRANCHES: 1, RESOURCES: null, OWNER_SEATS: 1, STAFF_SEATS: null },
  BUSINESS: { MONTHLY_BOOKINGS: 3000, BRANCHES: 1, RESOURCES: null, OWNER_SEATS: 1, STAFF_SEATS: null },
  PRO: { MONTHLY_BOOKINGS: 10000, BRANCHES: null, RESOURCES: null, OWNER_SEATS: 1, STAFF_SEATS: null },
};

// Payment entitlements are enforced server-side; subscription billing remains a later phase.
export const planFeatures: Readonly<Record<StandardPlan, Features>> = {
  STARTER: starter,
  PROFESSIONAL: professional,
  BUSINESS: business,
  PRO: pro,
};
export function planHasFeature(plan: StandardPlan, feature: PlanFeature) {
  return planFeatures[plan][feature];
}
export function planLimit(plan: StandardPlan, limit: PlanLimit) {
  return planLimits[plan][limit];
}
