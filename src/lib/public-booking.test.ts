import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listStaffBookings, staffCalendar } from "@/lib/booking-management";
import { checkPublicRateLimit, publicAvailability, publicConfirmation, resolvePublicVenue,
  safePublicColor, submitPublicBooking } from "@/lib/public-booking";

describe("public guest booking", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-01T00:00:00.000Z");
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 5, hour - 8));
  let orgId = "", otherOrgId = "", branchId = "", otherBranchId = "", ownerId = "";
  let badmintonId = "", pickleballId = "", courtId = "", secondCourtId = "", foreignCourtId = "", existingCustomerId = "";
  const booking = (overrides: Record<string, unknown> = {}) => ({
    resourceId: courtId, startAt: at(10).toISOString(), durationMinutes: 60,
    name: "Guest Player", phone: "+60123456789", email: "guest@example.test",
    expectedPriceMinor: 2500, ...overrides,
  });
  async function occupy(resourceId = courtId) {
    await db.insert(schema.bookings).values({
      organizationId: orgId, branchId, resourceId, bookingReference: "BK-" + randomUUID().slice(0, 12),
      startAt: at(10), endAt: at(11), status: "CONFIRMED", source: "STAFF",
      subtotal: 2500, totalAmount: 2500, currency: "MYR",
    });
  }
  beforeAll(async () => {
    for (const file of ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman",
      "0003_panoramic_gravity", "0004_flashy_enchantress", "0005_soft_wrecker",
      "0006_graceful_miek", "0007_flaky_madelyne_pryor", "0008_worthless_expediter", "0009_steady_stephen_strange", "0010_white_dragon_man", "0011_broken_dragon_man", "0012_massive_marvel_zombies", "0013_rare_doctor_faustus", "0014_green_chronomancer"]) {
      const migration = readFileSync(resolve(`drizzle/${file}.sql`), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean))
        await postgres.exec(statement);
    }
    const organizations = await db.insert(schema.organizations).values([
      { name: "Smash Arena", slug: "smash-arena", displayName: "Smash Arena", onboardingCompletedAt: now,
        primaryColor: "#176b5b", city: "Petaling Jaya" },
      { name: "Another Venue", slug: "another-venue", onboardingCompletedAt: now, primaryColor: "#990000" },
    ]).returning();
    [orgId, otherOrgId] = organizations.map(item => item.id);
    ownerId = (await db.insert(schema.users).values({ name: "Owner", email: "public-owner@test.example" }).returning())[0].id;
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: ownerId, role: "OWNER" });
    const branches = await db.insert(schema.branches).values([
      { organizationId: orgId, name: "Main Venue", slug: "main", timezone: "Asia/Kuala_Lumpur" },
      { organizationId: otherOrgId, name: "Other", slug: "other", timezone: "Asia/Kuala_Lumpur" },
    ]).returning();
    [branchId, otherBranchId] = branches.map(item => item.id);
    const sports = await db.select().from(schema.sportTypes);
    badmintonId = sports.find(item => item.code === "BADMINTON")!.id;
    pickleballId = sports.find(item => item.code === "PICKLEBALL")!.id;
    await db.insert(schema.organizationSports).values([
      { organizationId: orgId, sportTypeId: badmintonId },
      { organizationId: orgId, sportTypeId: pickleballId },
      { organizationId: otherOrgId, sportTypeId: badmintonId },
    ]);
    const resources = await db.insert(schema.resources).values([
      { organizationId: orgId, branchId, sportTypeId: badmintonId, name: "Court 1",
        minimumDurationMinutes: 60, bookingIntervalMinutes: 60 },
      { organizationId: orgId, branchId, sportTypeId: badmintonId, name: "Court 2",
        minimumDurationMinutes: 60, bookingIntervalMinutes: 60 },
      { organizationId: otherOrgId, branchId: otherBranchId, sportTypeId: badmintonId, name: "Other Court",
        minimumDurationMinutes: 60, bookingIntervalMinutes: 60 },
    ]).returning();
    [courtId, secondCourtId, foreignCourtId] = resources.map(item => item.id);
    await db.insert(schema.basePrices).values([
      { organizationId: orgId, branchId, sportTypeId: badmintonId, amountMinor: 2500 },
      { organizationId: orgId, branchId, sportTypeId: pickleballId, amountMinor: 3000 },
      { organizationId: otherOrgId, branchId: otherBranchId, sportTypeId: badmintonId, amountMinor: 9000 },
    ]);
    existingCustomerId = (await db.insert(schema.customers).values({
      organizationId: orgId, name: "Existing Player", phone: "+60123456789", email: "guest@example.test",
    }).returning())[0].id;
  }, 30000);
  beforeEach(async () => {
    await db.delete(schema.notificationRecords);
    await db.delete(schema.bookingUsageRecords);
    await db.delete(schema.bookingStatusHistory);
    await db.delete(schema.bookings);
    await db.delete(schema.operatingHours);
    await db.delete(schema.rateLimits);
    await db.delete(schema.customers).where(and(eq(schema.customers.organizationId, orgId),
      eq(schema.customers.name, "Guest Player")));
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({
      organizationId: orgId, branchId, dayOfWeek, startMinute: 480, endMinute: 1440,
    })));
    await db.update(schema.organizations).set({ isActive: true, primaryColor: "#176b5b" })
      .where(eq(schema.organizations.id, orgId));
    await db.update(schema.branches).set({ isActive: true }).where(eq(schema.branches.id, branchId));
    await db.update(schema.basePrices).set({ amountMinor: 2500 })
      .where(and(eq(schema.basePrices.organizationId, orgId), eq(schema.basePrices.sportTypeId, badmintonId)));
  });
  afterAll(async () => postgres.close());
  it("resolves a valid slug and rejects invalid or unknown slugs", async () => {
    expect((await resolvePublicVenue(db, "smash-arena"))?.name).toBe("Smash Arena");
    expect(await resolvePublicVenue(db, "Smash Arena")).toBeNull();
    expect(await resolvePublicVenue(db, "missing")).toBeNull();
  });
  it("hides inactive organizations and branches", async () => {
    await db.update(schema.organizations).set({ isActive: false }).where(eq(schema.organizations.id, orgId));
    expect(await resolvePublicVenue(db, "smash-arena")).toBeNull();
    await db.update(schema.organizations).set({ isActive: true }).where(eq(schema.organizations.id, orgId));
    await db.update(schema.branches).set({ isActive: false }).where(eq(schema.branches.id, branchId));
    expect(await resolvePublicVenue(db, "smash-arena")).toBeNull();
  });
  it("shows assigned sports and only tenant branding", async () => {
    const venue = await resolvePublicVenue(db, "smash-arena");
    expect(venue?.sports.map(sport => sport.name)).toEqual(["Badminton", "Pickleball"]);
    expect(venue?.color).toBe("#176b5b");
    expect(venue?.name).not.toBe("Another Venue");
    expect(safePublicColor("#eeeeee")).toBe("#176b5b");
  });
  it("uses real availability to mark occupied slots, while another court stays open", async () => {
    await occupy();
    const grid = await publicAvailability(db, "smash-arena", {
      sportId: badmintonId, localDate: "2026-10-05", durationMinutes: 60,
    }, now);
    const row = grid.times.find(item => item.startAt === at(10).toISOString())!;
    expect(row.options.find(item => item.resourceId === courtId)?.available).toBe(false);
    expect(row.options.find(item => item.resourceId === secondCourtId)?.available).toBe(true);
    expect(grid.priceMinor).toBe(2500);
  });
  it("does not offer closed days", async () => {
    await db.delete(schema.operatingHours);
    const grid = await publicAvailability(db, "smash-arena", {
      sportId: badmintonId, localDate: "2026-10-05", durationMinutes: 60,
    }, now);
    expect(grid.closed).toBe(true);
    expect(grid.times).toHaveLength(0);
  });
  it("treats a weekday as closed even when adjacent weekdays are open", async () => {
    await db.delete(schema.operatingHours);
    await db.insert(schema.operatingHours).values({ organizationId: orgId, branchId, dayOfWeek: 2,
      startMinute: 480, endMinute: 1440 });
    const grid = await publicAvailability(db, "smash-arena", {
      sportId: badmintonId, localDate: "2026-10-05", durationMinutes: 60,
    }, now);
    expect(grid.closed).toBe(true);
  });
  it("creates a confirmed guest booking without authentication and server-calculates the total", async () => {
    const result = await submitPublicBooking(db, "smash-arena", { ...booking(), totalAmount: 1 }, now);
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    expect([saved.status, saved.source, saved.totalAmount, saved.amountPaid, saved.createdByUserId])
      .toEqual(["CONFIRMED", "ONLINE", 2500, 0, null]);
    expect(result.token).toHaveLength(43);
    const confirmation = await publicConfirmation(db, "smash-arena", result.token);
    expect(confirmation).toMatchObject({ totalAmount: 2500, amountPaid: 0, paymentRequirement: "NO_UPFRONT" });
    expect(confirmation!.totalAmount - confirmation!.amountPaid).toBe(2500);
    expect(confirmation?.paymentHistory).toHaveLength(0);
  });
  it("appears immediately in the owner booking list and calendar", async () => {
    const result = await submitPublicBooking(db, "smash-arena", booking(), now);
    const list = await listStaffBookings(db, ownerId, orgId, { view: "all" }, now);
    const calendar = await staffCalendar(db, ownerId, orgId, { view: "day", date: "2026-10-05" }, now);
    expect(list.rows.some(row => row.reference === result.reference && row.source === "ONLINE")).toBe(true);
    expect(calendar.rows.some(row => row.reference === result.reference)).toBe(true);
  });
  it("reuses a customer only when name, phone, and email match within the venue", async () => {
    const result = await submitPublicBooking(db, "smash-arena", booking({ name: "Existing Player" }), now);
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    expect(saved.customerId).toBe(existingCustomerId);
  });
  it("does not associate a matching contact from another organization", async () => {
    await db.insert(schema.customers).values({ organizationId: otherOrgId, name: "Foreign Player",
      phone: "+60120008888", email: "foreign@example.test" });
    const result = await submitPublicBooking(db, "smash-arena",
      booking({ name: "Foreign Player", phone: "+60120008888", email: "foreign@example.test" }), now);
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    const [associated] = await db.select().from(schema.customers).where(eq(schema.customers.id, saved.customerId!));
    expect(associated.organizationId).toBe(orgId);
  });
  it("creates a new minimum customer record when details do not match", async () => {
    const result = await submitPublicBooking(db, "smash-arena",
      booking({ phone: "+60120009999", email: "new@example.test" }), now);
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, saved.customerId!));
    expect(customer.organizationId).toBe(orgId);
    expect(customer.email).toBe("new@example.test");
  });
  it("never accepts a forged or stale price as the booking total", async () => {
    await expect(submitPublicBooking(db, "smash-arena", booking({ expectedPriceMinor: 1 }), now))
      .rejects.toMatchObject({ code: "PRICE_CHANGED" });
    const result = await submitPublicBooking(db, "smash-arena", booking({ totalAmount: 1 }), now);
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    expect(saved.totalAmount).toBe(2500);
  });
  it("rejects duplicate booking and stale slot submission", async () => {
    await occupy();
    await expect(submitPublicBooking(db, "smash-arena", booking(), now))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a cross-tenant space and future date beyond the public horizon", async () => {
    await expect(submitPublicBooking(db, "smash-arena", booking({ resourceId: foreignCourtId }), now))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(publicAvailability(db, "smash-arena", {
      sportId: badmintonId, localDate: "2027-02-01", durationMinutes: 60,
    }, now)).rejects.toMatchObject({ code: "INVALID_DATE" });
  });
  it("shows confirmation only for its opaque link and correct venue", async () => {
    const result = await submitPublicBooking(db, "smash-arena", booking({ name: "Existing Player" }), now);
    const detail = await publicConfirmation(db, "smash-arena", result.token);
    expect(detail?.reference).toBe(result.reference);
    expect(detail?.customerName).toBe("Existing Player");
    expect(detail?.totalAmount).toBe(2500);
    expect(await publicConfirmation(db, "another-venue", result.token)).toBeNull();
    expect(await publicConfirmation(db, "smash-arena", "x".repeat(43))).toBeNull();
    const hash = createHash("sha256").update(result.token).digest("hex");
    const [saved] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, result.bookingId));
    expect(saved.publicAccessTokenHash).toBe(hash);
  });
  it("rate-limits repeated requests with separate hashed identities", async () => {
    await checkPublicRateLimit(db, "visitor-one", 2, 60_000, 100_000);
    await checkPublicRateLimit(db, "visitor-one", 2, 60_000, 100_001);
    await expect(checkPublicRateLimit(db, "visitor-one", 2, 60_000, 100_002))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(checkPublicRateLimit(db, "visitor-two", 2, 60_000, 100_002)).resolves.toBeUndefined();
    await expect(checkPublicRateLimit(db, "visitor-one", 2, 60_000, 200_000)).resolves.toBeUndefined();
  });
  it("allows only one of two simultaneous customers to reserve the same slot", async () => {
    const results = await Promise.allSettled([
      submitPublicBooking(db, "smash-arena", booking({ phone: "+60121111111", email: "one@example.test" }), now),
      submitPublicBooking(db, "smash-arena", booking({ phone: "+60122222222", email: "two@example.test" }), now),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const saved = await db.select().from(schema.bookings).where(eq(schema.bookings.organizationId, orgId));
    expect(saved).toHaveLength(1);
  });
});








