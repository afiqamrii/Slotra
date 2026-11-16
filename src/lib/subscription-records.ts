import { and, eq } from "drizzle-orm";
import { organizationMembers, organizationSubscriptions, subscriptionAuditLogs, subscriptionNotifications, users } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { trialDays } from "@/lib/subscription-policy";

export async function subscriptionAudit(db: BookingDatabase, organizationId: string, actorId: string | null,
  action: string, details: Record<string, string | number | boolean | null> = {}, now = new Date()) {
  await db.insert(subscriptionAuditLogs).values({ organizationId, actorUserId: actorId, action, details, createdAt: now });
}
export async function queueSubscriptionNotice(db: BookingDatabase, organizationId: string, type: string, eventKey: string) {
  const owners = await db.select({ email: users.email }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId)).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "OWNER"),
      eq(organizationMembers.status, "ACTIVE")));
  for (const owner of owners) await db.insert(subscriptionNotifications).values({ organizationId, type, eventKey,
    recipient: owner.email }).onConflictDoNothing();
}
export async function createOrganizationTrial(db: BookingDatabase, organizationId: string, actorId: string, now = new Date()) {
  const end = new Date(now.getTime() + trialDays() * 86_400_000);
  await db.insert(organizationSubscriptions).values({ organizationId, planCode: "PROFESSIONAL", status: "TRIALING",
    provider: "NONE", billingCycle: "MONTHLY", currentPeriodStart: now, currentPeriodEnd: end,
    trialStart: now, trialEnd: end });
  await subscriptionAudit(db, organizationId, actorId, "trial.started", { days: trialDays(), endsAt: end.toISOString() }, now);
}
