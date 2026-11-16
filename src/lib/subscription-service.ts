import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { organizationMembers, organizations, organizationSubscriptions, subscriptionCheckouts,
  subscriptionProviderEvents, subscriptionAuditLogs } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { planDefinitions, subscriptionPrice, type BillingCycle, type StandardPlan } from "@/lib/plan-entitlements";
import { organizationBillingAccess } from "@/lib/subscription-access";
import { addUtcMonths, billingPeriod, effectiveSubscription, graceDays, trialDays } from "@/lib/subscription-policy";
import { queueSubscriptionNotice, subscriptionAudit } from "@/lib/subscription-records";
import { developmentBillingEnabled, signDevelopmentSubscriptionEvent, subscriptionBillingProvider } from "@/lib/subscription-provider";

const choiceInput = z.object({ plan: z.enum(["STARTER", "PROFESSIONAL", "BUSINESS", "PRO"]), cycle: z.enum(["MONTHLY", "ANNUAL"]) });
export async function assertBillingAccess(db: BookingDatabase, actorId: string, organizationId: string, write = false) {
  z.uuid().parse(organizationId);
  const [member] = await db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, actorId),
    eq(organizationMembers.status, "ACTIVE"))).limit(1);
  if (!member || (write ? member.role !== "OWNER" : !["OWNER", "ADMIN"].includes(member.role)))
    throw new Error("Billing access denied.");
}
export async function billingDetails(db: BookingDatabase, actorId: string, organizationId: string, now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId);
  const access = await organizationBillingAccess(db, organizationId, now);
  const history = await db.select().from(subscriptionAuditLogs).where(eq(subscriptionAuditLogs.organizationId, organizationId))
    .orderBy(desc(subscriptionAuditLogs.createdAt)).limit(30);
  return { ...access, history };
}
async function lockSubscription(db: BookingDatabase, organizationId: string) {
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
  const [subscription] = await db.select().from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId)).for("update").limit(1);
  if (!organization || !subscription) throw new Error("Subscription not found.");
  return { organization, subscription };
}
export async function startSubscriptionCheckout(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId, true);
  const input = choiceInput.parse(raw), provider = subscriptionBillingProvider();
  const checkout = await db.transaction(async tx => {
    const { organization, subscription } = await lockSubscription(tx, organizationId);
    if (organization.lifecycleStatus === "CLOSED" || (organization.lifecycleSource === "ADMIN" && organization.lifecycleStatus === "SUSPENDED"))
      throw new Error("Contact support to reactivate this venue.");
    const state = effectiveSubscription(subscription, organization, now);
    if (state.status === "ACTIVE" && !state.legacy && planDefinitions[input.plan].order < planDefinitions[state.plan].order)
      throw new Error("Schedule a downgrade for the next renewal.");
    if (state.status === "ACTIVE" && !state.legacy && input.plan === state.plan && input.cycle === subscription.billingCycle)
      throw new Error("You already have this subscription.");
    if (state.status === "ACTIVE" && !state.legacy && input.cycle !== subscription.billingCycle)
      throw new Error("Schedule billing-cycle changes for the next renewal.");
    const [pending] = await tx.select().from(subscriptionCheckouts).where(and(
      eq(subscriptionCheckouts.organizationId, organizationId), eq(subscriptionCheckouts.subscriptionId, subscription.id),
      eq(subscriptionCheckouts.subscriptionRevision, subscription.revision), eq(subscriptionCheckouts.provider, provider.code),
      eq(subscriptionCheckouts.targetPlanCode, input.plan), eq(subscriptionCheckouts.billingCycle, input.cycle),
      eq(subscriptionCheckouts.status, "PENDING"), gt(subscriptionCheckouts.expiresAt, now)))
      .orderBy(desc(subscriptionCheckouts.createdAt)).limit(1);
    if (pending) return pending;
    const [attempt] = await tx.insert(subscriptionCheckouts).values({ organizationId, subscriptionId: subscription.id,
      createdByUserId: actorId, targetPlanCode: input.plan, billingCycle: input.cycle,
      amountMinor: subscriptionPrice(input.plan, input.cycle), provider: provider.code, subscriptionRevision: subscription.revision,
      expiresAt: new Date(now.getTime() + 30 * 60_000) }).returning();
    return attempt;
  });
  try {
    const session = await provider.createCheckout({ checkoutId: checkout.id, organizationId, plan: input.plan,
      cycle: input.cycle, amountMinor: checkout.amountMinor });
    await db.update(subscriptionCheckouts).set({ providerCheckoutId: session.id, updatedAt: now })
      .where(and(eq(subscriptionCheckouts.id, checkout.id), eq(subscriptionCheckouts.organizationId, organizationId)));
    return { checkoutId: checkout.id, url: session.url };
  } catch {
    await db.update(subscriptionCheckouts).set({ status: "FAILED", updatedAt: now }).where(and(
      eq(subscriptionCheckouts.id, checkout.id), eq(subscriptionCheckouts.organizationId, organizationId),
      eq(subscriptionCheckouts.status, "PENDING"), isNull(subscriptionCheckouts.providerCheckoutId)));
    throw new Error("We couldn't start subscription checkout. No payment was collected.");
  }
}
export async function getSubscriptionCheckout(db: BookingDatabase, actorId: string, organizationId: string, id: string) {
  await assertBillingAccess(db, actorId, organizationId, true); z.uuid().parse(id);
  const [checkout] = await db.select().from(subscriptionCheckouts).where(and(
    eq(subscriptionCheckouts.organizationId, organizationId), eq(subscriptionCheckouts.id, id))).limit(1);
  if (!checkout) throw new Error("Checkout not found.");
  return checkout;
}
export async function scheduleSubscriptionChange(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId, true);
  const input = choiceInput.parse(raw), provider = subscriptionBillingProvider();
  const access = await organizationBillingAccess(db, organizationId, now);
  if (!access.subscription || access.status !== "ACTIVE" || access.legacy) throw new Error("Choose a subscription first.");
  await provider.updateSubscription({ id: access.subscription.providerSubscriptionId!, plan: input.plan, cycle: input.cycle, atPeriodEnd: true });
  return db.transaction(async tx => {
    const { subscription } = await lockSubscription(tx, organizationId);
    if (subscription.revision !== access.subscription!.revision) throw new Error("Subscription changed. Please try again.");
    await tx.update(organizationSubscriptions).set({ pendingPlanCode: input.plan, pendingBillingCycle: input.cycle,
      revision: subscription.revision + 1, updatedAt: now }).where(eq(organizationSubscriptions.id, subscription.id));
    await subscriptionAudit(tx, organizationId, actorId, "plan.change_scheduled", { from: subscription.planCode,
      to: input.plan, cycle: input.cycle, effectiveAt: subscription.currentPeriodEnd.toISOString() }, now);
    await queueSubscriptionNotice(tx, organizationId, "plan.change_scheduled", `change:${subscription.id}:${subscription.revision + 1}`);
  });
}
export async function setSubscriptionCancellation(db: BookingDatabase, actorId: string, organizationId: string, cancel: boolean, now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId, true);
  const provider = subscriptionBillingProvider(), access = await organizationBillingAccess(db, organizationId, now);
  if (!access.subscription || access.legacy || !["ACTIVE", "PAST_DUE", "GRACE"].includes(access.status)) throw new Error("No active subscription to change.");
  await provider.cancelSubscription({ id: access.subscription.providerSubscriptionId!, cancelAtPeriodEnd: cancel });
  await db.transaction(async tx => {
    const { subscription } = await lockSubscription(tx, organizationId);
    if (subscription.revision !== access.subscription!.revision) throw new Error("Subscription changed. Please try again.");
    if (subscription.cancelAtPeriodEnd === cancel) return;
    await tx.update(organizationSubscriptions).set({ cancelAtPeriodEnd: cancel, cancelledAt: cancel ? now : null,
      revision: subscription.revision + 1, updatedAt: now }).where(eq(organizationSubscriptions.id, subscription.id));
    await subscriptionAudit(tx, organizationId, actorId, cancel ? "cancellation.scheduled" : "cancellation.reversed", {}, now);
    await queueSubscriptionNotice(tx, organizationId, cancel ? "cancellation.scheduled" : "cancellation.reversed",
      `cancel:${subscription.id}:${subscription.revision + 1}`);
  });
}

// Raw body verification precedes event parsing and database access. Browser return pages never call this.
export async function handleSubscriptionWebhook(db: BookingDatabase, raw: string, signature: string, now = new Date()) {
  const provider = subscriptionBillingProvider(), event = provider.verifyWebhook(raw, signature);
  return db.transaction(async tx => {
    const { organization, subscription } = await lockSubscription(tx, event.organizationId);
    const [claimed] = await tx.insert(subscriptionProviderEvents).values({ organizationId: event.organizationId,
      provider: provider.code, providerEventId: event.id, eventType: event.type }).onConflictDoNothing().returning();
    if (!claimed) return { duplicate: true, applied: false };
    const ignore = async () => {
      await tx.update(subscriptionProviderEvents).set({ outcome: "IGNORED" }).where(eq(subscriptionProviderEvents.id, claimed.id));
      return { duplicate: false, applied: false };
    };
    if (subscription.revision !== event.revision || organization.lifecycleStatus === "CLOSED") return ignore();
    let noticeType: string = event.type;
    if (event.type === "subscription.activated") {
      if (!event.checkoutId) throw new Error("Checkout proof is required.");
      const [checkout] = await tx.select().from(subscriptionCheckouts).where(and(
        eq(subscriptionCheckouts.organizationId, event.organizationId), eq(subscriptionCheckouts.id, event.checkoutId)))
        .for("update").limit(1);
      if (!checkout || checkout.subscriptionId !== subscription.id || checkout.status !== "PENDING" ||
        checkout.provider !== provider.code || !checkout.providerCheckoutId || checkout.subscriptionRevision !== event.revision)
        throw new Error("Checkout verification failed.");
      if (checkout.expiresAt <= now) {
        await tx.update(subscriptionCheckouts).set({ status: "EXPIRED", updatedAt: now }).where(eq(subscriptionCheckouts.id, checkout.id));
        return ignore();
      }
      if (event.amountMinor !== checkout.amountMinor || event.currency !== checkout.currency ||
        event.providerCheckoutId !== checkout.providerCheckoutId) throw new Error("Payment verification failed.");
      const existingState = effectiveSubscription(subscription, organization, now);
      noticeType = existingState.status === "ACTIVE" && !existingState.legacy &&
        planDefinitions[checkout.targetPlanCode as StandardPlan].order > planDefinitions[existingState.plan].order
        ? "plan.upgraded" : "subscription.started";
      const period = existingState.status === "ACTIVE" && !existingState.legacy && checkout.billingCycle === subscription.billingCycle
        ? { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd }
        : billingPeriod(now, checkout.billingCycle as BillingCycle);
      await tx.update(organizationSubscriptions).set({ planCode: checkout.targetPlanCode, billingCycle: checkout.billingCycle,
        provider: provider.code, providerSubscriptionId: event.providerSubscriptionId, providerCustomerId: event.providerCustomerId ?? null,
        status: "ACTIVE", currentPeriodStart: period.start, currentPeriodEnd: period.end, graceUntil: null,
        cancelAtPeriodEnd: false, cancelledAt: null, endedAt: null, pendingPlanCode: null, pendingBillingCycle: null,
        revision: subscription.revision + 1, updatedAt: now }).where(eq(organizationSubscriptions.id, subscription.id));
      await tx.update(subscriptionCheckouts).set({ status: "SUCCEEDED", updatedAt: now }).where(eq(subscriptionCheckouts.id, checkout.id));
      await tx.update(organizations).set({ planCode: checkout.targetPlanCode,
        ...(organization.lifecycleSource !== "ADMIN" ? { lifecycleStatus: "ACTIVE" } : {}), updatedAt: now }).where(eq(organizations.id, event.organizationId));
      await subscriptionAudit(tx, event.organizationId, null, "subscription.activated", { from: subscription.planCode,
        plan: checkout.targetPlanCode, cycle: checkout.billingCycle, amountMinor: checkout.amountMinor, provider: provider.code }, now);
    } else {
      if (subscription.provider !== provider.code || subscription.providerSubscriptionId !== event.providerSubscriptionId) throw new Error("Subscription verification failed.");
      if (event.type === "trial.ending") {
        await queueSubscriptionNotice(tx, event.organizationId, "trial.ending", event.id);
        return { duplicate: false, applied: true };
      }
      if (event.type === "invoice.failed") {
        noticeType = "payment.failed";
        if (!["ACTIVE", "PAST_DUE", "GRACE"].includes(subscription.status)) return ignore();
        // A delayed failure must not reopen an already exhausted renewal grace window.
        const graceUntil = subscription.graceUntil ?? new Date(Math.min(now.getTime(), subscription.currentPeriodEnd.getTime()) + graceDays() * 86_400_000);
        const failedState = effectiveSubscription({ ...subscription, status: "PAST_DUE", graceUntil }, organization, now);
        await tx.update(organizationSubscriptions).set({ status: failedState.status, graceUntil,
          ...(!failedState.writable ? { endedAt: now } : {}), revision: subscription.revision + 1, updatedAt: now })
          .where(eq(organizationSubscriptions.id, subscription.id));
        if (organization.lifecycleSource !== "ADMIN") await tx.update(organizations).set({ lifecycleStatus: failedState.lifecycle, updatedAt: now }).where(eq(organizations.id, event.organizationId));
        await subscriptionAudit(tx, event.organizationId, null, "renewal.failed", {}, now);
        if (failedState.status === "SUSPENDED") await subscriptionAudit(tx, event.organizationId, null, "subscription.suspended", { reason: "renewal_grace_expired" }, now);
      } else {
        if (subscription.cancelAtPeriodEnd || now < subscription.currentPeriodEnd || subscription.status === "CANCELLED") return ignore();
        const plan = (subscription.pendingPlanCode ?? subscription.planCode) as StandardPlan;
        const cycle = (subscription.pendingBillingCycle ?? subscription.billingCycle) as BillingCycle;
        noticeType = planDefinitions[plan].order < planDefinitions[subscription.planCode as StandardPlan].order
          ? "plan.downgraded" : "subscription.renewed";
        if (event.amountMinor !== subscriptionPrice(plan, cycle) || event.currency !== "MYR") throw new Error("Renewal amount mismatch.");
        // Renew from the previous boundary; delayed payments do not move quota anchors.
        const period = billingPeriod(subscription.currentPeriodEnd, cycle);
        if (period.end <= now) return ignore();
        await tx.update(organizationSubscriptions).set({ planCode: plan, billingCycle: cycle, status: "ACTIVE",
          currentPeriodStart: period.start, currentPeriodEnd: period.end, pendingPlanCode: null,
          pendingBillingCycle: null, graceUntil: null, endedAt: null, revision: subscription.revision + 1, updatedAt: now })
          .where(eq(organizationSubscriptions.id, subscription.id));
        await tx.update(organizations).set({ planCode: plan,
          ...(organization.lifecycleSource !== "ADMIN" ? { lifecycleStatus: "ACTIVE" } : {}), updatedAt: now }).where(eq(organizations.id, event.organizationId));
        await subscriptionAudit(tx, event.organizationId, null, "renewal.succeeded", { plan, cycle }, now);
      }
    }
    await queueSubscriptionNotice(tx, event.organizationId, noticeType, event.id);
    return { duplicate: false, applied: true };
  });
}

export async function simulateSubscriptionEvent(db: BookingDatabase, actorId: string, organizationId: string,
  action: "SUCCESS" | "FAILED_RENEWAL" | "RENEWAL" | "FAIL_CHECKOUT", checkoutId?: string, now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId, true);
  if (!developmentBillingEnabled()) throw new Error("Development simulator is unavailable.");
  const access = await organizationBillingAccess(db, organizationId, now), subscription = access.subscription;
  if (!subscription) throw new Error("Subscription not found.");
  let checkout;
  if (checkoutId) checkout = await getSubscriptionCheckout(db, actorId, organizationId, checkoutId);
  if (action === "FAIL_CHECKOUT") {
    if (!checkout) throw new Error("Checkout not found.");
    await db.update(subscriptionCheckouts).set({ status: "FAILED", updatedAt: now }).where(and(
      eq(subscriptionCheckouts.id, checkout.id), eq(subscriptionCheckouts.organizationId, organizationId), eq(subscriptionCheckouts.status, "PENDING")));
    return { duplicate: false, applied: false };
  }
  if (action === "SUCCESS" && !checkout) throw new Error("Checkout not found.");
  const plan = (checkout?.targetPlanCode ?? subscription.pendingPlanCode ?? subscription.planCode) as StandardPlan;
  const cycle = (checkout?.billingCycle ?? subscription.pendingBillingCycle ?? subscription.billingCycle) as BillingCycle;
  const event = { id: randomUUID(), organizationId, providerSubscriptionId: `dev_subscription_${subscription.id}`, providerCustomerId: `dev_org_${organizationId}`,
    revision: subscription.revision, type: action === "SUCCESS" ? "subscription.activated" : action === "RENEWAL" ? "subscription.renewed" : "invoice.failed",
    ...(checkout ? { checkoutId: checkout.id, providerCheckoutId: checkout.providerCheckoutId } : {}), amountMinor: subscriptionPrice(plan, cycle), currency: "MYR" };
  const raw = JSON.stringify(event);
  return handleSubscriptionWebhook(db, raw, signDevelopmentSubscriptionEvent(raw), now);
}

export async function simulateSubscriptionClock(db: BookingDatabase, actorId: string, organizationId: string,
  action: "START_TRIAL" | "RENEWAL_DUE" | "EXPIRE_TRIAL" | "EXPIRE_GRACE", now = new Date()) {
  await assertBillingAccess(db, actorId, organizationId, true);
  if (!developmentBillingEnabled()) throw new Error("Development simulator is unavailable.");
  await db.transaction(async tx => {
    const { subscription, organization } = await lockSubscription(tx, organizationId);
    if (!["NONE", "LEGACY", "DEVELOPMENT"].includes(subscription.provider) || organization.lifecycleSource === "ADMIN")
      throw new Error("Only development subscriptions can simulate time.");
    const end = new Date(now.getTime() - 1000);
    if (action === "START_TRIAL") {
      const trialEnd = new Date(now.getTime() + trialDays() * 86_400_000);
      await tx.update(organizationSubscriptions).set({ status: "TRIALING", provider: "NONE", planCode: "PROFESSIONAL", billingCycle: "MONTHLY",
        providerSubscriptionId: null, providerCustomerId: null, currentPeriodStart: now, currentPeriodEnd: trialEnd, trialStart: now,
        trialEnd, endedAt: null, cancelAtPeriodEnd: false, cancelledAt: null, graceUntil: null, pendingPlanCode: null, pendingBillingCycle: null,
        revision: subscription.revision + 1, updatedAt: now }).where(eq(organizationSubscriptions.id, subscription.id));
      await tx.update(organizations).set({ lifecycleStatus: "TRIAL", lifecycleSource: "SUBSCRIPTION", updatedAt: now }).where(eq(organizations.id, organizationId));
    } else if (action === "EXPIRE_TRIAL") {
      if (subscription.status !== "TRIALING") throw new Error("No trial to expire.");
      await tx.update(organizationSubscriptions).set({ trialStart: new Date(end.getTime() - trialDays() * 86_400_000), trialEnd: end,
        currentPeriodStart: new Date(end.getTime() - trialDays() * 86_400_000), currentPeriodEnd: end, revision: subscription.revision + 1, updatedAt: now })
        .where(eq(organizationSubscriptions.id, subscription.id));
    } else if (action === "RENEWAL_DUE") {
      if (subscription.provider !== "DEVELOPMENT") throw new Error("Choose a development subscription first.");
      const start = addUtcMonths(end, subscription.billingCycle === "ANNUAL" ? -12 : -1);
      await tx.update(organizationSubscriptions).set({ currentPeriodStart: start, currentPeriodEnd: end,
        revision: subscription.revision + 1, updatedAt: now }).where(eq(organizationSubscriptions.id, subscription.id));
    } else {
      if (!["PAST_DUE", "GRACE"].includes(subscription.status)) throw new Error("No grace period to expire.");
      await tx.update(organizationSubscriptions).set({ graceUntil: end, revision: subscription.revision + 1, updatedAt: now })
        .where(eq(organizationSubscriptions.id, subscription.id));
    }
    await subscriptionAudit(tx, organizationId, actorId, "development.clock_changed", { action }, now);
  });
  return reconcileSubscriptionLifecycles(db, now);
}

export async function reconcileSubscriptionLifecycles(db: BookingDatabase, now = new Date()) {
  const candidates = await db.select({ organizationId: organizationSubscriptions.organizationId }).from(organizationSubscriptions)
    .where(sql`${organizationSubscriptions.status} in ('TRIALING','ACTIVE','PAST_DUE','GRACE') and ${organizationSubscriptions.provider} <> 'LEGACY'
      and (${organizationSubscriptions.currentPeriodEnd} <= ${now} or ${organizationSubscriptions.graceUntil} <= ${now}
        or (${organizationSubscriptions.status} = 'TRIALING' and ${organizationSubscriptions.trialEnd} <= ${new Date(now.getTime() + 3 * 86_400_000)}))`)
    .orderBy(organizationSubscriptions.currentPeriodEnd).limit(200);
  let changed = 0;
  for (const candidate of candidates) await db.transaction(async tx => {
    const { organization, subscription } = await lockSubscription(tx, candidate.organizationId);
    const state = effectiveSubscription(subscription, organization, now);
    if (state.status !== subscription.status) {
      await tx.update(organizationSubscriptions).set({ status: state.status,
        ...(state.status === "GRACE" ? { graceUntil: new Date(subscription.currentPeriodEnd.getTime() + graceDays() * 86_400_000) } : {}),
        ...(!state.writable ? { endedAt: now } : {}), revision: subscription.revision + 1, updatedAt: now })
        .where(eq(organizationSubscriptions.id, subscription.id));
      if (organization.lifecycleSource !== "ADMIN") await tx.update(organizations).set({ lifecycleStatus: state.lifecycle, updatedAt: now })
        .where(eq(organizations.id, organization.id));
      await subscriptionAudit(tx, organization.id, null, `subscription.${state.status.toLowerCase()}`, {}, now);
      changed++;
    }
    if (organization.lifecycleStatus !== "CLOSED" && subscription.status === "TRIALING" && subscription.trialEnd && subscription.trialEnd > now && subscription.trialEnd.getTime() - now.getTime() <= 3 * 86_400_000)
      await queueSubscriptionNotice(tx, organization.id, "trial.ending", `trial-ending:${subscription.id}:${subscription.trialEnd.toISOString()}`);
  });
  return { scanned: candidates.length, changed };
}
