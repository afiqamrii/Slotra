import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { BillingCycle, StandardPlan } from "@/lib/plan-entitlements";
import { isDevelopmentRuntime } from "@/lib/deployment-environment";

export const subscriptionEventInput = z.object({
  id: z.string().min(1).max(200), organizationId: z.uuid(), providerSubscriptionId: z.string().min(1).max(200),
  type: z.enum(["subscription.activated", "subscription.renewed", "invoice.failed", "trial.ending"]),
  revision: z.number().int().nonnegative(), checkoutId: z.uuid().optional(),
  providerCheckoutId: z.string().min(1).max(200).optional(),
  providerCustomerId: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().nonnegative().optional(), currency: z.literal("MYR").optional(),
});
export type SubscriptionProviderEvent = z.infer<typeof subscriptionEventInput>;
export interface SubscriptionBillingProvider {
  readonly code: string;
  // checkoutId is the provider idempotency key; repeated creation must return the same session.
  createCheckout(input: { checkoutId: string; organizationId: string; plan: StandardPlan; cycle: BillingCycle; amountMinor: number }): Promise<{ id: string; url: string }>;
  updateSubscription(input: { id: string; plan: StandardPlan; cycle: BillingCycle; atPeriodEnd: boolean }): Promise<void>;
  cancelSubscription(input: { id: string; cancelAtPeriodEnd: boolean }): Promise<void>;
  getSubscription(id: string): Promise<{ id: string; production: boolean }>;
  verifyWebhook(raw: string, signature: string): SubscriptionProviderEvent;
}
export function developmentBillingEnabled() {
  return isDevelopmentRuntime() && process.env.ENABLE_DEV_SUBSCRIPTIONS === "true" &&
    (process.env.DEV_SUBSCRIPTION_WEBHOOK_SECRET?.length ?? 0) >= 32;
}
function devSecret() {
  if (!developmentBillingEnabled()) throw new Error("Development subscription billing is unavailable.");
  return process.env.DEV_SUBSCRIPTION_WEBHOOK_SECRET!;
}
export function signDevelopmentSubscriptionEvent(raw: string) {
  return createHmac("sha256", devSecret()).update(raw).digest("hex");
}
export class DevelopmentSubscriptionProvider implements SubscriptionBillingProvider {
  readonly code = "DEVELOPMENT";
  async createCheckout(input: { checkoutId: string; organizationId: string; plan: StandardPlan; cycle: BillingCycle; amountMinor: number }) {
    devSecret();
    return { id: `dev_checkout_${input.checkoutId}`, url: `/settings/billing/checkout/${input.checkoutId}` };
  }
  async updateSubscription() { devSecret(); }
  async cancelSubscription() { devSecret(); }
  async getSubscription(id: string) { devSecret(); return { id, production: false }; }
  verifyWebhook(raw: string, signature: string) {
    const expected = signDevelopmentSubscriptionEvent(raw);
    if (raw.length > 8192 || !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex")))
      throw new Error("Invalid subscription webhook signature.");
    return subscriptionEventInput.parse(JSON.parse(raw));
  }
}
export function subscriptionBillingProvider(): SubscriptionBillingProvider {
  if (!developmentBillingEnabled()) throw new Error("Subscription checkout is not configured.");
  return new DevelopmentSubscriptionProvider();
}
