import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createBooking, quoteReschedule, rescheduleBooking, transitionBooking } from "@/lib/booking-service";
import { publicAvailability, publicConfirmation, resolvePublicVenue, submitPublicBooking } from "@/lib/public-booking";
import { paymentDue } from "@/lib/payment-policy";
import { recentPaymentActivity } from "@/lib/payment-activity";
import { paymentWorkspace, paymentWorkspaceFilters } from "@/lib/payment-workspace";
import { manualProvider, signTestEvent } from "@/lib/payment-providers";
import { handleToyyibSandboxCallback, reconcileToyyibSandboxPayment } from "@/lib/toyyibpay-service";
import { connectTestAccount, disconnectTestAccount, connectToyyibSandboxAccount, handleTestWebhook, paymentHistory,
  processPaymentEvent, recordManualPayment, requestRefund, savePaymentPolicy, sweepExpiredHolds,
  testEvent } from "@/lib/payment-service";

describe("customer booking payment foundation", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-01T00:00:00.000Z");
  const at = (hour = 10) => new Date(Date.UTC(2026, 9, 5, hour - 8));
  let orgId = "", otherOrgId = "", branchId = "", courtId = "", sportId = "";
  let ownerId = "", staffId = "", viewerId = "", foreignOwnerId = "";
  const secret = "test-payment-secret-not-for-production";
  const input = (overrides: Record<string, unknown> = {}) => ({
    resourceId: courtId, startAt: at().toISOString(), durationMinutes: 60,
    name: "Afiq Guest", phone: "+60123456789", email: "guest@test.example",
    expectedPriceMinor: 6000, ...overrides,
  });
  async function policy(requirement: "FULL" | "FIXED_DEPOSIT" | "PERCENT_DEPOSIT",
    overrides: { fixedDepositMinor?: number; depositPercentage?: number } = {}) {
    await connectTestAccount(db, ownerId, orgId);
    return savePaymentPolicy(db, ownerId, orgId, {
      requirement, fixedDepositMinor: overrides.fixedDepositMinor ?? null,
      depositPercentage: overrides.depositPercentage ?? null, manualEnabled: true, holdMinutes: 10,
    });
  }
  async function guest(overrides: Record<string, unknown> = {}, moment = now) {
    return submitPublicBooking(db, "payment-venue", input(overrides), moment);
  }
  async function paidEvent(paymentId: string, moment = new Date(now.getTime() + 60_000)) {
    const raw = testEvent(paymentId, "PAID");
    return handleTestWebhook(db, raw, signTestEvent(raw, secret), moment);
  }
  beforeAll(async () => {
    vi.stubEnv("ENABLE_TEST_PAYMENTS", "true");
    vi.stubEnv("TEST_PAYMENT_WEBHOOK_SECRET", secret);
    for (const { tag: file } of JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries as { tag: string }[]) {
      const migration = readFileSync(resolve("drizzle/" + file + ".sql"), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean))
        await postgres.exec(statement);
    }
    const users = await db.insert(schema.users).values([
      { name: "Owner", email: "pay-owner@test.example" }, { name: "Staff", email: "pay-staff@test.example" },
      { name: "Viewer", email: "pay-viewer@test.example" }, { name: "Other", email: "pay-other@test.example" },
    ]).returning();
    [ownerId, staffId, viewerId, foreignOwnerId] = users.map(item => item.id);
    const orgs = await db.insert(schema.organizations).values([
      { name: "Payment Venue", slug: "payment-venue", onboardingCompletedAt: now, planCode: "PROFESSIONAL" },
      { name: "Foreign Venue", slug: "foreign-payment-venue", onboardingCompletedAt: now, planCode: "PROFESSIONAL" },
    ]).returning();
    [orgId, otherOrgId] = orgs.map(item => item.id);
    await db.insert(schema.organizationMembers).values([
      { organizationId: orgId, userId: ownerId, role: "OWNER" },
      { organizationId: orgId, userId: staffId, role: "STAFF" },
      { organizationId: orgId, userId: viewerId, role: "VIEWER" },
      { organizationId: otherOrgId, userId: foreignOwnerId, role: "OWNER" },
    ]);
    sportId = (await db.select({ id: schema.sportTypes.id }).from(schema.sportTypes)
      .where(eq(schema.sportTypes.code, "BADMINTON")))[0].id;
    branchId = (await db.insert(schema.branches).values({
      organizationId: orgId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur",
    }).returning())[0].id;
    await db.insert(schema.organizationSports).values({ organizationId: orgId, sportTypeId: sportId });
    courtId = (await db.insert(schema.resources).values({
      organizationId: orgId, branchId, sportTypeId: sportId, name: "Court 1",
      bookingIntervalMinutes: 60, minimumDurationMinutes: 60,
    }).returning())[0].id;
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({
      organizationId: orgId, branchId, dayOfWeek, startMinute: 480, endMinute: 1440,
    })));
    await db.insert(schema.basePrices).values({ organizationId: orgId, branchId, sportTypeId: sportId, amountMinor: 6000 });
  }, 120000);
  beforeEach(async () => {
    await db.delete(schema.notificationRecords);
    await db.delete(schema.paymentWebhookEvents);
    await db.delete(schema.paymentAuditLogs);
    await db.delete(schema.refunds);
    await db.delete(schema.payments);
    await db.delete(schema.bookingUsageRecords);
    await db.delete(schema.bookingStatusHistory);
    await db.delete(schema.bookings);
    await db.delete(schema.customers);
    await db.delete(schema.organizationPaymentSettings);
    await db.delete(schema.organizationPaymentAccounts);
    await db.update(schema.organizations).set({ planCode: "PROFESSIONAL" }).where(eq(schema.organizations.id, orgId));
    await db.update(schema.basePrices).set({ amountMinor: 6000 }).where(eq(schema.basePrices.organizationId, orgId));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubEnv("ENABLE_TOYYIBPAY_SANDBOX", "false");
    vi.stubEnv("TOYYIBPAY_SANDBOX_SCOPE", ""); });
  afterAll(async () => { vi.unstubAllEnvs(); await postgres.close(); });

  async function workspaceBooking(overrides: Partial<typeof schema.bookings.$inferInsert> = {}) {
    const [booking] = await db.insert(schema.bookings).values({ organizationId: orgId, branchId, resourceId: courtId,
      bookingReference: "WS-" + randomUUID().slice(0, 12), startAt: at(), endAt: at(11), status: "COMPLETED", source: "STAFF",
      subtotal: 6000, totalAmount: 6000, amountPaid: 0, currency: "MYR", ...overrides }).returning();
    return booking;
  }

  it("normalizes payment workspace pagination and applies only statuses valid for the selected view", () => {
    expect(paymentWorkspaceFilters({ view: "outstanding", status: "PAID", page: "2", q: "  Court 1  " }))
      .toEqual({ view: "outstanding", status: "", page: 2, q: "Court 1" });
    for (const page of ["0", "-1", "1.5", "10001", "not-a-page", ["2"], Number.POSITIVE_INFINITY])
      expect(paymentWorkspaceFilters({ page }).page).toBe(1);
    expect(paymentWorkspaceFilters({ view: "wrong", q: "x".repeat(101), status: "SUCCEEDED" }))
      .toEqual({ view: "activity", page: 1, q: "", status: "" });
    expect(paymentWorkspaceFilters({ view: "refunds", status: "SUCCEEDED", page: "10000" }))
      .toMatchObject({ view: "refunds", status: "SUCCEEDED", page: 10000 });
    expect(paymentWorkspaceFilters({ view: "activity", status: "PARTIALLY_REFUNDED" }).status).toBe("PARTIALLY_REFUNDED");
    expect(paymentWorkspaceFilters({ view: "refunds", status: "PAID" }).status).toBe("");
  });

  it("groups outstanding balances by currency and excludes cancelled, expired, draft, held and fully paid bookings", async () => {
    await workspaceBooking({ status: "CONFIRMED", amountPaid: 2000 });
    await workspaceBooking({ subtotal: 3000, totalAmount: 3000, amountPaid: 1000 });
    await workspaceBooking({ status: "NO_SHOW", subtotal: 5000, totalAmount: 5000, amountPaid: 1000, currency: "USD" });
    for (const status of ["CANCELLED", "EXPIRED", "PENDING"])
      await workspaceBooking({ status });
    await workspaceBooking({ status: "AWAITING_PAYMENT", startAt: at(12), endAt: at(13),
      holdExpiresAt: new Date("2099-01-01T00:00:00Z") });
    await workspaceBooking({ amountPaid: 6000 });
    const result = await paymentWorkspace(db, ownerId, orgId, { view: "outstanding" }, branchId);
    expect(result.totals).toEqual([{ currency: "MYR", count: 2, amount: 6000 }, { currency: "USD", count: 1, amount: 4000 }]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map(row => row.amount).sort()).toEqual([2000, 4000, 4000]);
    expect(result.rows.every(row => row.method === "Balance due")).toBe(true);
  });

  it("keeps payment workspace totals safe when balances exceed a 32-bit sum", async () => {
    await workspaceBooking({ subtotal: 1_800_000_000, totalAmount: 1_800_000_000 });
    await workspaceBooking({ subtotal: 1_800_000_000, totalAmount: 1_800_000_000 });
    expect((await paymentWorkspace(db, ownerId, orgId, { view: "outstanding" })).totals)
      .toEqual([{ currency: "MYR", count: 2, amount: 3_600_000_000 }]);
  });

  it("searches payment booking references, names and phones literally rather than treating wildcards as patterns", async () => {
    const people = await db.insert(schema.customers).values([
      { organizationId: orgId, name: "Coach 100%_\\Club", phone: "0125550101" },
      { organizationId: orgId, name: "Coach 100XYClub", phone: "0125550202" },
    ]).returning();
    const matching = await workspaceBooking({ customerId: people[0].id, bookingReference: "WS-100%_\\MATCH" });
    const other = await workspaceBooking({ customerId: people[1].id, bookingReference: "WS-100XYMATCH" });
    await db.insert(schema.payments).values([matching, other].map(booking => ({ organizationId: orgId, bookingId: booking.id,
      provider: "MANUAL", status: "PAID", amountMinor: 2000, currency: "MYR", type: "MANUAL_PAYMENT", paymentMethod: "CASH" })));
    for (const view of ["activity", "outstanding"]) for (const q of ["%", "_", "\\", "coach 100%_", "0125550101", "WS-100%_"])
      expect((await paymentWorkspace(db, ownerId, orgId, { view, q })).rows.map(row => row.bookingId)).toEqual([matching.id]);
    expect((await paymentWorkspace(db, ownerId, orgId, { view: "outstanding", q: "no match" })).rows).toEqual([]);
    // Summary cards represent all balances in the authorized scope, independently of table search.
    expect((await paymentWorkspace(db, ownerId, orgId, { view: "outstanding", q: "no match" })).totals)
      .toEqual([{ currency: "MYR", count: 2, amount: 12000 }]);
  });

  it("keeps payment, refund and outstanding views inside the authorized tenant and selected branch", async () => {
    const extraBranches = await db.insert(schema.branches).values([
      { organizationId: orgId, name: "Workspace second", slug: "workspace-second", timezone: "Asia/Tokyo" },
      { organizationId: otherOrgId, name: "Workspace foreign", slug: "workspace-foreign" },
    ]).returning();
    const spaces = await db.insert(schema.resources).values(extraBranches.map(branch => ({ organizationId: branch.organizationId,
      branchId: branch.id, sportTypeId: sportId, name: "Workspace court" }))).returning();
    const main = await workspaceBooking();
    const second = await workspaceBooking({ branchId: extraBranches[0].id, resourceId: spaces[0].id });
    const foreign = await workspaceBooking({ organizationId: otherOrgId, branchId: extraBranches[1].id, resourceId: spaces[1].id });
    const receipts = await db.insert(schema.payments).values([main, second, foreign].map(booking => ({
      organizationId: booking.organizationId, bookingId: booking.id, provider: "MANUAL", status: "PAID", amountMinor: 2000,
      currency: "MYR", type: "MANUAL_PAYMENT", paymentMethod: "CASH" }))).returning();
    await db.insert(schema.refunds).values(receipts.map(payment => ({ organizationId: payment.organizationId,
      paymentId: payment.id, bookingId: payment.bookingId, amountMinor: 500, status: "SUCCEEDED" })));
    const [person] = await db.insert(schema.users).values({ name: "Workspace branch staff", email: "workspace-branch-staff@test.example" }).returning();
    const [member] = await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: person.id,
      role: "STAFF", branchScope: "SELECTED" }).returning();
    await db.insert(schema.memberBranches).values({ organizationId: orgId, memberId: member.id, branchId });
    for (const view of ["activity", "refunds", "outstanding"]) {
      const local = await paymentWorkspace(db, person.id, orgId, { view }, branchId);
      expect(local.rows.map(row => row.bookingId)).toEqual([main.id]);
      expect(local.totals).toEqual([{ currency: "MYR", count: 1, amount: 6000 }]);
      const all = await paymentWorkspace(db, ownerId, orgId, { view });
      expect(new Set(all.rows.map(row => row.bookingId))).toEqual(new Set([main.id, second.id]));
      expect(all.totals).toEqual([{ currency: "MYR", count: 2, amount: 12000 }]);
      expect((await paymentWorkspace(db, ownerId, orgId, { view }, extraBranches[0].id)).rows)
        .toMatchObject([{ bookingId: second.id, timezone: "Asia/Tokyo" }]);
      await expect(paymentWorkspace(db, person.id, orgId, { view })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(paymentWorkspace(db, person.id, orgId, { view }, extraBranches[0].id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(paymentWorkspace(db, ownerId, otherOrgId, { view })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect((await paymentWorkspace(db, foreignOwnerId, otherOrgId, { view })).rows.map(row => row.bookingId)).toEqual([foreign.id]);
    }
    const [role] = await db.insert(schema.customRoles).values({ organizationId: orgId, name: "Workspace no payments",
      baseRole: "ADMIN", permissions: ["booking:view"] }).returning();
    await db.update(schema.organizationMembers).set({ role: "ADMIN", customRoleId: role.id }).where(eq(schema.organizationMembers.id, member.id));
    await expect(paymentWorkspace(db, person.id, orgId, {}, branchId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("shows original receipt amounts, individual refund amounts and the remaining balance as distinct values", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 5000,
      method: "CASH", idempotencyKey: randomUUID() });
    const refund = await requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 1200,
      reason: "Workspace partial refund", idempotencyKey: randomUUID() });
    expect((await paymentWorkspace(db, viewerId, orgId, { view: "activity", status: "PARTIALLY_REFUNDED" })).rows)
      .toMatchObject([{ id: payment.id, amount: 5000, currency: "MYR", status: "PARTIALLY_REFUNDED" }]);
    expect((await paymentWorkspace(db, viewerId, orgId, { view: "refunds", status: "SUCCEEDED" })).rows)
      .toMatchObject([{ id: refund.id, amount: 1200, currency: "MYR", status: "SUCCEEDED" }]);
    expect((await paymentWorkspace(db, viewerId, orgId, { view: "outstanding" })).rows)
      .toMatchObject([{ bookingId: booking.id, amount: 2200, method: "Balance due" }]);
    expect((await paymentWorkspace(db, ownerId, orgId, { view: "refunds", status: "FAILED" })).rows).toEqual([]);
    expect((await paymentWorkspace(db, ownerId, orgId, { view: "activity", status: "PAID" })).rows).toEqual([]);
  });

  it("paginates payment workspace views without duplicate or missing rows and keeps totals independent of page", async () => {
    const entries = await db.insert(schema.bookings).values(Array.from({ length: 51 }, (_, index) => ({
      organizationId: orgId, branchId, resourceId: courtId, bookingReference: `WS-PAGE-${index}`, startAt: at(), endAt: at(11),
      status: "COMPLETED", source: "STAFF", subtotal: 1000, totalAmount: 1000, amountPaid: 400, currency: "MYR",
    }))).returning();
    const receipts = await db.insert(schema.payments).values(entries.map(booking => ({ organizationId: orgId, bookingId: booking.id,
      provider: "MANUAL", status: "PARTIALLY_REFUNDED", amountMinor: 500, currency: "MYR", type: "MANUAL_PAYMENT",
      paymentMethod: "CASH", createdAt: now }))).returning();
    await db.insert(schema.refunds).values(receipts.map(payment => ({ organizationId: orgId, paymentId: payment.id,
      bookingId: payment.bookingId, amountMinor: 100, status: "SUCCEEDED", createdAt: now })));
    for (const view of ["activity", "outstanding", "refunds"]) {
      const first = await paymentWorkspace(db, ownerId, orgId, { view, page: "invalid" });
      const second = await paymentWorkspace(db, ownerId, orgId, { view, page: "2" });
      const empty = await paymentWorkspace(db, ownerId, orgId, { view, page: "3" });
      expect(first.filters.page).toBe(1);
      expect(first.rows).toHaveLength(50);
      expect(first.hasMore).toBe(true);
      expect(second.rows).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(empty.rows).toEqual([]);
      expect(empty.hasMore).toBe(false);
      expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(51);
      expect(new Set([...first.rows, ...second.rows].map(row => row.bookingId))).toEqual(new Set(entries.map(row => row.id)));
      for (const result of [first, second, empty]) expect(result.totals).toEqual([{ currency: "MYR", count: 51, amount: 30600 }]);
    }
  });

  it("labels test and sandbox refunds explicitly and uses the payment currency for receipts and refunds", async () => {
    const booking = await workspaceBooking({ currency: "MYR" });
    const receipts = await db.insert(schema.payments).values([
      { organizationId: orgId, bookingId: booking.id, provider: "TEST", status: "PARTIALLY_REFUNDED", amountMinor: 3000,
        currency: "USD", type: "FULL_PAYMENT" },
      { organizationId: orgId, bookingId: booking.id, provider: "TOYYIBPAY_SANDBOX", status: "PARTIALLY_REFUNDED", amountMinor: 2000,
        currency: "SGD", type: "DEPOSIT" },
    ]).returning();
    const returned = await db.insert(schema.refunds).values(receipts.map(payment => ({ organizationId: orgId,
      bookingId: booking.id, paymentId: payment.id, amountMinor: 500, status: "SUCCEEDED" }))).returning();
    const activity = await paymentWorkspace(db, ownerId, orgId, { view: "activity" });
    expect(activity.rows.find(row => row.id === receipts[0].id)).toMatchObject({ method: "Test payment", currency: "USD", amount: 3000 });
    expect(activity.rows.find(row => row.id === receipts[1].id)).toMatchObject({ method: "Sandbox payment", currency: "SGD", amount: 2000 });
    const refunds = await paymentWorkspace(db, ownerId, orgId, { view: "refunds" });
    expect(refunds.rows.find(row => row.id === returned[0].id)).toMatchObject({ method: "Test refund", currency: "USD", amount: 500 });
    expect(refunds.rows.find(row => row.id === returned[1].id)).toMatchObject({ method: "Sandbox refund", currency: "SGD", amount: 500 });
  });

  it("limits recent payment activity to the authorized branch and effective role", async () => {
    const result = await guest();
    const [secondBranch] = await db.insert(schema.branches).values({ organizationId: orgId,
      name: "Sydney", slug: "sydney-payments", timezone: "Australia/Sydney" }).returning();
    const [secondSpace] = await db.insert(schema.resources).values({ organizationId: orgId,
      branchId: secondBranch.id, sportTypeId: sportId, name: "Sydney Court" }).returning();
    const [secondBooking] = await db.insert(schema.bookings).values({ organizationId: orgId,
      branchId: secondBranch.id, resourceId: secondSpace.id, bookingReference: "BK-SYDNEY-TEST",
      startAt: at(), endAt: at(11), status: "CONFIRMED", source: "STAFF",
      subtotal: 6000, totalAmount: 6000, currency: "MYR" }).returning();
    await db.insert(schema.payments).values([result.bookingId, secondBooking.id].map(bookingId => ({
      organizationId: orgId, bookingId, provider: "MANUAL", status: "PAID", amountMinor: 1500,
      currency: "MYR", type: "MANUAL_PAYMENT", paymentMethod: "CASH",
    })));
    const [person] = await db.insert(schema.users).values({ name: "Branch Reception",
      email: "branch-payments@test.example" }).returning();
    const [member] = await db.insert(schema.organizationMembers).values({ organizationId: orgId,
      userId: person.id, role: "STAFF", branchScope: "SELECTED" }).returning();
    await db.insert(schema.memberBranches).values({ organizationId: orgId, memberId: member.id, branchId });
    await expect(recentPaymentActivity(db, person.id, orgId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(recentPaymentActivity(db, person.id, orgId, secondBranch.id))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect((await recentPaymentActivity(db, person.id, orgId, branchId)).map(row => row.bookingId)).toEqual([result.bookingId]);
    expect(await recentPaymentActivity(db, ownerId, orgId, secondBranch.id))
      .toMatchObject([{ bookingId: secondBooking.id, timezone: "Australia/Sydney" }]);
    expect(await recentPaymentActivity(db, foreignOwnerId, otherOrgId)).toEqual([]);
    const [role] = await db.insert(schema.customRoles).values({ organizationId: orgId,
      name: "Booking only", baseRole: "ADMIN", permissions: ["booking:view"], createdByUserId: ownerId }).returning();
    await db.update(schema.organizationMembers).set({ role: "ADMIN", customRoleId: role.id })
      .where(eq(schema.organizationMembers.id, member.id));
    await expect(recentPaymentActivity(db, person.id, orgId, branchId))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("calculates full, fixed, and percentage deposits in minor units", () => {
    expect(paymentDue(6000, { requirement: "FULL", fixedDepositMinor: null, depositPercentage: null, manualEnabled: true, holdMinutes: 10 }))
      .toEqual({ requiredNowMinor: 6000, remainingMinor: 0 });
    expect(paymentDue(6000, { requirement: "FIXED_DEPOSIT", fixedDepositMinor: 2000, depositPercentage: null, manualEnabled: true, holdMinutes: 10 }))
      .toEqual({ requiredNowMinor: 2000, remainingMinor: 4000 });
    expect(paymentDue(6000, { requirement: "PERCENT_DEPOSIT", fixedDepositMinor: null, depositPercentage: 30, manualEnabled: true, holdMinutes: 10 }))
      .toEqual({ requiredNowMinor: 1800, remainingMinor: 4200 });
  });
  it("denies paid policy without a connected merchant adapter and viewer changes", async () => {
    await expect(savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(connectTestAccount(db, viewerId, orgId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(savePaymentPolicy(db, viewerId, orgId, { requirement: "NO_UPFRONT", manualEnabled: true, holdMinutes: 10 }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("confirms no-upfront guest bookings with no charge or payment row", async () => {
    const result = await guest();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.requiredNowMinor).toBe(0);
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });
  it("offers pay at venue and test checkout together when the owner allows both", async () => {
    await policy("FULL");
    const venue = await resolvePublicVenue(db, "payment-venue");
    expect(venue?.paymentOptions.map(option => option.value)).toEqual(["PAY_AT_VENUE", "ONLINE"]);
    const result = await guest({ paymentChoice: "PAY_AT_VENUE", totalAmount: 1 });
    const confirmation = await publicConfirmation(db, "payment-venue", result.token);
    expect(confirmation).toMatchObject({ status: "CONFIRMED", totalAmount: 6000,
      amountPaid: 0, requiredNowMinor: 0, paymentRequirement: "NO_UPFRONT" });
    expect(confirmation?.paymentHistory).toHaveLength(0);
    expect(result.checkoutUrl).toBeNull();
  });
  it("rejects a guest payment choice the owner has not allowed", async () => {
    await policy("FULL");
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: false, holdMinutes: 10 });
    expect((await resolvePublicVenue(db, "payment-venue"))?.paymentOptions.map(option => option.value)).toEqual(["ONLINE"]);
    await expect(guest({ paymentChoice: "PAY_AT_VENUE" })).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
  });
  it("keeps Starter manual-only at the service and public-action boundaries", async () => {
    await db.update(schema.organizations).set({ planCode: "STARTER" }).where(eq(schema.organizations.id, orgId));
    const venue = await resolvePublicVenue(db, "payment-venue");
    expect(venue?.paymentOptions.map(option => option.value)).toEqual(["PAY_AT_VENUE"]);
    await expect(connectTestAccount(db, ownerId, orgId)).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 }))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(guest({ paymentChoice: "ONLINE" })).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    const result = await guest({ paymentChoice: "PAY_AT_VENUE", totalAmount: 1 });
    const confirmed = await publicConfirmation(db, "payment-venue", result.token);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", totalAmount: 6000, amountPaid: 0,
      requiredNowMinor: 0, paymentRequirement: "NO_UPFRONT" });
    expect(result.checkoutUrl).toBeNull();
    const first = await recordManualPayment(db, staffId, orgId, { bookingId: result.bookingId,
      amountMinor: 2000, method: "CASH", idempotencyKey: randomUUID() });
    expect(first.status).toBe("PAID");
    expect((await paymentHistory(db, ownerId, orgId, result.bookingId)).booking.amountPaid).toBe(2000);
    await recordManualPayment(db, staffId, orgId, { bookingId: result.bookingId,
      amountMinor: 4000, method: "BANK_TRANSFER", idempotencyKey: randomUUID() });
    expect((await paymentHistory(db, ownerId, orgId, result.bookingId)).booking.amountPaid).toBe(6000);
    await requestRefund(db, ownerId, orgId, { paymentId: first.id, amountMinor: 1000,
      idempotencyKey: randomUUID() });
    expect((await paymentHistory(db, ownerId, orgId, result.bookingId)).booking.amountPaid).toBe(5000);
  });
  it("masks old online settings after downgrade but still reconciles an existing hold", async () => {
    await policy("FULL");
    const pending = await guest({ paymentChoice: "ONLINE" });
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.bookingId, pending.bookingId));
    await db.update(schema.organizations).set({ planCode: "STARTER" }).where(eq(schema.organizations.id, orgId));
    expect((await resolvePublicVenue(db, "payment-venue"))?.paymentOptions.map(option => option.value))
      .toEqual(["PAY_AT_VENUE"]);
    await expect(guest({ paymentChoice: "ONLINE", startAt: at(11).toISOString() }))
      .rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    await paidEvent(payment.id);
    expect((await publicConfirmation(db, "payment-venue", pending.token))?.status).toBe("CONFIRMED");
    await expect(requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 1000,
      idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });
  it("snapshots full payment and holds a slot without confirming", async () => {
    await policy("FULL");
    const result = await guest({ totalAmount: 1 });
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    const [payment] = await db.select().from(schema.payments);
    expect(booking).toMatchObject({ status: "AWAITING_PAYMENT", totalAmount: 6000, requiredNowMinor: 6000,
      paymentRequirement: "FULL", amountPaid: 0 });
    expect(booking.holdExpiresAt).toEqual(new Date(now.getTime() + 600_000));
    expect(payment).toMatchObject({ amountMinor: 6000, type: "FULL_PAYMENT", status: "PENDING", provider: "TEST" });
    await expect(guest()).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(transitionBooking(db, ownerId, orgId, booking.id, "CONFIRMED", undefined, now))
      .rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
  it("snapshots fixed and percentage deposits using the booking engine total", async () => {
    await policy("FIXED_DEPOSIT", { fixedDepositMinor: 2000 });
    const first = await guest();
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, first.bookingId));
    expect([booking.requiredNowMinor, booking.totalAmount - booking.requiredNowMinor]).toEqual([2000, 4000]);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "PERCENT_DEPOSIT", depositPercentage: 30,
      manualEnabled: true, holdMinutes: 10 });
    const second = await guest({ startAt: at(11).toISOString() });
    const [later] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, second.bookingId));
    expect(later.requiredNowMinor).toBe(1800);
    expect(booking.paymentRequirement).toBe("FIXED_DEPOSIT");
  });
  it("rejects forged price and a foreign resource", async () => {
    await policy("FULL");
    await expect(guest({ expectedPriceMinor: 1 })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    await expect(guest({ resourceId: randomUUID() })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });
  it("verified webhook confirms exactly once; browser return alone changes nothing", async () => {
    await policy("FULL");
    const { token, bookingId } = await guest();
    const [payment] = await db.select().from(schema.payments);
    expect((await publicConfirmation(db, "payment-venue", token))?.status).toBe("AWAITING_PAYMENT");
    const raw = testEvent(payment.id, "PAID");
    const signature = signTestEvent(raw, secret);
    expect((await handleTestWebhook(db, raw, signature, new Date(now.getTime() + 60_000))).bookingStatus).toBe("CONFIRMED");
    expect((await handleTestWebhook(db, raw, signature, new Date(now.getTime() + 60_000))).duplicate).toBe(true);
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    expect(booking.amountPaid).toBe(6000);
    expect(await db.select().from(schema.paymentWebhookEvents)).toHaveLength(1);
    const confirmation = await publicConfirmation(db, "payment-venue", token);
    expect(confirmation?.amountPaid).toBe(6000);
    expect(confirmation?.paymentHistory[0].status).toBe("PAID");
  });
  it("rejects invalid signature and does not record an event", async () => {
    await policy("FULL"); await guest();
    const [payment] = await db.select().from(schema.payments);
    await expect(handleTestWebhook(db, testEvent(payment.id, "PAID"), "0".repeat(64), now)).rejects.toThrow("Invalid test webhook");
    expect(await db.select().from(schema.paymentWebhookEvents)).toHaveLength(0);
  });
  it("failed payment releases the slot and leaves booking unconfirmed", async () => {
    await policy("FULL");
    const first = await guest();
    const [payment] = await db.select().from(schema.payments);
    const raw = testEvent(payment.id, "FAILED");
    await handleTestWebhook(db, raw, signTestEvent(raw, secret), new Date(now.getTime() + 60_000));
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, first.bookingId)))[0].status).toBe("EXPIRED");
    expect((await guest()).bookingId).not.toBe(first.bookingId);
  });
  it("expires holds, releases slots, and rejects late confirmation even if money arrives", async () => {
    await policy("FULL");
    const first = await guest();
    const [payment] = await db.select().from(schema.payments);
    const later = new Date(now.getTime() + 660_000);
    const second = await guest({}, later);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, first.bookingId)))[0].status).toBe("EXPIRED");
    expect((await paidEvent(payment.id, later)).bookingStatus).toBe("EXPIRED");
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, second.bookingId)))[0].status).toBe("AWAITING_PAYMENT");
    expect((await db.select().from(schema.paymentAuditLogs).where(eq(schema.paymentAuditLogs.action, "LATE_PAYMENT_REQUIRES_REFUND")))).toHaveLength(1);
  });
  it("one of two simultaneous guest checkouts wins the same slot", async () => {
    await policy("FULL");
    const result = await Promise.allSettled([guest(), guest()]);
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(item => item.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(schema.payments)).toHaveLength(1);
  });
  it("manual cash and bank transfer update net paid only for authorized staff", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    await expect(recordManualPayment(db, viewerId, orgId, { bookingId: booking.id, amountMinor: 2000, method: "CASH", idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const receipt = await recordManualPayment(db, staffId, orgId, { bookingId: booking.id, amountMinor: 2000, method: "CASH", idempotencyKey: randomUUID() });
    expect(receipt.recordedByUserId).toBe(staffId);
    await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 4000, method: "BANK_TRANSFER", idempotencyKey: randomUUID() });
    const history = await paymentHistory(db, ownerId, orgId, booking.id);
    expect(history.booking.amountPaid).toBe(6000);
    expect(history.payments).toHaveLength(2);
    await expect(recordManualPayment(db, staffId, orgId, { bookingId: booking.id, amountMinor: 1, method: "CASH", idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "PAYMENT_AMOUNT" });
  });
  it("prevents cross-tenant payment lookup, manual receipt and refund IDOR", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const receipt = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 6000, method: "CASH", idempotencyKey: randomUUID() });
    await expect(paymentHistory(db, foreignOwnerId, otherOrgId, booking.id)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    await expect(recordManualPayment(db, foreignOwnerId, otherOrgId, { bookingId: booking.id, amountMinor: 1, method: "CASH", idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
    await expect(requestRefund(db, foreignOwnerId, otherOrgId, { paymentId: receipt.id, amountMinor: 1, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
  });
  it("manual partial and full refunds maintain net paid and never change cancellation", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 6000, method: "CASH", idempotencyKey: randomUUID() });
    await expect(requestRefund(db, staffId, orgId, { paymentId: payment.id, amountMinor: 1000, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const partial = await requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 2000, reason: "Partial", idempotencyKey: randomUUID() });
    expect(partial.status).toBe("SUCCEEDED");
    expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(4000);
    expect((await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)))[0].status).toBe("PARTIALLY_REFUNDED");
    await expect(requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 4001, idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: "REFUND_AMOUNT" });
    await requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 4000, idempotencyKey: randomUUID() });
    const history = await paymentHistory(db, ownerId, orgId, booking.id);
    expect(history.booking.amountPaid).toBe(0);
    expect(history.booking.status).toBe("CONFIRMED");
    expect(history.payments[0].status).toBe("REFUNDED");
  });
  it("test refunds remain simulated and duplicate provider events do not double-credit", async () => {
    await policy("PERCENT_DEPOSIT", { depositPercentage: 30 });
    const { bookingId } = await guest();
    const [payment] = await db.select().from(schema.payments);
    await paidEvent(payment.id);
    const refund = await requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 800, idempotencyKey: randomUUID() });
    expect(refund.providerRefundId).toBe("test:" + refund.id);
    expect((await paymentHistory(db, ownerId, orgId, bookingId)).booking.amountPaid).toBe(1000);
    await processPaymentEvent(db, "TEST", { eventId: randomUUID(), paymentId: payment.id, status: "PAID" }, now);
    expect((await paymentHistory(db, ownerId, orgId, bookingId)).booking.amountPaid).toBe(1000);
  });
  it("public availability ignores expired holds and sweep records expiry", async () => {
    await policy("FULL");
    const first = await guest();
    const later = new Date(now.getTime() + 660_000);
    const grid = await publicAvailability(db, "payment-venue", { sportId, localDate: "2026-10-05", durationMinutes: 60 }, later);
    const row = grid.times.find(item => item.startAt === at().toISOString());
    expect(row?.options[0].available).toBe(true);
    expect(await sweepExpiredHolds(db, later)).toBe(1);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, first.bookingId)))[0].status).toBe("EXPIRED");
  });
  it("disconnects only when no active holds, resetting online requirement", async () => {
    await policy("FULL");
    await guest();
    await expect(disconnectTestAccount(db, ownerId, orgId)).rejects.toMatchObject({ code: "ACTIVE_CHECKOUTS" });
    await sweepExpiredHolds(db, new Date(now.getTime() + 660_000));
    await disconnectTestAccount(db, ownerId, orgId);
    expect((await db.select().from(schema.organizationPaymentSettings).where(eq(schema.organizationPaymentSettings.organizationId, orgId)))[0].requirement).toBe("NO_UPFRONT");
  });

  it("retries a manual receipt without double-crediting", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const idempotencyKey = randomUUID();
    const raw = { bookingId: booking.id, amountMinor: 2000, method: "CASH", idempotencyKey };
    const first = await recordManualPayment(db, staffId, orgId, raw);
    const second = await recordManualPayment(db, staffId, orgId, raw);
    expect(second.id).toBe(first.id);
    expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(2000);
    expect(await db.select().from(schema.payments)).toHaveLength(1);
    await expect(recordManualPayment(db, staffId, orgId, { ...raw, amountMinor: 1000 }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("retries a refund without making a second refund", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 6000,
      method: "CASH", idempotencyKey: randomUUID() });
    const raw = { paymentId: payment.id, amountMinor: 2000, reason: "Partial", idempotencyKey: randomUUID() };
    const first = await requestRefund(db, ownerId, orgId, raw);
    const second = await requestRefund(db, ownerId, orgId, raw);
    expect(second.id).toBe(first.id);
    expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(4000);
    expect(await db.select().from(schema.refunds)).toHaveLength(1);
    await expect(requestRefund(db, ownerId, orgId, { ...raw, amountMinor: 1000 }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(requestRefund(db, ownerId, orgId, { ...raw, reason: "Changed reason" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("reserves pending refunds against the balance and never dispatches a replay twice", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id,
      amountMinor: 6000, method: "CASH", idempotencyKey: randomUUID() });
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    const provider = vi.spyOn(manualProvider, "refundPayment").mockImplementation(async input => {
      entered(); await finish; return { providerRefundId: "manual:" + input.refundId, status: "SUCCEEDED" };
    });
    const raw = { paymentId: payment.id, amountMinor: 4000, idempotencyKey: randomUUID() };
    const first = requestRefund(db, ownerId, orgId, raw);
    await started;
    try {
      const replay = await requestRefund(db, ownerId, orgId, raw);
      expect(replay.status).toBe("PENDING");
      expect(provider).toHaveBeenCalledOnce();
      await expect(requestRefund(db, ownerId, orgId, { paymentId: payment.id,
        amountMinor: 2001, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "REFUND_AMOUNT" });
      expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(6000);
    } finally { release(); }
    expect((await first).status).toBe("SUCCEEDED");
    expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(2000);
  });
  it("does not subtract a failed refund and requires a new retry key for a new attempt", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id,
      amountMinor: 6000, method: "CASH", idempotencyKey: randomUUID() });
    const provider = vi.spyOn(manualProvider, "refundPayment").mockRejectedValueOnce(new Error("Adapter unavailable"));
    const raw = { paymentId: payment.id, amountMinor: 6000, idempotencyKey: randomUUID() };
    const failed = await requestRefund(db, ownerId, orgId, raw);
    expect(failed.status).toBe("FAILED");
    expect((await requestRefund(db, ownerId, orgId, raw)).id).toBe(failed.id);
    expect(provider).toHaveBeenCalledOnce();
    expect((await paymentHistory(db, ownerId, orgId, booking.id)).booking.amountPaid).toBe(6000);
    const retry = { ...raw, idempotencyKey: randomUUID() };
    const succeeded = await requestRefund(db, ownerId, orgId, retry);
    expect(succeeded.status).toBe("SUCCEEDED");
    expect((await requestRefund(db, ownerId, orgId, retry)).id).toBe(succeeded.id);
    expect(provider).toHaveBeenCalledTimes(2);
    const history = await paymentHistory(db, ownerId, orgId, booking.id);
    expect(history.booking.amountPaid).toBe(0);
    expect(history.payments[0].status).toBe("REFUNDED");
    expect(history.refunds.map(row => row.status)).toEqual(["FAILED", "SUCCEEDED"]);
  });
  it("preserves partial receipts and outstanding balance on a time-only move", async () => {
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    await recordManualPayment(db, ownerId, orgId, { bookingId: booking.id, amountMinor: 2000,
      method: "CASH", idempotencyKey: randomUUID() });
    await db.update(schema.basePrices).set({ amountMinor: 12000 }).where(eq(schema.basePrices.organizationId, orgId));
    const target = { startAt: at(11), endAt: at(12) };
    const quote = await quoteReschedule(db, ownerId, orgId, booking.id, target, now);
    expect(quote).toMatchObject({ currentTotal: 6000, newTotal: 6000, priceChanged: false });
    const moved = await rescheduleBooking(db, ownerId, orgId, booking.id, { ...target,
      expectedTotalMinor: quote.newTotal, expectedBookingUpdatedAt: quote.bookingUpdatedAt }, now);
    expect([moved.totalAmount, moved.amountPaid, moved.totalAmount - moved.amountPaid]).toEqual([6000, 2000, 4000]);
    await expect(rescheduleBooking(db, ownerId, orgId, booking.id, { startAt: at(12), endAt: at(14) }, now))
      .rejects.toMatchObject({ code: "REPRICE_UNSUPPORTED" });
  });
  it("rejects preview and save for active checkout and repricing of retained online terms after refund", async () => {
    await policy("FULL");
    const result = await guest();
    const [payment] = await db.select().from(schema.payments);
    const target = { startAt: at(11), endAt: at(12) };
    await expect(quoteReschedule(db, ownerId, orgId, result.bookingId, target, now))
      .rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    await expect(rescheduleBooking(db, ownerId, orgId, result.bookingId, target, now))
      .rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    await paidEvent(payment.id);
    await requestRefund(db, ownerId, orgId, { paymentId: payment.id, amountMinor: 6000, idempotencyKey: randomUUID() });
    const changed = { startAt: at(11), endAt: at(13) };
    await expect(quoteReschedule(db, ownerId, orgId, result.bookingId, changed, now))
      .rejects.toMatchObject({ code: "REPRICE_UNSUPPORTED" });
    await expect(rescheduleBooking(db, ownerId, orgId, result.bookingId, changed, now))
      .rejects.toMatchObject({ code: "REPRICE_UNSUPPORTED" });
    expect(await rescheduleBooking(db, ownerId, orgId, result.bookingId, target, now))
      .toMatchObject({ totalAmount: 6000, amountPaid: 0, requiredNowMinor: 6000 });
  });
  it("database rejects a payment-required booking without a hold", async () => {
    await expect(db.insert(schema.bookings).values({ organizationId: orgId, branchId, resourceId: courtId,
      bookingReference: "BK-" + randomUUID().slice(0, 12), startAt: at(), endAt: at(11),
      status: "AWAITING_PAYMENT", source: "ONLINE", subtotal: 6000, totalAmount: 6000,
      requiredNowMinor: 6000, paymentRequirement: "FULL", currency: "MYR" })).rejects.toThrow();
  });
  it("database rejects a refund linked to a different booking than its payment", async () => {
    const first = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(), endAt: at(11), source: "STAFF" }, now);
    const second = await createBooking(db, ownerId, orgId, { branchId, resourceId: courtId,
      startAt: at(11), endAt: at(12), source: "STAFF" }, now);
    const payment = await recordManualPayment(db, ownerId, orgId, { bookingId: first.id, amountMinor: 6000,
      method: "CASH", idempotencyKey: randomUUID() });
    await expect(db.insert(schema.refunds).values({ organizationId: orgId, paymentId: payment.id,
      bookingId: second.id, amountMinor: 1000, status: "PENDING" })).rejects.toThrow();
  });  function sandboxMock(transactions: () => unknown = () => [{ billpaymentStatus: "1", billpaymentAmount: "60.00",
    billExternalReferenceNo: "", billpaymentInvoiceNo: "TP-SANDBOX-1" }]) {
    let created: URLSearchParams | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const body = new URLSearchParams(String(options.body));
      if (url.endsWith("/getCategoryDetails")) return Response.json({ categoryStatus: "1" });
      if (url.endsWith("/createBill")) { created = body; return Response.json([{ BillCode: "testbill123" }]); }
      if (url.endsWith("/getBillTransactions")) return Response.json(transactions());
      throw new Error("Unexpected sandbox endpoint");
    }));
    return { getCreated: () => created };
  }
  function enableSandbox() {
    vi.stubEnv("ENABLE_TOYYIBPAY_SANDBOX", "true");
    vi.stubEnv("TOYYIBPAY_SANDBOX_ORGANIZATION_ID", orgId);
    vi.stubEnv("TOYYIBPAY_SANDBOX_SECRET_KEY", "unit-test-sandbox-secret");
    vi.stubEnv("TOYYIBPAY_SANDBOX_CATEGORY_CODE", "testcat1");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  }
  it("creates a ToyyibPay sandbox bill and confirms only after signed callback plus API verification", async () => {
    enableSandbox();
    let paymentId = "";
    const mock = sandboxMock(() => [{ billpaymentStatus: "1", billpaymentAmount: "60.00",
      billExternalReferenceNo: paymentId, billpaymentInvoiceNo: "TP-SANDBOX-1" }]);
    await connectToyyibSandboxAccount(db, ownerId, orgId);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 });
    const result = await guest();
    paymentId = result.paymentId!;
    expect(result.checkoutUrl).toBe("https://dev.toyyibpay.com/testbill123");
    const bill = mock.getCreated()!;
    expect(bill.get("billAmount")).toBe("6000");
    expect(bill.get("billExternalReferenceNo")).toBe(paymentId);
    expect(bill.get("billReturnUrl")).not.toContain(result.token);
    expect(bill.get("billExpiryDate")).toContain("08:10:00");
    expect((await publicConfirmation(db, "payment-venue", result.token))?.status).toBe("AWAITING_PAYMENT");
    const refno = "SANDBOX-REF-1";
    const hash = createHash("md5").update("unit-test-sandbox-secret1" + paymentId + refno + "ok").digest("hex");
    const callback = new URLSearchParams({ order_id: paymentId, billcode: "testbill123",
      status: "1", refno, hash }).toString();
    expect((await handleToyyibSandboxCallback(db, callback, new Date(now.getTime() + 60_000))).duplicate).toBe(false);
    expect((await handleToyyibSandboxCallback(db, callback, new Date(now.getTime() + 60_000))).duplicate).toBe(true);
    const confirmed = await publicConfirmation(db, "payment-venue", result.token);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", amountPaid: 6000 });
    expect(await db.select().from(schema.paymentWebhookEvents)).toHaveLength(1);
  });
  it("rejects forged sandbox callbacks and mismatched verified amounts", async () => {
    enableSandbox();
    let paymentId = "";
    let amount = "59.00";
    sandboxMock(() => [{ billpaymentStatus: "1", billpaymentAmount: amount,
      billExternalReferenceNo: paymentId, billpaymentInvoiceNo: "TP-SANDBOX-2" }]);
    await connectToyyibSandboxAccount(db, ownerId, orgId);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 });
    const result = await guest(); paymentId = result.paymentId!;
    const raw = new URLSearchParams({ order_id: paymentId, billcode: "testbill123", status: "1",
      refno: "SANDBOX-REF-2", hash: "0".repeat(32) }).toString();
    await expect(handleToyyibSandboxCallback(db, raw)).rejects.toThrow("Invalid ToyyibPay callback");
    const signed = new URLSearchParams({ order_id: paymentId, billcode: "testbill123", status: "1",
      refno: "SANDBOX-REF-2", hash: createHash("md5")
        .update("unit-test-sandbox-secret1" + paymentId + "SANDBOX-REF-2ok").digest("hex") }).toString();
    expect((await handleToyyibSandboxCallback(db, signed)).pending).toBe(true);
    expect((await publicConfirmation(db, "payment-venue", result.token))?.status).toBe("AWAITING_PAYMENT");
    amount = "60.00";
    expect((await handleToyyibSandboxCallback(db, signed, new Date(now.getTime() + 60_000))).pending).toBe(false);
    expect((await publicConfirmation(db, "payment-venue", result.token))?.amountPaid).toBe(6000);
  });
  it("reconciles a sandbox payment from the private status check when callback is missed", async () => {
    enableSandbox();
    let paymentId = "";
    sandboxMock(() => [{ billpaymentStatus: "1", billpaymentAmount: "60.00",
      billExternalReferenceNo: paymentId, billpaymentInvoiceNo: "TP-SANDBOX-RETURN" }]);
    await expect(connectToyyibSandboxAccount(db, viewerId, orgId))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await connectToyyibSandboxAccount(db, ownerId, orgId);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 });
    const result = await guest(); paymentId = result.paymentId!;
    expect((await publicConfirmation(db, "payment-venue", result.token))?.status).toBe("AWAITING_PAYMENT");
    await reconcileToyyibSandboxPayment(db, paymentId, new Date(now.getTime() + 60_000));
    expect((await publicConfirmation(db, "payment-venue", result.token))?.status).toBe("CONFIRMED");
    await expect(requestRefund(db, ownerId, orgId, { paymentId, amountMinor: 100,
      idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });  it("can share one sandbox category across venues without sharing payment account rows", async () => {
    enableSandbox();
    vi.stubEnv("TOYYIBPAY_SANDBOX_SCOPE", "ALL_TEST_VENUES");
    sandboxMock();
    const first = await connectToyyibSandboxAccount(db, ownerId, orgId);
    const second = await connectToyyibSandboxAccount(db, foreignOwnerId, otherOrgId);
    expect(first.providerAccountId).toBe(second.providerAccountId);
    expect(first.organizationId).not.toBe(second.organizationId);
    expect(first.id).not.toBe(second.id);
  });  it("bills only the fixed deposit in ToyyibPay sandbox and keeps the balance due", async () => {
    enableSandbox();
    let paymentId = "";
    const mock = sandboxMock(() => [{ billpaymentStatus: "1", billpaymentAmount: "20.00",
      billExternalReferenceNo: paymentId, billpaymentInvoiceNo: "TP-SANDBOX-DEPOSIT" }]);
    await connectToyyibSandboxAccount(db, ownerId, orgId);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FIXED_DEPOSIT", fixedDepositMinor: 2000,
      manualEnabled: true, holdMinutes: 10 });
    const result = await guest(); paymentId = result.paymentId!;
    expect(mock.getCreated()?.get("billAmount")).toBe("2000");
    const refno = "DEPOSIT-REF";
    const hash = createHash("md5").update("unit-test-sandbox-secret1" + paymentId + refno + "ok").digest("hex");
    await handleToyyibSandboxCallback(db, new URLSearchParams({ order_id: paymentId,
      billcode: "testbill123", status: "1", refno, hash }).toString(), new Date(now.getTime() + 60_000));
    const confirmed = await publicConfirmation(db, "payment-venue", result.token);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", requiredNowMinor: 2000,
      totalAmount: 6000, amountPaid: 2000 });
  });  it("does not connect another tenant or leave a hold after sandbox bill creation fails", async () => {
    enableSandbox();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/getCategoryDetails")
      ? Response.json({ categoryStatus: "1" }) : Response.json({ status: "error" })));
    await expect(connectToyyibSandboxAccount(db, foreignOwnerId, otherOrgId))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await connectToyyibSandboxAccount(db, ownerId, orgId);
    await savePaymentPolicy(db, ownerId, orgId, { requirement: "FULL", manualEnabled: true, holdMinutes: 10 });
    await expect(guest()).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    const [booking] = await db.select().from(schema.bookings);
    expect(booking.status).toBe("EXPIRED");
    expect((await publicAvailability(db, "payment-venue", { sportId,
      localDate: "2026-10-05", durationMinutes: 60 }, now)).times.some(row =>
      row.options.some(option => option.available))).toBe(true);
  });});
