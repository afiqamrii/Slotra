import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { bookings, entitlementOverrides, organizations, organizationMembers,
  organizationSubscriptions, subscriptionAuditLogs, users } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { organizationBillingAccess } from "@/lib/subscription-access";
import { planDefinitions, planFeatures, planLimits, type PlanFeature, type PlanLimit } from "@/lib/plan-entitlements";
import { graceDays, subscriptionMrrMinor } from "@/lib/subscription-policy";
import { subscriptionAudit } from "@/lib/subscription-records";
import { starterPlanUsage } from "@/lib/starter-reporting";

export async function requireSuperAdmin(db: BookingDatabase, actorId: string) {
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, actorId), eq(users.platformRole, "SUPER_ADMIN"))).limit(1);
  if (!actor) throw new Error("Platform access denied.");
  return actor;
}
export async function superAdminOverview(db: BookingDatabase, actorId: string, now = new Date()) {
  await requireSuperAdmin(db, actorId);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Aggregate effective state in SQL, so metrics remain correct before the scheduled runner catches up.
  const effectiveStatus = sql<string>`case
    when ${organizationSubscriptions.status} = 'TRIALING' and ${organizationSubscriptions.trialEnd} <= ${now} then 'EXPIRED'
    when ${organizationSubscriptions.status} = 'ACTIVE' and ${organizationSubscriptions.provider} <> 'LEGACY' and ${organizationSubscriptions.currentPeriodEnd} <= ${now}
      then case when ${organizationSubscriptions.cancelAtPeriodEnd} then 'CANCELLED'
        when ${organizationSubscriptions.currentPeriodEnd} + ${graceDays()} * interval '1 day' <= ${now} then 'SUSPENDED' else 'GRACE' end
    when ${organizationSubscriptions.status} in ('PAST_DUE','GRACE') and coalesce(${organizationSubscriptions.graceUntil}, ${organizationSubscriptions.currentPeriodEnd} + ${graceDays()} * interval '1 day') <= ${now} then 'SUSPENDED'
    else coalesce(${organizationSubscriptions.status}, 'ACTIVE') end`;
  const effective = db.select({ status: effectiveStatus.as("effective_status"),
    planCode: sql<string>`coalesce(${organizationSubscriptions.planCode}, ${organizations.planCode})`.as("effective_plan"),
    billingCycle: organizationSubscriptions.billingCycle, provider: organizationSubscriptions.provider,
    lifecycle: sql<string>`case when ${organizations.lifecycleStatus} = 'CLOSED' then 'CLOSED'
      when ${organizations.lifecycleSource} = 'ADMIN' and ${organizations.lifecycleStatus} = 'SUSPENDED' then 'SUSPENDED'
      when (${effectiveStatus}) in ('EXPIRED','CANCELLED','SUSPENDED') then 'SUSPENDED'
      when (${effectiveStatus}) = 'TRIALING' then 'TRIAL'
      when (${effectiveStatus}) in ('PAST_DUE','GRACE') then 'GRACE' else 'ACTIVE' end`.as("effective_lifecycle") })
    .from(organizations).leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id)).as("effective_billing");
  const [lifecycle, subscriptions, bookingCount] = await Promise.all([
    db.select({ status: effective.lifecycle, total: count() }).from(effective).groupBy(effective.lifecycle),
    db.select({ planCode: effective.planCode, status: effective.status, lifecycle: effective.lifecycle,
      billingCycle: sql<string>`coalesce(${effective.billingCycle}, 'MONTHLY')`, provider: sql<string>`coalesce(${effective.provider}, 'LEGACY')`, total: count() })
      .from(effective).groupBy(effective.planCode, effective.status, effective.lifecycle, effective.billingCycle, effective.provider),
    db.select({ total: count() }).from(bookings).where(and(gte(bookings.createdAt, month), lt(bookings.createdAt, now))),
  ]);
  const totalOrganizations = lifecycle.reduce((total, row) => total + row.total, 0);
  const mrrMinor = subscriptions.reduce((total, row) => total + (row.lifecycle === "ACTIVE" ? subscriptionMrrMinor(row) : 0) * row.total, 0);
  const distribution = Object.keys(planDefinitions).map(code => ({ code, total: subscriptions.filter(row => row.planCode === code && row.status !== "TRIALING").reduce((total, row) => total + row.total, 0) }));
  return { totalOrganizations, lifecycle, mrrMinor, distribution, bookingsThisMonth: bookingCount[0]?.total ?? 0,
    trialing: subscriptions.filter(row => row.status === "TRIALING" && row.lifecycle === "TRIAL").reduce((n, row) => n + row.total, 0),
    failed: subscriptions.filter(row => ["PAST_DUE", "GRACE"].includes(row.status)).reduce((n, row) => n + row.total, 0),
    paid: subscriptions.filter(row => row.status === "ACTIVE" && row.lifecycle === "ACTIVE" && !["NONE", "LEGACY", "DEVELOPMENT"].includes(row.provider)).reduce((n, row) => n + row.total, 0) };
}
export async function superAdminOrganizations(db: BookingDatabase, actorId: string, raw: unknown) {
  await requireSuperAdmin(db, actorId);
  const input = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), search: z.string().trim().max(100).default("") }).parse(raw);
  const rows = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug,
    lifecycleStatus: organizations.lifecycleStatus, createdAt: organizations.createdAt,
    planCode: organizationSubscriptions.planCode, status: organizationSubscriptions.status, provider: organizationSubscriptions.provider })
    .from(organizations).leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
    .where(input.search ? sql`(${organizations.name} ilike ${"%" + input.search.replaceAll("%", "\\%").replaceAll("_", "\\_") + "%"} or ${organizations.slug} = ${input.search})` : undefined)
    .orderBy(desc(organizations.createdAt)).limit(51).offset((input.page - 1) * 50);
  return { rows: rows.slice(0, 50), hasNext: rows.length > 50, page: input.page, search: input.search };
}
export async function superAdminOrganization(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireSuperAdmin(db, actorId); z.uuid().parse(organizationId);
  const [access, usage, owner, history] = await Promise.all([
    organizationBillingAccess(db, organizationId), starterPlanUsage(db, organizationId),
    db.select({ name: users.name, email: users.email }).from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id)).where(and(eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, "OWNER"), eq(organizationMembers.status, "ACTIVE"))).limit(1),
    db.select({ action: subscriptionAuditLogs.action, details: subscriptionAuditLogs.details, createdAt: subscriptionAuditLogs.createdAt,
      actor: users.name }).from(subscriptionAuditLogs).leftJoin(users, eq(users.id, subscriptionAuditLogs.actorUserId))
      .where(eq(subscriptionAuditLogs.organizationId, organizationId)).orderBy(desc(subscriptionAuditLogs.createdAt)).limit(50),
  ]);
  return { ...access, usage, owner: owner[0] ?? null, history };
}
const adminInput = z.object({ action: z.enum(["SUSPEND", "REACTIVATE", "CLOSE", "EXTEND_TRIAL", "OVERRIDE", "REVOKE_OVERRIDE"]),
  confirmation: z.string(), reason: z.string().trim().min(5).max(500),
  expiresAt: z.preprocess(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? value + ":00Z" : value, z.coerce.date()).optional(), kind: z.enum(["FEATURE", "LIMIT"]).optional(), key: z.string().max(60).optional(),
  value: z.coerce.number().int().min(0).max(100000).optional(), overrideId: z.uuid().optional() });
export async function superAdminChange(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  await requireSuperAdmin(db, actorId); z.uuid().parse(organizationId);
  const input = adminInput.parse(raw);
  return db.transaction(async tx => {
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!organization || input.confirmation !== organization.slug) throw new Error("Type the venue slug to confirm.");
    if (["OVERRIDE", "EXTEND_TRIAL"].includes(input.action) && (!input.expiresAt || input.expiresAt <= now || input.expiresAt.getTime() > now.getTime() + 90 * 86_400_000))
      throw new Error("Choose an expiry within the next 90 days.");
    if (input.action === "OVERRIDE") {
      if (!input.kind || !input.key || input.value === undefined ||
        (input.kind === "FEATURE" ? !Object.hasOwn(planFeatures.PRO, input.key) || input.value > 1 : !Object.hasOwn(planLimits.PRO, input.key)))
        throw new Error("Choose a valid feature or additional limit.");
      await tx.insert(entitlementOverrides).values({ organizationId, createdByUserId: actorId, kind: input.kind,
        key: input.key as PlanFeature | PlanLimit, value: input.value, reason: input.reason, expiresAt: input.expiresAt!, createdAt: now });
    } else if (input.action === "REVOKE_OVERRIDE") {
      if (!input.overrideId) throw new Error("Choose an override.");
      const rows = await tx.update(entitlementOverrides).set({ revokedAt: now }).where(and(
        eq(entitlementOverrides.organizationId, organizationId), eq(entitlementOverrides.id, input.overrideId))).returning();
      if (!rows.length) throw new Error("Override not found.");
    } else if (input.action === "EXTEND_TRIAL") {
      const [subscription] = await tx.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organizationId)).for("update").limit(1);
      if (!subscription || !subscription.trialStart || !["TRIALING", "EXPIRED", "SUSPENDED"].includes(subscription.status) || subscription.provider !== "NONE" || organization.lifecycleStatus === "CLOSED")
        throw new Error("Only an unpaid trial can be extended.");
      await tx.update(organizationSubscriptions).set({ status: "TRIALING", trialEnd: input.expiresAt,
        currentPeriodEnd: input.expiresAt, endedAt: null, revision: subscription.revision + 1, updatedAt: now })
        .where(eq(organizationSubscriptions.id, subscription.id));
      if (organization.lifecycleSource !== "ADMIN") await tx.update(organizations).set({ lifecycleStatus: "TRIAL", lifecycleSource: "SUBSCRIPTION", updatedAt: now }).where(eq(organizations.id, organizationId));
    } else {
      const lifecycleStatus = input.action === "SUSPEND" ? "SUSPENDED" : input.action === "CLOSE" ? "CLOSED" : "ACTIVE";
      await tx.update(organizations).set({ lifecycleStatus, lifecycleSource: input.action === "REACTIVATE" ? "SUBSCRIPTION" : "ADMIN", updatedAt: now })
        .where(eq(organizations.id, organizationId));
    }
    await subscriptionAudit(tx, organizationId, actorId, `admin.${input.action.toLowerCase()}`, { reason: input.reason,
      key: input.key ?? null, kind: input.kind ?? null, value: input.value ?? null, expiresAt: input.expiresAt?.toISOString() ?? null }, now);
  });
}
