export type StandardPlan = "STARTER" | "PROFESSIONAL" | "BUSINESS" | "PRO";
export type PlanFeature = "PUBLIC_BOOKING" | "WALK_IN_BOOKING" | "CUSTOMER_DATABASE" |
  "BASIC_REPORTS" | "CSV_EXPORT" | "MANUAL_PAYMENTS" | "ONLINE_PAYMENTS" | "DEPOSITS" |
  "ONLINE_REFUNDS" | "ADVANCED_ANALYTICS" | "ADVANCED_REPORTS" | "SCHEDULED_REPORTS" | "MEMBERSHIPS" | "PACKAGES" |
  "WHATSAPP" | "AUTOMATIONS" | "MULTI_BRANCH" | "CUSTOM_DOMAIN" | "API_ACCESS" |
  "WHITE_LABEL" | "ADVANCED_PERMISSIONS" | "AUDIT_LOGS" | "WEBHOOKS" |
  "CORPORATE_ACCOUNTS" | "EXECUTIVE_REPORTS" | "BRANCH_COMPARISON" |
  "DYNAMIC_PRICING" | "RECURRING_BOOKINGS" | "CREDITS" | "PROMOTIONS" |
  "WAITLIST" | "QR_CHECK_IN" | "CUSTOMER_SEGMENTATION" | "RETENTION_TOOLS" |
  "ADVANCED_BOOKING_RULES";
export type PlanLimit = "MONTHLY_BOOKINGS" | "BRANCHES" | "RESOURCES" | "OWNER_SEATS" | "STAFF_SEATS";

type Features = Readonly<Record<PlanFeature, boolean>>;
type Limits = Readonly<Record<PlanLimit, number | null>>;
const starter: Features = {
  PUBLIC_BOOKING: true, WALK_IN_BOOKING: true, CUSTOMER_DATABASE: true, BASIC_REPORTS: true,
  CSV_EXPORT: true, MANUAL_PAYMENTS: true, ONLINE_PAYMENTS: false, DEPOSITS: false,
  ONLINE_REFUNDS: false, ADVANCED_ANALYTICS: false, ADVANCED_REPORTS: false, SCHEDULED_REPORTS: false, MEMBERSHIPS: false, PACKAGES: false,
  WHATSAPP: false, AUTOMATIONS: false, MULTI_BRANCH: false, CUSTOM_DOMAIN: false, API_ACCESS: false,
  WHITE_LABEL: false, ADVANCED_PERMISSIONS: false, AUDIT_LOGS: false, WEBHOOKS: false,
  CORPORATE_ACCOUNTS: false, EXECUTIVE_REPORTS: false, BRANCH_COMPARISON: false,
  DYNAMIC_PRICING: false, RECURRING_BOOKINGS: false, CREDITS: false, PROMOTIONS: false,
  WAITLIST: false, QR_CHECK_IN: false, CUSTOMER_SEGMENTATION: false, RETENTION_TOOLS: false,
  ADVANCED_BOOKING_RULES: false,
};
const professional: Features = { ...starter, ONLINE_PAYMENTS: true, DEPOSITS: true, ONLINE_REFUNDS: true,
  ADVANCED_ANALYTICS: true, ADVANCED_REPORTS: true, SCHEDULED_REPORTS: true };
const business: Features = { ...professional, DYNAMIC_PRICING: true, RECURRING_BOOKINGS: true,
  MEMBERSHIPS: true, PACKAGES: true, CREDITS: true, PROMOTIONS: true, WAITLIST: true,
  QR_CHECK_IN: true, WHATSAPP: true, AUTOMATIONS: true, CUSTOMER_SEGMENTATION: true,
  RETENTION_TOOLS: true, ADVANCED_BOOKING_RULES: true };
const pro: Features = { ...business, MULTI_BRANCH: true, CUSTOM_DOMAIN: true, WHITE_LABEL: true,
  ADVANCED_PERMISSIONS: true, AUDIT_LOGS: true, API_ACCESS: true, WEBHOOKS: true,
  CORPORATE_ACCOUNTS: true, EXECUTIVE_REPORTS: true, BRANCH_COMPARISON: true };

// null means the cap is not finalized here; it does not promise unlimited commercial use.
export const planLimits: Readonly<Record<StandardPlan, Limits>> = {
  STARTER: { MONTHLY_BOOKINGS: 200, BRANCHES: 1, RESOURCES: 10, OWNER_SEATS: 1, STAFF_SEATS: 1 },
  PROFESSIONAL: { MONTHLY_BOOKINGS: 1000, BRANCHES: 1, RESOURCES: 20, OWNER_SEATS: 1, STAFF_SEATS: 3 },
  BUSINESS: { MONTHLY_BOOKINGS: 3000, BRANCHES: 1, RESOURCES: 50, OWNER_SEATS: 1, STAFF_SEATS: 5 },
  PRO: { MONTHLY_BOOKINGS: 10000, BRANCHES: 5, RESOURCES: 1000, OWNER_SEATS: 1, STAFF_SEATS: 15 },
};

// Shared, browser-safe commercial catalog. Server services resolve subscription state first.
export const planFeatures: Readonly<Record<StandardPlan, Features>> = {
  STARTER: starter,
  PROFESSIONAL: professional,
  BUSINESS: business,
  PRO: pro,
};
export const planDefinitions = {
  STARTER: { code: "STARTER", name: "Starter", monthlyMinor: 7900, annualMinor: 79000, recommended: false, order: 0, limits: planLimits.STARTER, features: starter },
  PROFESSIONAL: { code: "PROFESSIONAL", name: "Professional", monthlyMinor: 12900, annualMinor: 129000, recommended: true, order: 1, limits: planLimits.PROFESSIONAL, features: professional },
  BUSINESS: { code: "BUSINESS", name: "Business", monthlyMinor: 17900, annualMinor: 179000, recommended: false, order: 2, limits: planLimits.BUSINESS, features: business },
  PRO: { code: "PRO", name: "Pro", monthlyMinor: 27900, annualMinor: 279000, recommended: false, order: 3, limits: planLimits.PRO, features: pro },
} as const;
export type BillingCycle = "MONTHLY" | "ANNUAL";
export function subscriptionPrice(plan: StandardPlan, cycle: BillingCycle) {
  return cycle === "ANNUAL" ? planDefinitions[plan].annualMinor : planDefinitions[plan].monthlyMinor;
}
export function planHasFeature(plan: StandardPlan, feature: PlanFeature) {
  return planFeatures[plan][feature];
}
export function planLimit(plan: StandardPlan, limit: PlanLimit) {
  return planLimits[plan][limit];
}
