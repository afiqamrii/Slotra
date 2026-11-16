import { Temporal } from "@js-temporal/polyfill";
import { planDefinitions, type BillingCycle, type StandardPlan } from "@/lib/plan-entitlements";

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE" | "CANCELLED" | "EXPIRED" | "SUSPENDED";
export type LifecycleStatus = "ACTIVE" | "TRIAL" | "GRACE" | "SUSPENDED" | "CLOSED";
function boundedDays(value: string | undefined, fallback: number, max: number) {
  const days = Number(value ?? fallback);
  return Number.isInteger(days) && days >= 1 && days <= max ? days : fallback;
}
export function trialDays() { return boundedDays(process.env.SAAS_TRIAL_DAYS, 14, 90); }
export function graceDays() { return boundedDays(process.env.SAAS_GRACE_DAYS, 5, 14); }
export function addUtcMonths(at: Date, months: number) {
  return new Date(Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO("UTC")
    .add({ months }).epochMilliseconds);
}
export function billingPeriod(start: Date, cycle: BillingCycle) {
  return { start, end: addUtcMonths(start, cycle === "ANNUAL" ? 12 : 1) };
}
export function monthlyUsagePeriod(start: Date, end: Date, at: Date) {
  if (end <= start) throw new Error("Invalid subscription period");
  let index = Math.max(0, (at.getUTCFullYear() - start.getUTCFullYear()) * 12 + at.getUTCMonth() - start.getUTCMonth());
  while (index > 0 && addUtcMonths(start, index) > at) index--;
  while (addUtcMonths(start, index + 1) <= at) index++;
  const periodStart = addUtcMonths(start, index);
  const periodEnd = addUtcMonths(start, index + 1);
  return { start: periodStart, end: at >= end ? periodEnd : periodEnd < end ? periodEnd : end };
}
export type SubscriptionSnapshot = {
  planCode: string; status: string; provider: string; billingCycle: string;
  currentPeriodStart: Date; currentPeriodEnd: Date; trialEnd: Date | null;
  graceUntil: Date | null; cancelAtPeriodEnd: boolean;
};
export function effectiveSubscription(subscription: SubscriptionSnapshot | null,
  organization: { planCode: string; lifecycleStatus: string; lifecycleSource: string }, now = new Date()) {
  const legacy = !subscription || subscription.provider === "LEGACY";
  let status = (subscription?.status ?? "ACTIVE") as SubscriptionStatus;
  if (status === "TRIALING" && (!subscription?.trialEnd || subscription.trialEnd <= now)) status = "EXPIRED";
  if (!legacy && status === "ACTIVE" && subscription!.currentPeriodEnd <= now) {
    status = subscription!.cancelAtPeriodEnd ? "CANCELLED" : "GRACE";
  }
  if (["PAST_DUE", "GRACE"].includes(status) && subscription) {
    const grace = subscription.graceUntil ?? new Date(subscription.currentPeriodEnd.getTime() + graceDays() * 86_400_000);
    if (grace <= now) status = "SUSPENDED";
  }
  const adminRestricted = organization.lifecycleStatus === "CLOSED" ||
    (organization.lifecycleSource === "ADMIN" && organization.lifecycleStatus === "SUSPENDED");
  const writable = !adminRestricted && ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(status);
  const plan = (status === "TRIALING" ? "PROFESSIONAL" : legacy ? organization.planCode : subscription!.planCode) as StandardPlan;
  if (!planDefinitions[plan]) throw new Error("Unknown subscription plan");
  const lifecycle: LifecycleStatus = organization.lifecycleStatus === "CLOSED" ? "CLOSED" :
    !writable ? "SUSPENDED" : status === "TRIALING" ? "TRIAL" :
      ["PAST_DUE", "GRACE"].includes(status) ? "GRACE" : "ACTIVE";
  return { plan, status, lifecycle, writable, legacy };
}
export function subscriptionMrrMinor(subscription: { status: string; provider: string; planCode: string; billingCycle: string }) {
  if (subscription.status !== "ACTIVE" || ["DEVELOPMENT", "LEGACY", "NONE"].includes(subscription.provider)) return 0;
  const plan = planDefinitions[subscription.planCode as StandardPlan];
  if (!plan) return 0;
  return subscription.billingCycle === "ANNUAL" ? plan.annualMinor / 12 : plan.monthlyMinor;
}
