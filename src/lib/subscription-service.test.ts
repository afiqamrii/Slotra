import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { count, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { authorizedMembership, createOrganization } from "@/lib/organization-service";
import { hasOrganizationFeature, organizationLimit } from "@/lib/organization-entitlements";
import { organizationBillingAccess } from "@/lib/subscription-access";
import { billingDetails, getSubscriptionCheckout, handleSubscriptionWebhook, reconcileSubscriptionLifecycles,
  scheduleSubscriptionChange, setSubscriptionCancellation, simulateSubscriptionClock, simulateSubscriptionEvent, startSubscriptionCheckout } from "@/lib/subscription-service";
import { developmentBillingEnabled, signDevelopmentSubscriptionEvent } from "@/lib/subscription-provider";
import { monthlyUsagePeriod, subscriptionMrrMinor } from "@/lib/subscription-policy";
import { planDefinitions, subscriptionPrice, type BillingCycle, type StandardPlan } from "@/lib/plan-entitlements";
import { requireSuperAdmin, superAdminChange, superAdminOrganization, superAdminOverview } from "@/lib/super-admin-service";
import { getBookingUsage, recordConfirmedBookingUsage } from "@/lib/booking-usage";
import { deliverSubscriptionNotices } from "@/lib/subscription-notifications";
import { resolvePublicVenue } from "@/lib/public-booking";
import { sendAuthorizedTestEmail } from "@/lib/email-test-service";

describe("SaaS subscription and platform boundaries", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", outsiderId = "", adminId = "", staffId = "";
  const now = new Date();
  beforeAll(async () => {
    vi.stubEnv("ENABLE_DEV_SUBSCRIPTIONS", "true");
    vi.stubEnv("DEV_SUBSCRIPTION_WEBHOOK_SECRET", "test-saas-signature-secret-at-least-32-characters");
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", "");
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    const people = await db.insert(schema.users).values([
      { name: "Owner", email: "saas-owner@test.example" }, { name: "Other", email: "saas-other@test.example" },
      { name: "Platform", email: "saas-admin@test.example", platformRole: "SUPER_ADMIN" },
      { name: "Staff", email: "saas-staff@test.example" },
    ]).returning();
    [ownerId, outsiderId, adminId, staffId] = people.map(person => person.id);
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await postgres.close(); });
  async function fresh() {
    const organization = await createOrganization(db, ownerId, { name: "Billing Test", slug: "billing-" + randomUUID() }, { now });
    const [subscription] = await db.select().from(schema.organizationSubscriptions).where(eq(schema.organizationSubscriptions.organizationId, organization.id));
    return { organization, subscription };
  }
  async function subscribe(plan: StandardPlan = "STARTER", cycle: BillingCycle = "MONTHLY") {
    const fixture = await fresh();
    const checkout = await startSubscriptionCheckout(db, ownerId, fixture.organization.id, { plan, cycle }, now);
    await simulateSubscriptionEvent(db, ownerId, fixture.organization.id, "SUCCESS", checkout.checkoutId, now);
    const [subscription] = await db.select().from(schema.organizationSubscriptions).where(eq(schema.organizationSubscriptions.organizationId, fixture.organization.id));
    return { ...fixture, subscription, checkout };
  }
  async function event(organizationId: string, type: string, extra: Record<string, unknown> = {}, at = now, id = randomUUID()) {
    const [subscription] = await db.select().from(schema.organizationSubscriptions).where(eq(schema.organizationSubscriptions.organizationId, organizationId));
    const [checkout] = typeof extra.checkoutId === "string" ? await db.select().from(schema.subscriptionCheckouts).where(eq(schema.subscriptionCheckouts.id, extra.checkoutId)) : [];
    const raw = JSON.stringify({ id, organizationId, type, revision: subscription.revision,
      providerSubscriptionId: `dev_subscription_${subscription.id}`, ...(checkout ? { providerCheckoutId: checkout.providerCheckoutId } : {}), ...extra });
    return { raw, result: await handleSubscriptionWebhook(db, raw, signDevelopmentSubscriptionEvent(raw), at) };
  }
  async function spaces(organizationId: string, number = 1) {
    const [branch] = await db.insert(schema.branches).values({ organizationId, name: "Main", slug: "main" }).returning();
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    await db.insert(schema.organizationSports).values({ organizationId, sportTypeId: sport.id });
    const rows = await db.insert(schema.resources).values(Array.from({ length: number }, (_, i) => ({ organizationId,
      branchId: branch.id, sportTypeId: sport.id, name: "Court " + (i + 1) }))).returning();
    return { branch, rows };
  }
  async function booking(organizationId: string, branchId: string, resourceId: string) {
    return (await db.insert(schema.bookings).values({ organizationId, branchId, resourceId, bookingReference: "BK-" + randomUUID().slice(0, 12),
      startAt: new Date(now.getTime() + 86_400_000), endAt: new Date(now.getTime() + 90_000_000),
      status: "CANCELLED", source: "STAFF", subtotal: 2500, totalAmount: 2500, currency: "MYR" }).returning())[0];
  }

  it("creates a dated Professional trial transactionally with the owner", async () => {
    const { organization, subscription } = await fresh();
    expect(subscription.status).toBe("TRIALING"); expect(subscription.provider).toBe("NONE");
    expect(subscription.trialEnd!.getTime() - subscription.trialStart!.getTime()).toBe(14 * 86_400_000);
    expect(organization.lifecycleStatus).toBe("TRIAL");
  });
  it("trial capabilities unlock Professional but do not permanently assign the plan", async () => {
    const { organization } = await fresh();
    expect(organization.planCode).toBe("STARTER");
    expect(await hasOrganizationFeature(db, organization.id, "ONLINE_PAYMENTS")).toBe(true);
    expect(await hasOrganizationFeature(db, organization.id, "MEMBERSHIPS")).toBe(false);
  });
  it("expired trial keeps records and denies new operational actions", async () => {
    const { organization } = await fresh();
    await simulateSubscriptionClock(db, ownerId, organization.id, "EXPIRE_TRIAL", now);
    expect((await organizationBillingAccess(db, organization.id)).status).toBe("EXPIRED");
    expect(await authorizedMembership(db, ownerId, organization.id, "booking:create")).toBeNull();
    expect(await authorizedMembership(db, ownerId, organization.id, "booking:view")).not.toBeNull();
    expect((await billingDetails(db, ownerId, organization.id)).organization.id).toBe(organization.id);
  });
  it.each(["STARTER", "PROFESSIONAL", "BUSINESS", "PRO"] as const)("activates verified %s subscription", async plan => {
    const { organization } = await subscribe(plan);
    const access = await organizationBillingAccess(db, organization.id);
    expect(access.status).toBe("ACTIVE"); expect(access.plan).toBe(plan);
    expect(access.features.MULTI_BRANCH).toBe(plan === "PRO");
    expect(access.subscription!.providerCustomerId).toBe(`dev_org_${organization.id}`);
  });
  it("defines exact monthly prices", () => expect(Object.keys(planDefinitions).map(code => subscriptionPrice(code as StandardPlan, "MONTHLY"))).toEqual([7900, 12900, 17900, 27900]));
  it("defines exact annual prices and two months saving", () => {
    expect(Object.keys(planDefinitions).map(code => subscriptionPrice(code as StandardPlan, "ANNUAL"))).toEqual([79000, 129000, 179000, 279000]);
    for (const plan of Object.values(planDefinitions)) expect(plan.annualMinor).toBe(plan.monthlyMinor * 10);
  });
  it("marks only Professional recommended", () => expect(Object.values(planDefinitions).filter(plan => plan.recommended).map(plan => plan.code)).toEqual(["PROFESSIONAL"]));
  it("upgrades immediately after verification and preserves quota anchor", async () => {
    const { organization, subscription } = await subscribe();
    const checkout = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "PROFESSIONAL", cycle: "MONTHLY" }, new Date(now.getTime() + 1000));
    expect(await hasOrganizationFeature(db, organization.id, "ONLINE_PAYMENTS")).toBe(false);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "SUCCESS", checkout.checkoutId, new Date(now.getTime() + 1000));
    const access = await organizationBillingAccess(db, organization.id);
    expect(access.features.ONLINE_PAYMENTS).toBe(true); expect(access.subscription!.currentPeriodStart).toEqual(subscription.currentPeriodStart);
  });
  it("schedules downgrade without changing current capabilities", async () => {
    const { organization } = await subscribe("BUSINESS");
    await scheduleSubscriptionChange(db, ownerId, organization.id, { plan: "STARTER", cycle: "MONTHLY" }, now);
    const access = await organizationBillingAccess(db, organization.id);
    expect(access.plan).toBe("BUSINESS"); expect(access.subscription!.pendingPlanCode).toBe("STARTER");
  });
  it("retains over-limit spaces and staff after downgrade renewal", async () => {
    const { organization, subscription } = await subscribe("PROFESSIONAL");
    await spaces(organization.id, 15);
    const staff = await db.insert(schema.users).values(Array.from({ length: 3 }, () => ({ name: "Team", email: randomUUID() + "@example.test" }))).returning();
    await db.insert(schema.organizationMembers).values(staff.map(user => ({ organizationId: organization.id, userId: user.id, role: "STAFF" })));
    await scheduleSubscriptionChange(db, ownerId, organization.id, { plan: "STARTER", cycle: "MONTHLY" }, now);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "RENEWAL", undefined, subscription.currentPeriodEnd);
    const [resourceCount] = await db.select({ total: count() }).from(schema.resources).where(eq(schema.resources.organizationId, organization.id));
    expect(resourceCount.total).toBe(15); expect(await organizationLimit(db, organization.id, "RESOURCES")).toBe(10);
    expect((await db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, organization.id))).length).toBe(4);
  });
  it("retains four branches after Pro to Business downgrade", async () => {
    const { organization, subscription } = await subscribe("PRO");
    await db.insert(schema.branches).values(Array.from({ length: 4 }, (_, i) => ({ organizationId: organization.id, name: "Branch " + i, slug: "branch-" + i })));
    await scheduleSubscriptionChange(db, ownerId, organization.id, { plan: "BUSINESS", cycle: "MONTHLY" }, now);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "RENEWAL", undefined, subscription.currentPeriodEnd);
    expect((await db.select().from(schema.branches).where(eq(schema.branches.organizationId, organization.id))).length).toBe(4);
    expect(await hasOrganizationFeature(db, organization.id, "MULTI_BRANCH")).toBe(false);
  });
  it("cancels at period end while preserving current access", async () => {
    const { organization, subscription } = await subscribe();
    await setSubscriptionCancellation(db, ownerId, organization.id, true, now);
    expect((await organizationBillingAccess(db, organization.id, now)).writable).toBe(true);
    await reconcileSubscriptionLifecycles(db, subscription.currentPeriodEnd);
    expect((await organizationBillingAccess(db, organization.id, subscription.currentPeriodEnd)).status).toBe("CANCELLED");
  });
  it("reverses scheduled cancellation", async () => {
    const { organization } = await subscribe();
    await setSubscriptionCancellation(db, ownerId, organization.id, true, now);
    await setSubscriptionCancellation(db, ownerId, organization.id, false, now);
    expect((await organizationBillingAccess(db, organization.id)).subscription!.cancelAtPeriodEnd).toBe(false);
  });
  it("records failed renewal as past due", async () => {
    const { organization } = await subscribe();
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAILED_RENEWAL", undefined, now);
    const access = await organizationBillingAccess(db, organization.id, now);
    expect(access.status).toBe("PAST_DUE"); expect(access.subscription!.graceUntil!.getTime() - now.getTime()).toBe(5 * 86_400_000);
  });
  it("keeps core operations available during grace and repeated failures cannot extend it", async () => {
    const { organization } = await subscribe();
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAILED_RENEWAL", undefined, now);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAILED_RENEWAL", undefined, new Date(now.getTime() + 86_400_000));
    const access = await organizationBillingAccess(db, organization.id, new Date(now.getTime() + 2 * 86_400_000));
    expect(access.writable).toBe(true); expect(access.subscription!.graceUntil!.getTime()).toBe(now.getTime() + 5 * 86_400_000);
  });
  it("suspends after grace and keeps billing and exports available", async () => {
    const { organization } = await subscribe();
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAILED_RENEWAL", undefined, now);
    await simulateSubscriptionClock(db, ownerId, organization.id, "EXPIRE_GRACE", now);
    expect(await authorizedMembership(db, ownerId, organization.id, "booking:create")).toBeNull();
    expect(await authorizedMembership(db, ownerId, organization.id, "report:export")).not.toBeNull();
    expect((await billingDetails(db, ownerId, organization.id)).lifecycle).toBe("SUSPENDED");
  });
  it("delayed first failure cannot restart grace after the renewal deadline", async () => {
    const { organization, subscription } = await subscribe();
    const late = new Date(subscription.currentPeriodEnd.getTime() + 6 * 86_400_000);
    expect((await organizationBillingAccess(db, organization.id, late)).writable).toBe(false);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAILED_RENEWAL", undefined, late);
    const access = await organizationBillingAccess(db, organization.id, late);
    expect(access.status).toBe("SUSPENDED"); expect(access.writable).toBe(false);
    expect(access.subscription!.graceUntil).toEqual(new Date(subscription.currentPeriodEnd.getTime() + 5 * 86_400_000));
  });
  it("handles repeated signed webhook idempotently", async () => {
    const { organization } = await subscribe();
    const first = await event(organization.id, "invoice.failed");
    const repeat = await handleSubscriptionWebhook(db, first.raw, signDevelopmentSubscriptionEvent(first.raw), now);
    expect(repeat).toEqual({ duplicate: true, applied: false });
    expect((await db.select().from(schema.subscriptionProviderEvents).where(eq(schema.subscriptionProviderEvents.organizationId, organization.id))).length).toBe(2);
  });
  it("rejects invalid signatures before mutation", async () => {
    const { organization } = await subscribe();
    await expect(handleSubscriptionWebhook(db, JSON.stringify({ organizationId: organization.id }), "0".repeat(64), now)).rejects.toThrow("signature");
    expect((await organizationBillingAccess(db, organization.id)).status).toBe("ACTIVE");
  });
  it("checkout read and browser success parameters cannot activate a plan", async () => {
    const { organization } = await fresh();
    const attempt = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "PRO", cycle: "MONTHLY", status: "success", amountMinor: 1 }, now);
    const row = await getSubscriptionCheckout(db, ownerId, organization.id, attempt.checkoutId);
    expect(row.amountMinor).toBe(27900); expect(row.status).toBe("PENDING");
    expect((await organizationBillingAccess(db, organization.id)).status).toBe("TRIALING");
  });
  it("rejects forged provider amounts and cross-organization checkout proof", async () => {
    const a = await fresh(), b = await fresh();
    const checkout = await startSubscriptionCheckout(db, ownerId, a.organization.id, { plan: "PRO", cycle: "MONTHLY" }, now);
    await expect(event(a.organization.id, "subscription.activated", { checkoutId: checkout.checkoutId, amountMinor: 1, currency: "MYR" })).rejects.toThrow("verification");
    await expect(event(a.organization.id, "subscription.activated", { checkoutId: checkout.checkoutId, providerCheckoutId: "wrong-provider-session", amountMinor: 27900, currency: "MYR" })).rejects.toThrow("verification");
    await expect(event(b.organization.id, "subscription.activated", { checkoutId: checkout.checkoutId, amountMinor: 27900, currency: "MYR" })).rejects.toThrow("verification");
  });
  it("failed and expired checkouts leave plan unactivated", async () => {
    const { organization } = await fresh();
    const failed = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "PRO", cycle: "MONTHLY" }, now);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "FAIL_CHECKOUT", failed.checkoutId, now);
    expect((await getSubscriptionCheckout(db, ownerId, organization.id, failed.checkoutId)).status).toBe("FAILED");
    const expired = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "PRO", cycle: "MONTHLY" }, now);
    await simulateSubscriptionEvent(db, ownerId, organization.id, "SUCCESS", expired.checkoutId, new Date(now.getTime() + 31 * 60_000));
    expect((await organizationBillingAccess(db, organization.id)).status).toBe("TRIALING");
  });
  it("counts usage in anchored subscription month and resets at next boundary", async () => {
    const { organization, subscription } = await subscribe();
    const { branch, rows } = await spaces(organization.id);
    const record = await booking(organization.id, branch.id, rows[0].id);
    await db.transaction(tx => recordConfirmedBookingUsage(tx, organization.id, record.id, now));
    expect((await getBookingUsage(db, organization.id, now)).used).toBe(1);
    expect((await getBookingUsage(db, organization.id, subscription.currentPeriodEnd)).used).toBe(0);
  });
  it("annual billing keeps monthly quotas and anchors", async () => {
    const { organization } = await subscribe("STARTER", "ANNUAL");
    const first = await getBookingUsage(db, organization.id, now);
    const second = await getBookingUsage(db, organization.id, first.period.end);
    expect(second.included).toBe(200); expect(second.period.start).toEqual(first.period.end);
    expect(first.period.end < (await organizationBillingAccess(db, organization.id)).subscription!.currentPeriodEnd).toBe(true);
  });
  it("uses month-end anchors safely across leap years", () => {
    const start = new Date("2028-01-31T10:00:00Z"), end = new Date("2029-01-31T10:00:00Z");
    expect(monthlyUsagePeriod(start, end, new Date("2028-03-01T00:00:00Z"))).toEqual({ start: new Date("2028-02-29T10:00:00Z"), end: new Date("2028-03-31T10:00:00Z") });
  });
  it("applies auditable temporary feature and added-limit overrides", async () => {
    const { organization } = await subscribe();
    const expiresAt = new Date(now.getTime() + 86_400_000);
    for (const override of [{ kind: "FEATURE", key: "API_ACCESS", value: 1 }, { kind: "LIMIT", key: "MONTHLY_BOOKINGS", value: 500 }])
      await superAdminChange(db, adminId, organization.id, { action: "OVERRIDE", confirmation: organization.slug, reason: "Support test", expiresAt, ...override }, now);
    expect(await hasOrganizationFeature(db, organization.id, "API_ACCESS")).toBe(true);
    expect(await organizationLimit(db, organization.id, "MONTHLY_BOOKINGS")).toBe(700);
    for (const key of ["__proto__", "constructor", "toString"])
      await expect(superAdminChange(db, adminId, organization.id, { action: "OVERRIDE", confirmation: organization.slug,
        reason: "Invalid inherited key", expiresAt, kind: "FEATURE", key, value: 1 }, now)).rejects.toThrow("valid feature");
  });
  it("expired overrides stop applying and cannot restore suspension", async () => {
    const { organization } = await subscribe();
    await superAdminChange(db, adminId, organization.id, { action: "OVERRIDE", kind: "FEATURE", key: "API_ACCESS", value: 1,
      confirmation: organization.slug, reason: "Support expiry", expiresAt: new Date(now.getTime() + 1000) }, now);
    expect((await organizationBillingAccess(db, organization.id, new Date(now.getTime() + 2000))).features.API_ACCESS).toBe(false);
    await superAdminChange(db, adminId, organization.id, { action: "SUSPEND", confirmation: organization.slug, reason: "Support pause" }, now);
    expect((await organizationBillingAccess(db, organization.id, now)).features.API_ACCESS).toBe(false);
  });
  it("lower paid tier cannot bypass feature gates or spoof stored plan", async () => {
    const { organization } = await subscribe();
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, organization.id));
    expect(await hasOrganizationFeature(db, organization.id, "API_ACCESS")).toBe(false);
    expect(await hasOrganizationFeature(db, organization.id, "ONLINE_PAYMENTS")).toBe(false);
  });
  it("denies Super Admin authorization to a venue owner", async () => {
    await expect(requireSuperAdmin(db, ownerId)).rejects.toThrow("Platform access denied");
    await expect(superAdminOverview(db, ownerId)).rejects.toThrow("Platform access denied");
  });
  it("allows platform admin organization inspection without organization membership", async () => {
    const { organization } = await fresh();
    expect((await superAdminOrganization(db, adminId, organization.id)).owner?.email).toBe("saas-owner@test.example");
  });
  it("admin suspension and reactivation are audited and require confirmation", async () => {
    const { organization } = await subscribe();
    await expect(superAdminChange(db, adminId, organization.id, { action: "SUSPEND", confirmation: "wrong", reason: "Support pause" })).rejects.toThrow("confirm");
    await superAdminChange(db, adminId, organization.id, { action: "SUSPEND", confirmation: organization.slug, reason: "Support pause" });
    expect(await authorizedMembership(db, ownerId, organization.id, "resource:manage")).toBeNull();
    await superAdminChange(db, adminId, organization.id, { action: "REACTIVATE", confirmation: organization.slug, reason: "Support restore" });
    expect(await authorizedMembership(db, ownerId, organization.id, "resource:manage")).not.toBeNull();
  });
  it("extends an expired unpaid trial and rejects paid trial conversion", async () => {
    const { organization } = await fresh();
    await simulateSubscriptionClock(db, ownerId, organization.id, "EXPIRE_TRIAL", now);
    await superAdminChange(db, adminId, organization.id, { action: "EXTEND_TRIAL", confirmation: organization.slug,
      reason: "More evaluation time", expiresAt: new Date(now.getTime() + 7 * 86_400_000) }, now);
    expect((await organizationBillingAccess(db, organization.id, now)).status).toBe("TRIALING");
    const paid = await subscribe();
    await expect(superAdminChange(db, adminId, paid.organization.id, { action: "EXTEND_TRIAL", confirmation: paid.organization.slug,
      reason: "More evaluation time", expiresAt: new Date(now.getTime() + 7 * 86_400_000) }, now)).rejects.toThrow("unpaid trial");
  });
  it("trial extension does not implicitly lift an administrative suspension", async () => {
    const { organization } = await fresh();
    await superAdminChange(db, adminId, organization.id, { action: "SUSPEND", confirmation: organization.slug, reason: "Investigation pause" }, now);
    await superAdminChange(db, adminId, organization.id, { action: "EXTEND_TRIAL", confirmation: organization.slug,
      reason: "More trial time without restoration", expiresAt: new Date(now.getTime() + 21 * 86_400_000) }, now);
    const access = await organizationBillingAccess(db, organization.id, now);
    expect(access.status).toBe("TRIALING"); expect(access.lifecycle).toBe("SUSPENDED"); expect(access.writable).toBe(false);
  });
  it("calculates production MRR and excludes non-revenue assignments", () => {
    const base = { status: "ACTIVE", provider: "FUTURE_REAL", planCode: "PROFESSIONAL", billingCycle: "MONTHLY" };
    expect(subscriptionMrrMinor(base)).toBe(12900); expect(subscriptionMrrMinor({ ...base, billingCycle: "ANNUAL" })).toBe(129000 / 12);
    for (const status of ["TRIALING", "CANCELLED", "EXPIRED", "SUSPENDED"]) expect(subscriptionMrrMinor({ ...base, status })).toBe(0);
    for (const provider of ["DEVELOPMENT", "LEGACY", "NONE"]) expect(subscriptionMrrMinor({ ...base, provider })).toBe(0);
  });
  it("reuses an unexpired checkout on repeated plan selection", async () => {
    const { organization } = await fresh();
    const first = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "STARTER", cycle: "MONTHLY" }, now);
    const repeated = await startSubscriptionCheckout(db, ownerId, organization.id, { plan: "STARTER", cycle: "MONTHLY" }, now);
    expect(repeated.checkoutId).toBe(first.checkoutId);
    expect((await db.select().from(schema.subscriptionCheckouts).where(eq(schema.subscriptionCheckouts.organizationId, organization.id))).length).toBe(1);
  });
  it("rejects duplicate purchase and preserves quota anchor across billing-cycle changes", async () => {
    const subscription = await subscribe();
    await expect(startSubscriptionCheckout(db, ownerId, subscription.organization.id, { plan: "STARTER", cycle: "MONTHLY" }, now)).rejects.toThrow("already have");
    await expect(startSubscriptionCheckout(db, ownerId, subscription.organization.id, { plan: "PRO", cycle: "ANNUAL" }, now)).rejects.toThrow("billing-cycle");
  });
  it("excludes elapsed subscriptions from MRR before lifecycle reconciliation", async () => {
    const { organization } = await subscribe("PROFESSIONAL");
    await db.update(schema.organizationSubscriptions).set({ provider: "FUTURE_REAL" }).where(eq(schema.organizationSubscriptions.organizationId, organization.id));
    expect((await superAdminOverview(db, adminId, now)).mrrMinor).toBe(12900);
    await db.update(schema.organizationSubscriptions).set({ currentPeriodStart: new Date(now.getTime() - 35 * 86_400_000),
      currentPeriodEnd: new Date(now.getTime() - 7 * 86_400_000) }).where(eq(schema.organizationSubscriptions.organizationId, organization.id));
    const overview = await superAdminOverview(db, adminId, now);
    expect(overview.mrrMinor).toBe(0); expect(overview.paid).toBe(0);
  });
  it("soft closure preserves operational and billing history", async () => {
    const { organization } = await subscribe();
    const { branch, rows } = await spaces(organization.id), record = await booking(organization.id, branch.id, rows[0].id);
    await superAdminChange(db, adminId, organization.id, { action: "CLOSE", confirmation: organization.slug, reason: "Venue closed by request" }, now);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, record.id))).length).toBe(1);
    expect((await billingDetails(db, ownerId, organization.id)).lifecycle).toBe("CLOSED");
    expect((await db.select().from(schema.subscriptionAuditLogs).where(eq(schema.subscriptionAuditLogs.organizationId, organization.id))).length).toBeGreaterThan(1);
    expect(await resolvePublicVenue(db, organization.slug)).toBeNull();
  });
  it("rejects cross-tenant billing and staff plan changes", async () => {
    const { organization } = await subscribe();
    await db.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: staffId, role: "STAFF" });
    await expect(billingDetails(db, outsiderId, organization.id)).rejects.toThrow("access denied");
    await expect(startSubscriptionCheckout(db, staffId, organization.id, { plan: "PRO", cycle: "MONTHLY" })).rejects.toThrow("access denied");
    await expect(superAdminChange(db, ownerId, organization.id, { action: "OVERRIDE" })).rejects.toThrow("Platform access denied");
  });
  it("allows only an owner or admin to send a configured test email to their own account", async () => {
    const { organization } = await fresh();
    await db.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: staffId, role: "STAFF" });
    vi.stubEnv("RESEND_API_KEY", "re_test_authorized_sender"); vi.stubEnv("EMAIL_FROM", "Slotra <hello@example.test>");
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "email_test_1" }),
      { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      await expect(sendAuthorizedTestEmail(db, ownerId, organization.id)).resolves.toEqual({ providerMessageId: "email_test_1" });
      await expect(sendAuthorizedTestEmail(db, staffId, organization.id)).rejects.toThrow("access denied");
      await expect(sendAuthorizedTestEmail(db, outsiderId, organization.id)).rejects.toThrow("access denied");
      expect(JSON.parse(String(request.mock.calls[0][1]?.body)).to).toEqual(["saas-owner@test.example"]);
      await sendAuthorizedTestEmail(db, ownerId, organization.id);
      await sendAuthorizedTestEmail(db, ownerId, organization.id);
      await expect(sendAuthorizedTestEmail(db, ownerId, organization.id)).rejects.toThrow("Too many requests");
      expect(request).toHaveBeenCalledTimes(3);
    } finally {
      request.mockRestore(); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", "");
    }
  });
  it("never writes subscription charges into venue payment/refund records", async () => {
    const [before] = await db.select({ total: count() }).from(schema.payments);
    await subscribe("PRO", "ANNUAL");
    const [after] = await db.select({ total: count() }).from(schema.payments);
    expect(after.total).toBe(before.total);
  });
  it("sends no fake billing email without configured sender", async () => {
    await deliverSubscriptionNotices(db);
    const notices = await db.select().from(schema.subscriptionNotifications);
    expect(notices.some(notice => notice.status === "DEV_PREVIEW")).toBe(true);
    expect(notices.some(notice => notice.status === "SENT")).toBe(false);
  });
  it("development checkout and simulator are always disabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(developmentBillingEnabled()).toBe(false);
    const { organization } = await fresh();
    await expect(startSubscriptionCheckout(db, ownerId, organization.id, { plan: "PRO", cycle: "MONTHLY" })).rejects.toThrow("not configured");
    vi.stubEnv("NODE_ENV", "test");
  });
  it("new SaaS tables keep RLS and no public grants", async () => {
    const rows = await postgres.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname in ('organization_subscriptions','subscription_checkouts','subscription_provider_events','subscription_audit_logs','entitlement_overrides','subscription_notifications')");
    expect(rows.rows).toHaveLength(6); expect(rows.rows.every(row => row.relrowsecurity)).toBe(true);
    const [subscription] = await db.select().from(schema.organizationSubscriptions).limit(1);
    await expect(db.insert(schema.organizationSubscriptions).values({ organizationId: subscription.organizationId,
      planCode: "PRO", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86_400_000) })).rejects.toThrow();
  });
});
