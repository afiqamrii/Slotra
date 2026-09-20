import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createOrganization } from "@/lib/organization-service";
import { availableSlotsForResources, isResourceAvailable } from "@/lib/booking-availability";
import { listStaffBookings, searchBookingCustomers, staffAvailableNow, staffBookingDetail, staffCalendar } from "@/lib/booking-management";
import { cancelBooking, checkInBooking, completeBooking, confirmBooking, createBooking, createResourceBlock, noShowBooking, quoteReschedule, rescheduleBooking, transitionBooking } from "@/lib/booking-service";
import { bookingUsageStage, getBookingUsage, usagePeriod } from "@/lib/booking-usage";
import { basicReport, basicReportSeries, csvDocument, exportBookings, exportCustomers, starterPlanUsage } from "@/lib/starter-reporting";

describe("booking and availability engine", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-01T00:00:00.000Z");
  const at = (localHour: number, day = 5) => new Date(Date.UTC(2026, 9, day) + (localHour - 8) * 3_600_000);
  let ownerId = "", staffId = "", viewerId = "", otherId = "", orgId = "", otherOrgId = "", branchId = "", resourceId = "", secondId = "", customerId = "", sportId = "";
  const request = (startAt = at(8), endAt = at(9), overrides: Record<string, unknown> = {}) => ({
    branchId, resourceId, startAt, endAt, source: "STAFF", ...overrides,
  });
  async function direct(status: string, startAt = at(8), endAt = at(9), space = resourceId) {
    const [booking] = await db.insert(schema.bookings).values({
      organizationId: orgId, branchId, resourceId: space, bookingReference: "BK-" + randomUUID().slice(0, 12),
      startAt, endAt, status, source: "STAFF", subtotal: 2500, totalAmount: 2500, currency: "MYR",
    }).returning();
    return booking;
  }
  beforeAll(async () => {
    for (const file of ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman", "0003_panoramic_gravity", "0004_flashy_enchantress", "0005_soft_wrecker", "0006_graceful_miek", "0007_flaky_madelyne_pryor", "0008_worthless_expediter", "0009_steady_stephen_strange", "0010_white_dragon_man", "0011_broken_dragon_man", "0012_massive_marvel_zombies", "0013_rare_doctor_faustus", "0014_green_chronomancer"]) {
      const migration = readFileSync(resolve(`drizzle/${file}.sql`), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    }
    const users = await db.insert(schema.users).values([
      { name: "Owner", email: "booking-owner@test.example" }, { name: "Staff", email: "booking-staff@test.example" },
      { name: "Viewer", email: "booking-viewer@test.example" }, { name: "Other", email: "booking-other@test.example" },
    ]).returning();
    [ownerId, staffId, viewerId, otherId] = users.map(user => user.id);
    orgId = (await createOrganization(db, ownerId, { name: "Booking Test", slug: "booking-test" })).id;
    otherOrgId = (await createOrganization(db, otherId, { name: "Other Test", slug: "other-booking-test" })).id;
    await db.insert(schema.organizationMembers).values([
      { organizationId: orgId, userId: staffId, role: "STAFF" },
      { organizationId: orgId, userId: viewerId, role: "VIEWER" },
    ]);
    sportId = (await db.select({ id: schema.sportTypes.id }).from(schema.sportTypes).where(eq(schema.sportTypes.code, "BADMINTON")))[0].id;
    branchId = (await db.insert(schema.branches).values({ organizationId: orgId, name: "Main Venue", slug: "main-venue", timezone: "Asia/Kuala_Lumpur" }).returning())[0].id;
    const spaces = await db.insert(schema.resources).values([
      { organizationId: orgId, branchId, sportTypeId: sportId, name: "Court 1", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: 180 },
      { organizationId: orgId, branchId, sportTypeId: sportId, name: "Court 2", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: 180 },
    ]).returning();
    [resourceId, secondId] = spaces.map(space => space.id);
    customerId = (await db.insert(schema.customers).values({ organizationId: orgId, name: "Guest", phone: "+60123456789" }).returning())[0].id;
    await db.insert(schema.basePrices).values({ organizationId: orgId, branchId, sportTypeId: sportId, amountMinor: 2500 });
  }, 30000);
  beforeEach(async () => {
    await db.delete(schema.notificationRecords);
    await db.delete(schema.bookingUsageRecords);
    await db.delete(schema.bookingStatusHistory);
    await db.delete(schema.bookings);
    await db.delete(schema.resourceBlocks);
    await db.delete(schema.operatingHours);
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: orgId, branchId, dayOfWeek, startMinute: 480, endMinute: 1440 })));
    await db.update(schema.resources).set({ status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60,
      maximumDurationMinutes: 180, minimumAdvanceMinutes: 0, maximumAdvanceDays: null }).where(eq(schema.resources.organizationId, orgId));
    await db.update(schema.basePrices).set({ amountMinor: 2500 }).where(eq(schema.basePrices.organizationId, orgId));
  });
  afterAll(async () => postgres.close());

  it("creates a confirmed booking with tenant ownership, random reference, price snapshot, and history", async () => {
    const booking = await createBooking(db, ownerId, orgId, { ...request(), customerId, totalAmount: 1 }, now);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.bookingReference).toMatch(/^BK-[0-9A-F]{12}$/);
    expect(booking.organizationId).toBe(orgId);
    expect(booking.customerId).toBe(customerId);
    expect([booking.subtotal, booking.discountAmount, booking.taxAmount, booking.totalAmount, booking.amountPaid]).toEqual([2500, 0, 0, 2500, 0]);
    expect((await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, booking.id)))[0].newStatus).toBe("CONFIRMED");
  });
  it("rejects overlapping bookings while allowing adjacent [start,end) ranges", async () => {
    await createBooking(db, staffId, orgId, request(), now);
    await expect(createBooking(db, staffId, orgId, request(at(8), at(9)), now)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await createBooking(db, staffId, orgId, request(at(9), at(10)), now)).status).toBe("CONFIRMED");
  });
  it("rejects inactive and maintenance spaces", async () => {
    await db.update(schema.resources).set({ status: "DISABLED" }).where(eq(schema.resources.id, resourceId));
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "RESOURCE_INACTIVE" });
    await db.update(schema.resources).set({ status: "MAINTENANCE" }).where(eq(schema.resources.id, resourceId));
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "RESOURCE_INACTIVE" });
  });
  it("rejects maintenance blocks and blocks that overlap active reservations", async () => {
    await createResourceBlock(db, ownerId, orgId, { branchId, resourceId, startAt: at(10), endAt: at(11), type: "MAINTENANCE", reason: "Repair" });
    await expect(createBooking(db, ownerId, orgId, request(at(10), at(11)), now)).rejects.toMatchObject({ code: "BLOCKED" });
    await createBooking(db, ownerId, orgId, request(at(8), at(9)), now);
    await expect(createResourceBlock(db, ownerId, orgId, { branchId, resourceId, startAt: at(8), endAt: at(9), type: "MANUAL" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("supports private-event and other blocks with a reason", async () => {
    const event = await createResourceBlock(db, ownerId, orgId, { branchId, resourceId, startAt: at(8), endAt: at(9), type: "PRIVATE_EVENT", reason: "Club tournament" });
    expect(event.type).toBe("PRIVATE_EVENT");
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "BLOCKED" });
    const other = await createResourceBlock(db, ownerId, orgId, { branchId, resourceId, startAt: at(9), endAt: at(10), type: "OTHER", reason: "Safety inspection" });
    expect(other.reason).toBe("Safety inspection");
  });  it("rejects times outside opening hours, including a closed day", async () => {
    await expect(createBooking(db, ownerId, orgId, request(at(7), at(8)), now)).rejects.toMatchObject({ code: "CLOSED" });
    await db.delete(schema.operatingHours).where(and(eq(schema.operatingHours.organizationId, orgId), eq(schema.operatingHours.dayOfWeek, 1)));
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "CLOSED" });
  });
  it("handles midnight close and overnight windows after midnight", async () => {
    await createBooking(db, ownerId, orgId, request(at(23), at(24)), now);
    await db.delete(schema.notificationRecords); await db.delete(schema.bookingUsageRecords); await db.delete(schema.bookingStatusHistory); await db.delete(schema.bookings); await db.delete(schema.operatingHours);
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: orgId, branchId, dayOfWeek, startMinute: 1080, endMinute: 1560 })));
    expect((await createBooking(db, ownerId, orgId, request(at(1, 6), at(2, 6)), now)).status).toBe("CONFIRMED");
    const slots = await availableSlotsForResources(db, ownerId, orgId, { branchId, resourceIds: [resourceId], localDate: "2026-10-06" }, now);
    expect(slots[resourceId].some(slot => slot.startAt.getTime() === at(1, 6).getTime())).toBe(false);
    expect(slots[resourceId].some(slot => slot.startAt.getTime() === at(0, 6).getTime())).toBe(true);
  });
  it("enforces minimum, maximum, interval, and advance-window rules", async () => {
    await expect(createBooking(db, ownerId, orgId, request(at(8), at(8.5)), now)).rejects.toMatchObject({ code: "INVALID_DURATION" });
    await expect(createBooking(db, ownerId, orgId, request(at(8), at(12)), now)).rejects.toMatchObject({ code: "INVALID_DURATION" });
    await expect(createBooking(db, ownerId, orgId, request(at(8.5), at(9.5)), now)).rejects.toMatchObject({ code: "INTERVAL" });
    await db.update(schema.resources).set({ minimumAdvanceMinutes: 60 * 24 * 5 }).where(eq(schema.resources.id, resourceId));
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "ADVANCE_WINDOW" });
    await db.update(schema.resources).set({ minimumAdvanceMinutes: 0, maximumAdvanceDays: 2 }).where(eq(schema.resources.id, resourceId));
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "ADVANCE_WINDOW" });
  });
  it("cancellation releases the slot and records reason/time", async () => {
    const booking = await createBooking(db, ownerId, orgId, request(), now);
    const cancelled = await cancelBooking(db, staffId, orgId, booking.id, "Guest asked", now);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).toEqual(now);
    expect(cancelled.cancellationReason).toBe("Guest asked");
    expect((await createBooking(db, ownerId, orgId, request(), now)).status).toBe("CONFIRMED");
  });
  it("rescheduling validates a new slot and does not conflict with itself", async () => {
    const booking = await createBooking(db, ownerId, orgId, request(), now);
    const same = await rescheduleBooking(db, ownerId, orgId, booking.id, { startAt: at(8), endAt: at(9) }, now);
    expect(same.id).toBe(booking.id);
    const moved = await rescheduleBooking(db, ownerId, orgId, booking.id, { startAt: at(9), endAt: at(10) }, now);
    expect(moved.startAt).toEqual(at(9));
    await createBooking(db, ownerId, orgId, request(at(10), at(11)), now);
    await expect(rescheduleBooking(db, ownerId, orgId, booking.id, { startAt: at(10), endAt: at(11) }, now)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, booking.id))).filter(event => event.eventType === "RESCHEDULED")).toHaveLength(2);
  });
  it("denies cross-tenant resources, customers, and viewer mutations", async () => {
    await expect(createBooking(db, otherId, otherOrgId, request(), now)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(createBooking(db, otherId, orgId, request(), now)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(createBooking(db, viewerId, orgId, request(), now)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const [foreignCustomer] = await db.insert(schema.customers).values({ organizationId: otherOrgId, name: "Foreign", phone: "12345678" }).returning();
    await expect(createBooking(db, ownerId, orgId, { ...request(), customerId: foreignCustomer.id }, now)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });
  it("preserves historical money after base-rate changes and prices duration on the server", async () => {
    const booking = await createBooking(db, ownerId, orgId, request(at(8), at(10)), now);
    expect(booking.totalAmount).toBe(5000);
    await db.update(schema.basePrices).set({ amountMinor: 3000 }).where(eq(schema.basePrices.organizationId, orgId));
    const [historical] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
    expect(historical.totalAmount).toBe(5000);
    expect((await createBooking(db, ownerId, orgId, request(at(10), at(11)), now)).totalAmount).toBe(3000);
  });
  it("allows legal transitions and rejects arbitrary or terminal transitions", async () => {
    const booking = await createBooking(db, ownerId, orgId, request(), now);
    await expect(completeBooking(db, ownerId, orgId, booking.id, now)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await checkInBooking(db, staffId, orgId, booking.id, now)).status).toBe("CHECKED_IN");
    expect((await transitionBooking(db, staffId, orgId, booking.id, "IN_PROGRESS", undefined, now)).status).toBe("IN_PROGRESS");
    expect((await completeBooking(db, staffId, orgId, booking.id, now)).status).toBe("COMPLETED");
    await expect(cancelBooking(db, ownerId, orgId, booking.id, undefined, now)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it("no-show, cancelled, expired and pending rows do not block availability", async () => {
    const booked = await createBooking(db, ownerId, orgId, request(), now);
    expect((await noShowBooking(db, ownerId, orgId, booked.id, now)).status).toBe("NO_SHOW");
    await direct("CANCELLED"); await direct("EXPIRED"); await direct("PENDING"); await direct("AWAITING_PAYMENT");
    expect((await isResourceAvailable(db, ownerId, orgId, { branchId, resourceId, startAt: at(8), endAt: at(9) }, now)).available).toBe(true);
    const [pending] = await db.select().from(schema.bookings).where(eq(schema.bookings.status, "PENDING")).limit(1);
    expect((await confirmBooking(db, ownerId, orgId, pending.id, now)).status).toBe("CONFIRMED");
    await expect(createBooking(db, ownerId, orgId, request(), now)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("generates time-first slots with booking conflicts excluded and batches multiple resources", async () => {
    await createBooking(db, ownerId, orgId, request(at(10), at(11)), now);
    const selectSpy = vi.spyOn(db, "select");
    const slots = await availableSlotsForResources(db, ownerId, orgId, { branchId, resourceIds: [resourceId, secondId], localDate: "2026-10-05" }, now);
    const queryCount = selectSpy.mock.calls.length;
    selectSpy.mockRestore();
    expect(queryCount).toBeLessThanOrEqual(8);
    expect(slots[resourceId].some(slot => slot.startAt.getTime() === at(10).getTime())).toBe(false);
    expect(slots[resourceId].some(slot => slot.startAt.getTime() === at(11).getTime())).toBe(true);
    expect(slots[secondId].some(slot => slot.startAt.getTime() === at(10).getTime())).toBe(true);
  });
  it("honors resource-specific hours within branch hours", async () => {
    await db.insert(schema.operatingHours).values({ organizationId: orgId, branchId, resourceId, dayOfWeek: 1, startMinute: 600, endMinute: 720 });
    await expect(createBooking(db, ownerId, orgId, request(at(8), at(9)), now)).rejects.toMatchObject({ code: "CLOSED" });
    expect((await createBooking(db, ownerId, orgId, request(at(10), at(11)), now)).status).toBe("CONFIRMED");
  });
  it("rejects invalid ranges and impossible money at the database boundary", async () => {
    await expect(createBooking(db, ownerId, orgId, request(at(9), at(8)), now)).rejects.toThrow();
    await expect(createBooking(db, ownerId, orgId, request(at(8), at(8)), now)).rejects.toThrow();
    await expect(db.insert(schema.bookings).values({ organizationId: orgId, branchId, resourceId, bookingReference: "BK-INVALID", startAt: at(8), endAt: at(9),
      status: "CONFIRMED", source: "STAFF", subtotal: 2500, totalAmount: -1, currency: "MYR" })).rejects.toThrow();
  });
  it("generates both occurrences of a repeated daylight-saving hour", async () => {
    await db.update(schema.branches).set({ timezone: "America/New_York" }).where(eq(schema.branches.id, branchId));
    await db.delete(schema.operatingHours);
    await db.insert(schema.operatingHours).values({ organizationId: orgId, branchId, dayOfWeek: 0, startMinute: 0, endMinute: 240 });
    try {
      const slots = await availableSlotsForResources(db, ownerId, orgId, { branchId, resourceIds: [resourceId], localDate: "2026-11-01" }, now);
      expect(slots[resourceId].map(slot => slot.startAt.toISOString())).toEqual([
        "2026-11-01T04:00:00.000Z", "2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z",
        "2026-11-01T07:00:00.000Z", "2026-11-01T08:00:00.000Z",
      ]);
    } finally {
      await db.update(schema.branches).set({ timezone: "Asia/Kuala_Lumpur" }).where(eq(schema.branches.id, branchId));
    }
  });
  it("uses a constant number of batched reads for twenty spaces", async () => {
    const extra = await db.insert(schema.resources).values(Array.from({ length: 18 }, (_, index) => ({
      organizationId: orgId, branchId, sportTypeId: sportId, name: `Batch Court ${index + 1}`,
      bookingIntervalMinutes: 60, minimumDurationMinutes: 60,
    }))).returning();
    try {
      const ids = [resourceId, secondId, ...extra.map(space => space.id)];
      const spy = vi.spyOn(db, "select");
      const slots = await availableSlotsForResources(db, ownerId, orgId, { branchId, resourceIds: ids, localDate: "2026-10-05" }, now);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      expect(Object.keys(slots)).toHaveLength(20);
      expect(count).toBeLessThanOrEqual(8);
    } finally {
      for (const space of extra) await db.delete(schema.resources).where(eq(schema.resources.id, space.id));
    }
  });  it("enforces exclusion constraints even for direct overlapping writes", async () => {
    await direct("CONFIRMED");
    await expect(direct("CONFIRMED")).rejects.toThrow();
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.status, "CONFIRMED")))).toHaveLength(1);
  });
  it("allows exactly one of two near-simultaneous reservations", async () => {
    const results = await Promise.allSettled([
      createBooking(db, staffId, orgId, request(), now),
      createBooking(db, ownerId, orgId, request(), now),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.status, "CONFIRMED")))).toHaveLength(1);
  });

  it("lists and searches only this organization's bookings", async () => {
    const booking = await createBooking(db, staffId, orgId, { ...request(), customerId }, now);
    const today = await listStaffBookings(db, ownerId, orgId, { view: "today", date: "2026-10-05" }, now);
    expect(today.rows.map(row => row.id)).toContain(booking.id);
    for (const q of [booking.bookingReference, "Guest", "0123456789"]) {
      const result = await listStaffBookings(db, ownerId, orgId, { view: "today", date: "2026-10-05", q }, now);
      expect(result.rows.map(row => row.id)).toContain(booking.id);
    }
    expect((await listStaffBookings(db, otherId, otherOrgId, { view: "today", date: "2026-10-05" }, now)).rows).toHaveLength(0);
  });
  it("looks up existing customers with counts without exposing other tenants", async () => {
    await createBooking(db, staffId, orgId, { ...request(), customerId }, now);
    const matches = await searchBookingCustomers(db, staffId, orgId, "0123456789");
    expect(matches[0]).toMatchObject({ id: customerId, previousBookings: 1 });
    expect(await searchBookingCustomers(db, otherId, otherOrgId, "0123456789")).toHaveLength(0);
    await expect(searchBookingCustomers(db, viewerId, orgId, "Guest")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("creates a new customer atomically with a staff booking", async () => {
    const booking = await createBooking(db, staffId, orgId, request(at(9), at(10), {
      newCustomer: { name: "Afiq Amri", phone: "0123456789", email: "afiq@test.example" },
    }), now);
    expect(booking.customerId).toBeTruthy();
    const detail = await staffBookingDetail(db, ownerId, orgId, booking.id);
    expect(detail.customer?.name).toBe("Afiq Amri");
    expect(detail.customer?.organizationId).toBe(orgId);
  });
  it("creates walk-ins only on genuinely available spaces", async () => {
    const booking = await createBooking(db, staffId, orgId, request(at(10), at(11), { source: "WALK_IN" }), now);
    expect(booking.source).toBe("WALK_IN");
    await expect(createBooking(db, staffId, orgId, request(at(10), at(11), { source: "WALK_IN" }), now))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("reports available-now from live bookings, blocks, and maintenance", async () => {
    await createBooking(db, staffId, orgId, request(at(8), at(9)), now);
    await createResourceBlock(db, ownerId, orgId, { branchId, resourceId: secondId, startAt: at(8), endAt: at(9), type: "MAINTENANCE", reason: "Net repair" });
    const live = await staffAvailableNow(db, ownerId, orgId, branchId, at(8.5));
    expect(live.spaces.find(space => space.id === resourceId)?.state).toBe("IN_USE");
    expect(live.spaces.find(space => space.id === secondId)?.state).toBe("BLOCKED");
    await db.update(schema.resources).set({ status: "MAINTENANCE" }).where(eq(schema.resources.id, secondId));
    expect((await staffAvailableNow(db, ownerId, orgId, branchId, at(8.5))).spaces.find(space => space.id === secondId)?.state).toBe("MAINTENANCE");
  });
  it("loads calendar rows for the branch-local day and rejects foreign detail IDs", async () => {
    const booking = await createBooking(db, staffId, orgId, { ...request(), customerId }, now);
    const calendar = await staffCalendar(db, ownerId, orgId, { view: "day", date: "2026-10-05", branchId }, now);
    expect(calendar.rows.map(row => row.id)).toContain(booking.id);
    expect(calendar.from.toISOString()).toBe("2026-10-04T16:00:00.000Z");
    await expect(staffBookingDetail(db, otherId, otherOrgId, booking.id)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" });
  });
  it("previews and saves a changed space and duration through the engine", async () => {
    const booking = await createBooking(db, staffId, orgId, request(), now);
    const target = { resourceId: secondId, startAt: at(9), endAt: at(11) };
    const quote = await quoteReschedule(db, staffId, orgId, booking.id, target, now);
    expect(quote).toMatchObject({ currentTotal: 2500, newTotal: 5000, priceChanged: true });
    const moved = await rescheduleBooking(db, staffId, orgId, booking.id, target, now);
    expect(moved.resourceId).toBe(secondId);
    expect(moved.totalAmount).toBe(5000);
    const history = await db.select().from(schema.bookingStatusHistory).where(eq(schema.bookingStatusHistory.bookingId, booking.id));
    expect(history.find(row => row.eventType === "RESCHEDULED")).toMatchObject({ previousResourceId: resourceId, newResourceId: secondId, previousTotalAmount: 2500, newTotalAmount: 5000 });
  });
  it("rejects conflicting reschedules and cross-tenant target spaces", async () => {
    const booking = await createBooking(db, staffId, orgId, request(), now);
    await createBooking(db, staffId, orgId, request(at(9), at(10), { resourceId: secondId }), now);
    await expect(rescheduleBooking(db, staffId, orgId, booking.id, { resourceId: secondId, startAt: at(9), endAt: at(10) }, now))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const [foreignBranch] = await db.insert(schema.branches).values({ organizationId: otherOrgId, name: "Foreign", slug: "foreign", timezone: "Asia/Kuala_Lumpur" }).returning();
    const [foreignSpace] = await db.insert(schema.resources).values({ organizationId: otherOrgId, branchId: foreignBranch.id, sportTypeId: sportId, name: "Foreign Court" }).returning();
    try {
      await expect(rescheduleBooking(db, staffId, orgId, booking.id, { resourceId: foreignSpace.id, startAt: at(9), endAt: at(10) }, now))
        .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    } finally {
      await db.delete(schema.resources).where(eq(schema.resources.id, foreignSpace.id));
      await db.delete(schema.branches).where(eq(schema.branches.id, foreignBranch.id));
    }
  });

  it("preserves adjusted money on a time-only reschedule and refuses repricing", async () => {
    const booking = await createBooking(db, ownerId, orgId, request(), now);
    await db.update(schema.bookings).set({ discountAmount: 500, totalAmount: 2000, amountPaid: 1000 })
      .where(eq(schema.bookings.id, booking.id));
    const timeOnly = { startAt: at(9), endAt: at(10) };
    expect(await quoteReschedule(db, ownerId, orgId, booking.id, timeOnly, now))
      .toMatchObject({ currentTotal: 2000, newTotal: 2000, priceChanged: false });
    const moved = await rescheduleBooking(db, ownerId, orgId, booking.id, timeOnly, now);
    expect([moved.subtotal, moved.discountAmount, moved.totalAmount, moved.amountPaid]).toEqual([2500, 500, 2000, 1000]);
    await expect(quoteReschedule(db, ownerId, orgId, booking.id,
      { resourceId: secondId, startAt: at(10), endAt: at(12) }, now))
      .rejects.toMatchObject({ code: "REPRICE_UNSUPPORTED" });
  });
  it("counts first confirmation once, retains cancelled usage, and records truthful email state", async () => {
    const [recipient] = await db.insert(schema.customers).values({ organizationId: orgId, name: "Email Guest", phone: "+60125550000", email: "guest@example.test" }).returning();
    const booking = await createBooking(db, ownerId, orgId, request(at(10), at(11), { customerId: recipient.id }), now);
    expect((await getBookingUsage(db, orgId, now)).used).toBe(1);
    const notice = await db.select().from(schema.notificationRecords).where(eq(schema.notificationRecords.bookingId, booking.id));
    expect(notice).toHaveLength(1);
    expect(notice[0].status).toBe("DEV_PREVIEW");
    await cancelBooking(db, ownerId, orgId, booking.id, "Customer request", now);
    expect((await getBookingUsage(db, orgId, now)).used).toBe(1);
    const notices = await db.select().from(schema.notificationRecords).where(eq(schema.notificationRecords.bookingId, booking.id));
    expect(notices.map(item => item.type).sort()).toEqual(["BOOKING_CANCELLED", "BOOKING_CONFIRMED"]);
  });
  it("enforces 200 included bookings with a 10% grace, then blocks the next booking", async () => {
    const period = usagePeriod(now);
    const seeded = await db.insert(schema.bookings).values(Array.from({ length: 199 }, (_, index) => ({
      organizationId: orgId, branchId, resourceId, bookingReference: `BK-SEED${String(index).padStart(7, "0")}`,
      startAt: at(8), endAt: at(9), status: "CANCELLED", source: "STAFF", subtotal: 2500, totalAmount: 2500, currency: "MYR",
    }))).returning({ id: schema.bookings.id });
    await db.insert(schema.bookingUsageRecords).values(seeded.map(item => ({ organizationId: orgId, bookingId: item.id,
      periodStartAt: period.start, periodEndAt: period.end, confirmedAt: now })));
    expect((await getBookingUsage(db, orgId, now)).used).toBe(199);
    const number200 = await createBooking(db, ownerId, orgId, request(), now);
    expect((await getBookingUsage(db, orgId, now)).used).toBe(200);
    expect((await getBookingUsage(db, orgId, now)).stage).toBe("GRACE");
    await cancelBooking(db, ownerId, orgId, number200.id, "Test", now);
    const graceRows = await db.insert(schema.bookings).values(Array.from({ length: 20 }, (_, index) => ({
      organizationId: orgId, branchId, resourceId, bookingReference: `BK-GRACE${String(index).padStart(6, "0")}`,
      startAt: at(8), endAt: at(9), status: "CANCELLED", source: "STAFF", subtotal: 2500, totalAmount: 2500, currency: "MYR",
    }))).returning({ id: schema.bookings.id });
    await db.insert(schema.bookingUsageRecords).values(graceRows.map(item => ({ organizationId: orgId, bookingId: item.id,
      periodStartAt: period.start, periodEndAt: period.end, confirmedAt: now })));
    expect((await getBookingUsage(db, orgId, now)).stage).toBe("LIMIT_REACHED");
    await expect(createBooking(db, ownerId, orgId, request(at(10), at(11)), now)).rejects.toMatchObject({ code: "BOOKING_LIMIT_REACHED" });
  });
  it("calculates simple tenant-scoped reports, usage meters, and safe exports", async () => {
    await createBooking(db, ownerId, orgId, request(at(8), at(9), { customerId }), now);
    const report = await basicReport(db, orgId, "Asia/Kuala_Lumpur", { range: "custom", from: "2026-10-05", to: "2026-10-05" }, now);
    const foreign = await basicReport(db, otherOrgId, "Asia/Kuala_Lumpur", { range: "custom", from: "2026-10-05", to: "2026-10-05" }, now);
    expect(report.totals).toMatchObject({ bookings: 1, bookingValue: 2500, collected: 0, outstanding: 2500 });
    expect(foreign.totals.bookings).toBe(0);
    const series = await basicReportSeries(db, orgId, "Asia/Kuala_Lumpur", report);
    expect(series).toMatchObject([{ bookings: 1, bookingValue: 2500 }]);
    expect((await starterPlanUsage(db, orgId, now)).booking.used).toBe(1);
    expect(await exportBookings(db, otherOrgId, report.from, report.to)).toHaveLength(0);
    expect((await exportCustomers(db, otherOrgId)).some(row => row.phone === "+60123456789")).toBe(false);
    expect(csvDocument(["Name"], [["=1+1"], ['A,"B"']])).toContain('"\'=1+1"');
  });
  it("uses staged booking warnings", () => {
    expect([0, 140, 160, 180, 200, 220].map(used => bookingUsageStage(used, 200, 20)))
      .toEqual(["NORMAL", "INFO", "WARNING", "CRITICAL", "GRACE", "LIMIT_REACHED"]);
  });
});






