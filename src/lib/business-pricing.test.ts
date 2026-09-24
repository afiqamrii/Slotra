import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createOrganization } from "@/lib/organization-service";
import { availableSlotsForResources } from "@/lib/booking-availability";
import { createPricingRule, listPricingRules } from "@/lib/business-pricing";
import { cancelBooking, checkInBooking, createBooking, rescheduleBooking } from "@/lib/booking-service";
import { createRecurringBookings, previewRecurringBookings, rescheduleFutureInSeries } from "@/lib/business-recurring";
import { assignCustomerMembership, createMembershipPlan, createPackagePlan, createPromotion,
  issueCustomerPackage } from "@/lib/business-benefits";
import { joinWaitlist, notifyNextWaitlisted } from "@/lib/business-waitlist";
import { resolveBookingQr, signBookingQr } from "@/lib/business-qr";
import { updateBusinessPolicy } from "@/lib/business-rules";

describe("Business pricing", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", otherOwnerId = "", organizationId = "", otherOrganizationId = "", branchId = "", sportTypeId = "", resourceId = "", customerId = "", otherCustomerId = "";
  const now = new Date("2026-10-01T00:00:00.000Z");
  beforeAll(async () => {
    for (const entry of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      const filename = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries[entry].tag;
      const migration = readFileSync(resolve(`drizzle/${filename}.sql`), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean))
        await postgres.exec(statement);
    }
    const users = await db.insert(schema.users).values([
      { name: "Business Owner", email: "business-pricing@test.example" },
      { name: "Other Owner", email: "other-business-pricing@test.example" },
    ]).returning();
    [ownerId, otherOwnerId] = users.map(user => user.id);
    organizationId = (await createOrganization(db, ownerId, { name: "Business Pricing", slug: "business-pricing" })).id;
    otherOrganizationId = (await createOrganization(db, otherOwnerId, { name: "Other Business", slug: "other-business-pricing" })).id;
    branchId = (await db.insert(schema.branches).values({ organizationId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur" }).returning())[0].id;
    sportTypeId = (await db.select({ id: schema.sportTypes.id }).from(schema.sportTypes).where(eq(schema.sportTypes.code, "BADMINTON")))[0].id;
    await db.insert(schema.organizationSports).values({ organizationId, sportTypeId });
    resourceId = (await db.insert(schema.resources).values({ organizationId, branchId, sportTypeId, name: "Court 1", bookingIntervalMinutes: 60 }).returning())[0].id;
    customerId = (await db.insert(schema.customers).values({ organizationId, name: "Member", phone: "+60123456789" }).returning())[0].id;
    otherCustomerId = (await db.insert(schema.customers).values({
      organizationId: otherOrganizationId, name: "Other venue player", phone: "+60199999999",
    }).returning())[0].id;
    await db.insert(schema.basePrices).values({ organizationId, branchId, sportTypeId, amountMinor: 2500 });
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) =>
      ({ organizationId, branchId, dayOfWeek, startMinute: 480, endMinute: 1440 })));
  }, 120000);
  afterAll(async () => postgres.close());

  it("gates Business pricing from Professional", async () => {
    await db.update(schema.organizations).set({ planCode: "PROFESSIONAL" }).where(eq(schema.organizations.id, organizationId));
    await expect(createPricingRule(db, ownerId, organizationId, { branchId, sportTypeId, name: "Evening",
      weekdays: [1], startMinute: 1080, endMinute: 1320, amountMinor: 3500 }))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await db.update(schema.organizations).set({ planCode: "BUSINESS" }).where(eq(schema.organizations.id, organizationId));
  });

  it("applies the local peak rate and rejects overlapping rules", async () => {
    await createPricingRule(db, ownerId, organizationId, { branchId, sportTypeId, name: "Evening",
      weekdays: [1], startMinute: 1080, endMinute: 1320, amountMinor: 3500 });
    await expect(createPricingRule(db, ownerId, organizationId, { branchId, sportTypeId, name: "Peak overlap",
      weekdays: [1], startMinute: 1200, endMinute: 1380, amountMinor: 4000 }))
      .rejects.toMatchObject({ code: "PRICING_RULE_OVERLAP" });
    const peak = await createBooking(db, ownerId, organizationId, {
      branchId, resourceId, source: "STAFF", startAt: new Date("2026-10-05T11:00:00Z"),
      endAt: new Date("2026-10-05T12:00:00Z"),
    }, now);
    expect(peak.subtotal).toBe(3500);
  });

  it("keeps rules scoped to the owner organization", async () => {
    await expect(listPricingRules(db, otherOwnerId, organizationId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await listPricingRules(db, ownerId, organizationId)).toHaveLength(1);
    await expect(createPricingRule(db, ownerId, organizationId, { branchId, sportTypeId, resourceId: otherOrganizationId,
      name: "Wrong space", weekdays: [2], startMinute: 480, endMinute: 600, amountMinor: 3000 }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
  it("previews conflicts and creates only available weekly bookings", async () => {
    const recurring = { branchId, resourceId, customerId: null, startDate: "2026-10-05",
      endDate: "2026-10-19", weekday: 1, localTime: "10:00", durationMinutes: 60 };
    await createBooking(db, ownerId, organizationId, {
      branchId, resourceId, source: "STAFF",
      startAt: new Date("2026-10-12T02:00:00Z"), endAt: new Date("2026-10-12T03:00:00Z"),
    }, now);
    const preview = await previewRecurringBookings(db, ownerId, organizationId, recurring, now);
    expect([preview.available, preview.unavailable]).toEqual([2, 1]);
    await expect(createRecurringBookings(db, ownerId, organizationId, recurring, false, now))
      .rejects.toMatchObject({ code: "SERIES_CONFLICT" });
    const series = await createRecurringBookings(db, ownerId, organizationId, recurring, true, now);
    expect([series.created.length, series.conflicts.length]).toEqual([2, 1]);
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.recurringSeriesId, series.seriesId));
    expect(rows).toHaveLength(2);
    const moved = await rescheduleFutureInSeries(db, ownerId, organizationId, series.seriesId,
      series.created[0].id, { resourceId, localTime: "11:00", durationMinutes: 60 }, now);
    expect(moved.changed).toHaveLength(2);
    await rescheduleBooking(db, ownerId, organizationId, series.created[0].id, {
      resourceId, startAt: new Date("2026-10-05T04:00:00Z"), endAt: new Date("2026-10-05T05:00:00Z"),
    }, now);
    const [otherWeek] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, series.created[1].id));
    expect(otherWeek.startAt.toISOString()).toBe("2026-10-19T03:00:00.000Z");
  });
  it("applies a tenant-owned membership discount", async () => {
    const plan = await createMembershipPlan(db, ownerId, organizationId, {
      name: "Discount Member", priceMinor: 3000, discountType: "PERCENT", discountValue: 10,
    });
    await assignCustomerMembership(db, ownerId, organizationId, {
      customerId, planId: plan.id, startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
    });
    const booking = await createBooking(db, ownerId, organizationId, { branchId, resourceId, customerId,
      source: "STAFF", startAt: new Date("2026-10-06T00:00:00Z"), endAt: new Date("2026-10-06T01:00:00Z") }, now);
    expect([booking.subtotal, booking.discountAmount, booking.totalAmount]).toEqual([2500, 250, 2250]);
    await expect(assignCustomerMembership(db, ownerId, organizationId, {
      customerId: otherCustomerId, planId: plan.id,
      startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-11-01T00:00:00Z"),
    })).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_FOUND" });
  });
  it("rejects direct Professional calls to package, promotion and recurring services", async () => {
    await db.update(schema.organizations).set({ planCode: "PROFESSIONAL" }).where(eq(schema.organizations.id, organizationId));
    await expect(createPackagePlan(db, ownerId, organizationId, {
      name: "Hours", priceMinor: 1000, creditsMinutes: 60,
    })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createPromotion(db, ownerId, organizationId, {
      name: "Save", code: "SAVE10", discountType: "PERCENT", discountValue: 10,
      startsAt: now, endsAt: new Date("2026-11-01T00:00:00Z"),
    })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(previewRecurringBookings(db, ownerId, organizationId, { branchId, resourceId,
      customerId: null, startDate: "2026-10-05", endDate: "2026-10-12", weekday: 1,
      localTime: "10:00", durationMinutes: 60 }, now))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await db.update(schema.organizations).set({ planCode: "BUSINESS" }).where(eq(schema.organizations.id, organizationId));
  });
  it("deducts package minutes once and restores them on cancellation", async () => {
    const plan = await createPackagePlan(db, ownerId, organizationId, {
      name: "Two Hours", priceMinor: 4500, creditsMinutes: 120,
    });
    const owned = await issueCustomerPackage(db, ownerId, organizationId, { customerId, planId: plan.id }, now);
    const first = await createBooking(db, ownerId, organizationId, { branchId, resourceId, customerId,
      customerPackageId: owned.id, source: "STAFF", startAt: new Date("2026-10-07T00:00:00Z"),
      endAt: new Date("2026-10-07T01:00:00Z") }, now);
    expect(first.totalAmount).toBe(0);
    const second = await createBooking(db, ownerId, organizationId, { branchId, resourceId, customerId,
      customerPackageId: owned.id, source: "STAFF", startAt: new Date("2026-10-07T01:00:00Z"),
      endAt: new Date("2026-10-07T02:00:00Z") }, now);
    expect(second.totalAmount).toBe(0);
    await expect(createBooking(db, ownerId, organizationId, { branchId, resourceId, customerId,
      customerPackageId: owned.id, source: "STAFF", startAt: new Date("2026-10-08T00:00:00Z"),
      endAt: new Date("2026-10-08T01:00:00Z") }, now)).rejects.toMatchObject({ code: "PACKAGE_BALANCE" });
    await cancelBooking(db, ownerId, organizationId, first.id, "Customer changed plans", now);
    const [balance] = await db.select().from(schema.customerPackages).where(eq(schema.customerPackages.id, owned.id));
    expect(balance.remainingMinutes).toBe(60);
  });
  it("enforces promo expiry and a single remaining redemption", async () => {
    const promo = await createPromotion(db, ownerId, organizationId, {
      name: "Quiet Hour", code: "quiet10", discountType: "PERCENT", discountValue: 10,
      startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-31T00:00:00Z"),
      usageLimit: 1,
    });
    const inputs = [new Date("2026-10-09T00:00:00Z"), new Date("2026-10-10T00:00:00Z")].map(startAt => ({
      branchId, resourceId, customerId, promoCode: "quiet10", source: "STAFF",
      startAt, endAt: new Date(startAt.getTime() + 3_600_000),
    }));
    const outcomes = await Promise.allSettled(inputs.map(input => createBooking(db, ownerId, organizationId, input, now)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    const [saved] = await db.select().from(schema.promotions).where(eq(schema.promotions.id, promo.id));
    expect(saved.usedCount).toBe(1);
    await expect(createBooking(db, ownerId, organizationId, { ...inputs[0],
      startAt: new Date("2026-11-02T00:00:00Z"), endAt: new Date("2026-11-02T01:00:00Z") },
    new Date("2026-11-01T00:00:00Z"))).rejects.toMatchObject({ code: "PROMO_UNAVAILABLE" });
  });
  it("accepts only a full in-tenant slot for the waitlist", async () => {
    const startAt = new Date("2026-10-15T01:00:00Z"), endAt = new Date("2026-10-15T02:00:00Z");
    const full = await createBooking(db, ownerId, organizationId, { branchId, resourceId, source: "STAFF",
      startAt, endAt }, now);
    const entry = await joinWaitlist(db, organizationId, { branchId, resourceId, startAt, endAt,
      name: "Waiting Player", phone: "+60111111111", email: "waiting@example.com" }, now);
    expect(entry.id).toBeTruthy();
    await db.update(schema.organizations).set({ planCode: "BUSINESS" })
      .where(eq(schema.organizations.id, otherOrganizationId));
    await expect(joinWaitlist(db, otherOrganizationId, { branchId, resourceId, startAt, endAt,
      name: "Other Player", phone: "+60122222222", email: "other@example.com" }, now))
      .rejects.toMatchObject({ code: "BRANCH_INACTIVE" });
    await cancelBooking(db, ownerId, organizationId, full.id, "Changed plans", now);
    const [saved] = await db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entry.id));
    expect(saved.status).toBe("WAITING");
    expect(await notifyNextWaitlisted(db, organizationId, resourceId, startAt, endAt, now))
      .toEqual({ status: "NOT_CONFIGURED" });
    await expect(joinWaitlist(db, organizationId, { branchId, resourceId, startAt, endAt,
      name: "Another", phone: "+60133333333", email: "another@example.com" }, now))
      .rejects.toMatchObject({ code: "WAITLIST_UNAVAILABLE" });
  });
  it("resolves signed QR only for authorized staff in the right venue", async () => {
    const booking = await createBooking(db, ownerId, organizationId, { branchId, resourceId, source: "STAFF",
      startAt: new Date("2026-10-16T01:00:00Z"), endAt: new Date("2026-10-16T02:00:00Z") }, now);
    const secret = "a".repeat(32);
    const token = signBookingQr(organizationId, booking.id, booking.bookingReference, secret);
    expect((await resolveBookingQr(db, ownerId, organizationId, token, secret)).id).toBe(booking.id);
    const checked = await checkInBooking(db, ownerId, organizationId, booking.id, now);
    expect(checked.status).toBe("CHECKED_IN");
    await expect(checkInBooking(db, ownerId, organizationId, booking.id, now))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(resolveBookingQr(db, ownerId, organizationId,
      token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), secret))
      .rejects.toMatchObject({ code: "INVALID_QR" });
    await expect(resolveBookingQr(db, otherOwnerId, organizationId, token, secret))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(resolveBookingQr(db, otherOwnerId, otherOrganizationId, token, secret))
      .rejects.toMatchObject({ code: "INVALID_QR" });
  });
  it("enforces venue notice, buffer and cancellation cutoff in the booking engine", async () => {
    await updateBusinessPolicy(db, ownerId, organizationId, {
      minimumNoticeMinutes: 120, maximumAdvanceDays: 60, maximumDurationMinutes: 120,
      bookingBufferMinutes: 30, cancellationCutoffMinutes: 360, rescheduleCutoffMinutes: 360,
    });
    const startAt = new Date("2026-10-20T01:00:00Z"), endAt = new Date("2026-10-20T02:00:00Z");
    const booking = await createBooking(db, ownerId, organizationId, { branchId, resourceId,
      source: "STAFF", startAt, endAt }, now);
    await expect(createBooking(db, ownerId, organizationId, { branchId, resourceId, source: "STAFF",
      startAt: new Date("2026-10-20T02:00:00Z"), endAt: new Date("2026-10-20T03:00:00Z") }, now))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createBooking(db, ownerId, organizationId, { branchId, resourceId, source: "STAFF",
      startAt: new Date("2026-10-21T01:00:00Z"), endAt: new Date("2026-10-21T02:00:00Z") },
    new Date("2026-10-21T00:00:00Z"))).rejects.toMatchObject({ code: "ADVANCE_WINDOW" });
    await expect(cancelBooking(db, ownerId, organizationId, booking.id, "Too late",
      new Date("2026-10-20T00:00:00Z"))).rejects.toMatchObject({ code: "CANCELLATION_CUTOFF" });
    await db.update(schema.organizations).set({ planCode: "PROFESSIONAL" }).where(eq(schema.organizations.id, organizationId));
    const afterDowngrade = await createBooking(db, ownerId, organizationId, { branchId, resourceId,
      source: "STAFF", startAt: new Date("2026-10-22T01:00:00Z"),
      endAt: new Date("2026-10-22T02:00:00Z") }, new Date("2026-10-22T00:00:00Z"));
    expect(afterDowngrade.status).toBe("CONFIRMED");
    await db.update(schema.organizations).set({ planCode: "BUSINESS" }).where(eq(schema.organizations.id, organizationId));
  });
  it("deducts one monthly membership credit atomically and recredits on cancellation", async () => {
    await updateBusinessPolicy(db, ownerId, organizationId, {
      minimumNoticeMinutes: null, maximumAdvanceDays: null, maximumDurationMinutes: null,
      bookingBufferMinutes: 0, cancellationCutoffMinutes: null, rescheduleCutoffMinutes: null,
    });
    const plan = await createMembershipPlan(db, ownerId, organizationId, {
      name: "Monthly Hour", priceMinor: 2500, monthlyCreditsMinutes: 60,
    });
    const owned = await assignCustomerMembership(db, ownerId, organizationId, {
      customerId, planId: plan.id, startsAt: new Date("2026-10-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
    });
    const inputs = [24, 25].map(day => ({ branchId, resourceId, customerId, customerMembershipId: owned.id,
      source: "STAFF", startAt: new Date(`2026-10-${day}T01:00:00Z`),
      endAt: new Date(`2026-10-${day}T02:00:00Z`) }));
    const outcomes = await Promise.allSettled(inputs.map(input => createBooking(db, ownerId, organizationId, input, now)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const saved = outcomes.find(item => item.status === "fulfilled");
    if (!saved || saved.status !== "fulfilled") throw new Error("Expected one booking");
    expect(saved.value.totalAmount).toBe(0);
    const [balance] = await db.select().from(schema.customerMemberships).where(eq(schema.customerMemberships.id, owned.id));
    expect(balance.remainingCreditsMinutes).toBe(0);
    await cancelBooking(db, ownerId, organizationId, saved.value.id, "Changed plans", now);
    const [restored] = await db.select().from(schema.customerMemberships).where(eq(schema.customerMemberships.id, owned.id));
    expect(restored.remainingCreditsMinutes).toBe(60);
  });
  it("allows only one booking to consume the final package hour", async () => {
    const plan = await createPackagePlan(db, ownerId, organizationId, {
      name: "Single Hour", priceMinor: 2500, creditsMinutes: 60,
    });
    const owned = await issueCustomerPackage(db, ownerId, organizationId, { customerId, planId: plan.id }, now);
    const inputs = [26, 27].map(day => ({ branchId, resourceId, customerId, customerPackageId: owned.id,
      source: "STAFF", startAt: new Date(`2026-10-${day}T01:00:00Z`),
      endAt: new Date(`2026-10-${day}T02:00:00Z`) }));
    const outcomes = await Promise.allSettled(inputs.map(input => createBooking(db, ownerId, organizationId, input, now)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const [balance] = await db.select().from(schema.customerPackages).where(eq(schema.customerPackages.id, owned.id));
    expect(balance.remainingMinutes).toBe(0);
  });
  it("extends staff booking window for an active priority member only", async () => {
    await db.update(schema.resources).set({ maximumAdvanceDays: 7 }).where(eq(schema.resources.id, resourceId));
    const [otherSpace] = await db.insert(schema.resources).values({ organizationId, branchId, sportTypeId,
      name: "Court 2", maximumAdvanceDays: 7, bookingIntervalMinutes: 60 }).returning();
    const scopedPlan = await createMembershipPlan(db, ownerId, organizationId, {
      name: "Court 2 Priority", priceMinor: 3000, advanceDays: 14, resourceIds: [otherSpace.id],
    });
    await assignCustomerMembership(db, ownerId, organizationId, { customerId, planId: scopedPlan.id,
      startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-11-01T00:00:00Z") });
    const scopedSlots = await availableSlotsForResources(db, ownerId, organizationId,
      { branchId, resourceIds: [resourceId, otherSpace.id], localDate: "2026-10-11",
        durationMinutes: 60, customerId }, now);
    expect(scopedSlots[resourceId]).toHaveLength(0);
    expect(scopedSlots[otherSpace.id]?.length).toBeGreaterThan(0);
    const plan = await createMembershipPlan(db, ownerId, organizationId, {
      name: "Priority", priceMinor: 3000, advanceDays: 14,
    });
    await assignCustomerMembership(db, ownerId, organizationId, { customerId, planId: plan.id,
      startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-11-01T00:00:00Z") });
    const date = "2026-10-11", startAt = new Date("2026-10-11T01:00:00Z");
    const without = await availableSlotsForResources(db, ownerId, organizationId,
      { branchId, resourceIds: [resourceId], localDate: date, durationMinutes: 60 }, now);
    expect(without[resourceId]?.some(slot => slot.startAt.getTime() === startAt.getTime())).toBe(false);
    const withMember = await availableSlotsForResources(db, ownerId, organizationId,
      { branchId, resourceIds: [resourceId], localDate: date, durationMinutes: 60, customerId }, now);
    expect(withMember[resourceId]?.some(slot => slot.startAt.getTime() === startAt.getTime())).toBe(true);
    await expect(createBooking(db, ownerId, organizationId, { branchId, resourceId,
      source: "STAFF", startAt, endAt: new Date("2026-10-11T02:00:00Z") }, now))
      .rejects.toMatchObject({ code: "ADVANCE_WINDOW" });
    const memberBooking = await createBooking(db, ownerId, organizationId, { branchId, resourceId, customerId,
      source: "STAFF", startAt, endAt: new Date("2026-10-11T02:00:00Z") }, now);
    expect(memberBooking.status).toBe("CONFIRMED");
  });
});
