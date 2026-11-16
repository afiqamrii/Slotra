import { and, eq } from "drizzle-orm";
import { organizations, organizationSubscriptions, subscriptionNotifications } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { deliverEmail } from "@/lib/email-delivery";
import { subscriptionEmailTemplate } from "@/lib/email-templates";
import { planDefinitions, type StandardPlan } from "@/lib/plan-entitlements";

export async function deliverSubscriptionNotices(db: BookingDatabase, deadlineAt = Number.POSITIVE_INFINITY) {
  const pending = await db.select({ notice: subscriptionNotifications, venueName: organizations.name,
    displayName: organizations.displayName, subscription: organizationSubscriptions }).from(subscriptionNotifications)
    .innerJoin(organizations, eq(organizations.id, subscriptionNotifications.organizationId))
    .innerJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
    .where(eq(subscriptionNotifications.status, "PENDING"))
    .orderBy(subscriptionNotifications.createdAt).limit(100);
  let processed = 0;
  for (const row of pending) {
    if (Date.now() >= deadlineAt) break;
    const notice = row.notice;
    const [claim] = await db.update(subscriptionNotifications).set({ status: "PROCESSING", updatedAt: new Date() })
      .where(and(eq(subscriptionNotifications.id, notice.id), eq(subscriptionNotifications.status, "PENDING"))).returning();
    if (!claim) continue;
    const plan = planDefinitions[row.subscription.planCode as StandardPlan];
    const template = subscriptionEmailTemplate({ type: notice.type, venueName: row.displayName || row.venueName,
      planName: plan?.name ?? row.subscription.planCode, status: row.subscription.status.replaceAll("_", " "),
      periodEnd: row.subscription.currentPeriodEnd.toISOString(), trialEnd: row.subscription.trialEnd?.toISOString() });
    try {
      const result = await deliverEmail({ to: notice.recipient, ...template, idempotencyKey: `saas:${notice.id}` });
      await db.update(subscriptionNotifications).set({ status: result.status, providerMessageId: result.providerMessageId,
        failureReason: result.reason, updatedAt: new Date() }).where(eq(subscriptionNotifications.id, notice.id));
    } catch {
      await db.update(subscriptionNotifications).set({ status: "FAILED", failureReason: "Email could not be delivered.", updatedAt: new Date() })
        .where(eq(subscriptionNotifications.id, notice.id));
    }
    processed++;
  }
  return { processed };
}
