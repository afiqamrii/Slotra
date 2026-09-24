import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { businessAnalytics } from "@/lib/business-analytics";
import { addCustomerTag, customerSegments, removeCustomerTag } from "@/lib/business-segments";

describe("Business customer insights", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-01T12:00:00Z");
  let ownerId = "", viewerId = "", businessId = "", professionalId = "", otherId = "";
  let newId = "", regularId = "", frequentId = "", inactiveId = "", rebookedId = "", otherCustomerId = "";
  let promoBookingId = "", usageBookingId = "", packageId = "";
  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as
      { entries: { tag: string }[] };
    for (const { tag } of journal.entries)
      for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8")
        .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean))
        await postgres.exec(statement);
    const people = await db.insert(schema.users).values([
      { name: "Owner", email: "insights-owner@example.test" },
      { name: "Viewer", email: "insights-viewer@example.test" },
    ]).returning();
    [ownerId, viewerId] = people.map(item => item.id);
    const orgs = await db.insert(schema.organizations).values([
      { name: "Business", slug: "insights-business", planCode: "BUSINESS" },
      { name: "Professional", slug: "insights-professional", planCode: "PROFESSIONAL" },
      { name: "Other", slug: "insights-other", planCode: "BUSINESS" },
    ]).returning();
    [businessId, professionalId, otherId] = orgs.map(item => item.id);
    await db.insert(schema.organizationMembers).values([
      { organizationId: businessId, userId: ownerId, role: "OWNER" },
      { organizationId: businessId, userId: viewerId, role: "VIEWER" },
    ]);
    const branch = (await db.insert(schema.branches).values({
      organizationId: businessId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur",
    }).returning())[0];
    const otherBranch = (await db.insert(schema.branches).values({
      organizationId: otherId, name: "Other", slug: "other",
    }).returning())[0];
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    const court = (await db.insert(schema.resources).values({
      organizationId: businessId, branchId: branch.id, sportTypeId: sport.id, name: "Court 1",
    }).returning())[0];
    const otherCourt = (await db.insert(schema.resources).values({
      organizationId: otherId, branchId: otherBranch.id, sportTypeId: sport.id, name: "Other Court",
    }).returning())[0];
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) =>
      ({ organizationId: businessId, branchId: branch.id, dayOfWeek, startMinute: 480, endMinute: 1320 })));
    const customers = await db.insert(schema.customers).values([
      { organizationId: businessId, name: "New Player", phone: "0111111111", createdAt: new Date("2026-09-25T00:00:00Z") },
      { organizationId: businessId, name: "Regular", phone: "0122222222", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: businessId, name: "Frequent", phone: "0133333333", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: businessId, name: "Long Inactive", phone: "0144444444", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: businessId, name: "Rebooked", phone: "0155555555", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: otherId, name: "Other Customer", phone: "0199999999", createdAt: new Date("2026-01-01T00:00:00Z") },
    ]).returning();
    [newId, regularId, frequentId, inactiveId, rebookedId, otherCustomerId] = customers.map(item => item.id);
    let sequence = 0;
    const seedBooking = async (customerId: string, date: string, totalAmount: number, orgId = businessId,
      branchId = branch.id, resourceId = court.id, discountAmount = 0, durationMinutes = 60) => {
      const startAt = new Date(`${date}T01:00:00Z`);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
      return (await db.insert(schema.bookings).values({
        organizationId: orgId, branchId, resourceId, customerId,
        bookingReference: `BI-${++sequence}`,
        startAt, endAt, status: "COMPLETED", source: "STAFF",
        subtotal: totalAmount + discountAmount, discountAmount, totalAmount, currency: "MYR",
      }).returning())[0];
    };
    const mainBookings = [];
    mainBookings.push(await seedBooking(newId, "2026-09-28", 2500,
      businessId, branch.id, court.id, 500));
    for (const date of ["2026-08-01", "2026-08-10", "2026-08-20"])
      mainBookings.push(await seedBooking(regularId, date, 3000));
    for (const date of ["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-15"])
      mainBookings.push(await seedBooking(frequentId, date, 10000,
        businessId, branch.id, court.id, 0, date === "2026-09-15" ? 120 : 60));
    for (const date of ["2026-05-01", "2026-07-01"])
      mainBookings.push(await seedBooking(inactiveId, date, 1000));
    mainBookings.push(await seedBooking(rebookedId, "2026-07-15", 1000));
    const future = await seedBooking(rebookedId, "2026-10-10", 1000);
    await db.update(schema.bookings).set({ status: "CONFIRMED" }).where(eq(schema.bookings.id, future.id));
    promoBookingId = mainBookings[0].id; usageBookingId = mainBookings[7].id;
    await seedBooking(otherCustomerId, "2026-09-20", 999_000, otherId, otherBranch.id, otherCourt.id);
    await db.insert(schema.bookingUsageRecords).values(mainBookings.map(booking => ({
      organizationId: businessId, bookingId: booking.id,
      periodStartAt: new Date("2026-01-01T00:00:00Z"), periodEndAt: new Date("2027-01-01T00:00:00Z"),
      confirmedAt: booking.startAt,
    })));
    const plan = (await db.insert(schema.membershipPlans).values({
      organizationId: businessId, name: "Regular", priceMinor: 3000,
    }).returning())[0];
    await db.insert(schema.customerMemberships).values({
      organizationId: businessId, customerId: frequentId, planId: plan.id,
      startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-11-01T00:00:00Z"),
    });
    const packagePlan = (await db.insert(schema.packagePlans).values({
      organizationId: businessId, name: "Ten hours", priceMinor: 25_000, creditsMinutes: 600,
    }).returning())[0];
    const pack = (await db.insert(schema.customerPackages).values({
      organizationId: businessId, customerId: frequentId, planId: packagePlan.id,
      totalMinutes: 600, remainingMinutes: 480, createdByUserId: ownerId,
      createdAt: new Date("2026-09-10T00:00:00Z"), expiresAt: new Date("2026-10-20T00:00:00Z"),
    }).returning())[0];
    packageId = pack.id;
    await db.insert(schema.packageUsages).values({
      organizationId: businessId, customerPackageId: packageId, bookingId: usageBookingId,
      minutes: 120, createdAt: new Date("2026-09-15T00:00:00Z"),
    });
    const promo = (await db.insert(schema.promotions).values({
      organizationId: businessId, code: "WELCOME", name: "Welcome", discountType: "FIXED",
      discountValue: 500, usedCount: 1, startsAt: new Date("2026-09-01T00:00:00Z"),
      endsAt: new Date("2026-11-01T00:00:00Z"),
    }).returning())[0];
    await db.insert(schema.promotionRedemptions).values({
      organizationId: businessId, promotionId: promo.id, bookingId: promoBookingId,
      customerId: newId, discountMinor: 500,
    });
  });
  afterAll(async () => postgres.close());

  it("classifies customers with deterministic activity and excludes other tenants", async () => {
    const result = await customerSegments(db, ownerId, businessId, {}, now);
    expect(result.counts).toMatchObject({
      all: 5, new: 1, returning: 3, frequent: 1, high_spend: 1, inactive_30: 1, inactive_60: 1,
    });
    expect(result.regularInactive30).toBe(1);
    expect(result.customers.every(item => item.id !== otherCustomerId)).toBe(true);
    expect((await customerSegments(db, ownerId, businessId, { segment: "inactive_30" }, now))
      .customers.map(item => item.id)).toEqual([regularId]);
    expect((await customerSegments(db, ownerId, businessId, { search: "013333" }, now))
      .customers.map(item => item.id)).toEqual([frequentId]);
    expect(result.customers.find(item => item.id === rebookedId)?.futureCount).toBe(1);
  });
  it("rejects Professional and unauthorized roles from direct customer-insight calls", async () => {
    await expect(customerSegments(db, ownerId, professionalId, {}, now)).rejects.toThrow();
    await expect(customerSegments(db, viewerId, businessId, {}, now)).rejects.toThrow("access denied");
    await expect(businessAnalytics(db, viewerId, businessId, {}, now)).rejects.toThrow("access denied");
    await expect(customerSegments(db, ownerId, otherId, {}, now)).rejects.toThrow("access denied");
  });
  it("creates and removes manual tags only for customers in the authorized organization", async () => {
    const tag = await addCustomerTag(db, ownerId, businessId, { customerId: regularId, label: "VIP" });
    expect(tag?.label).toBe("VIP");
    expect(await addCustomerTag(db, ownerId, businessId, { customerId: regularId, label: "vip" })).toBeNull();
    expect((await customerSegments(db, ownerId, businessId, { search: "Regular" }, now))
      .customers[0].tags.map(item => item.label)).toEqual(["VIP"]);
    await expect(addCustomerTag(db, ownerId, businessId, {
      customerId: otherCustomerId, label: "VIP",
    })).rejects.toThrow("not found at this venue");
    await expect(removeCustomerTag(db, ownerId, otherId, tag!.id)).rejects.toThrow();
    await expect(addCustomerTag(db, viewerId, businessId, {
      customerId: newId, label: "Student",
    })).rejects.toThrow("access denied");
    await removeCustomerTag(db, ownerId, businessId, tag!.id);
    expect(await db.select().from(schema.customerTags).where(eq(schema.customerTags.id, tag!.id))).toEqual([]);
  });
  it("reports benefit usage and retention but never infers manual sale revenue", async () => {
    const result = await businessAnalytics(db, ownerId, businessId, { range: "last30" }, now);
    expect(result.memberships).toMatchObject({ active: 1, activePlans: 1, memberBookings: 3, revenueMinor: null });
    expect(result.packages).toMatchObject({
      issued: 1, creditsUsedMinutes: 120, creditsRemainingMinutes: 480,
      expiringWithin30Days: 1, sold: null,
    });
    expect(result.promotions).toMatchObject({ redemptions: 1, discountMinor: 500, bookingValueMinor: 2500 });
    expect(result.retention).toMatchObject({ inactive30: 1, inactive60: 1, regularInactive30: 1 });
    expect(result.promotions.bookingValueMinor).not.toBe(999_000);
    await expect(businessAnalytics(db, ownerId, professionalId, {}, now)).rejects.toThrow();
  });
});
