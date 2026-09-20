import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { mergedSpans, professionalReport, professionalWindow, subtractSpans, utilization } from "@/lib/professional-reporting";
import { createReportSchedule, listReportSchedules, nextReportRun, reportPeriod, runDueReports, setReportScheduleActive } from "@/lib/scheduled-reports";
import { planHasFeature, planLimit } from "@/lib/plan-entitlements";

describe("Professional reporting", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", orgId = "", starterId = "", branchId = "", courtId = "", pitchId = "", otherCourtId = "";
  beforeAll(async () => {
    const files = ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman",
      "0003_panoramic_gravity", "0004_flashy_enchantress", "0005_soft_wrecker", "0006_graceful_miek",
      "0007_flaky_madelyne_pryor", "0008_worthless_expediter", "0009_steady_stephen_strange",
      "0010_white_dragon_man", "0011_broken_dragon_man", "0012_massive_marvel_zombies",
      "0013_rare_doctor_faustus", "0014_green_chronomancer", "0015_chubby_psynapse"];
    for (const file of files) for (const statement of readFileSync(resolve(`drizzle/${file}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    const [owner] = await db.insert(schema.users).values({ name: "Owner", email: "pro-owner@example.test" }).returning();
    ownerId = owner.id;
    const orgs = await db.insert(schema.organizations).values([
      { name: "Pro Venue", slug: "pro-venue", planCode: "PROFESSIONAL" },
      { name: "Starter Venue", slug: "starter-venue" },
      { name: "Other Venue", slug: "other-venue", planCode: "PROFESSIONAL" },
    ]).returning();
    [orgId, starterId] = orgs.map(item => item.id);
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: ownerId, role: "OWNER" });
    const branches = await db.insert(schema.branches).values([
      { organizationId: orgId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur" },
      { organizationId: orgs[2].id, name: "Other", slug: "other", timezone: "Asia/Kuala_Lumpur" },
    ]).returning();
    branchId = branches[0].id;
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    const courts = await db.insert(schema.resources).values([
      { organizationId: orgId, branchId, sportTypeId: sport.id, name: "Court 1" },
      { organizationId: orgId, branchId, sportTypeId: sport.id, name: "Court 2" },
      { organizationId: orgs[2].id, branchId: branches[1].id, sportTypeId: sport.id, name: "Other Court" },
    ]).returning();
    [courtId, pitchId, otherCourtId] = courts.map(item => item.id);
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) =>
      ({ organizationId: orgId, branchId, dayOfWeek, startMinute: 480, endMinute: 600 })));
    const customerRows = await db.insert(schema.customers).values([
      { organizationId: orgId, name: "Returning", phone: "0120000001" },
      { organizationId: orgId, name: "New", phone: "0120000002" },
      { organizationId: orgId, name: "New no-show", phone: "0120000003" },
    ]).returning();
    const slot = (hour: number) => new Date(`2026-10-05T${String(hour).padStart(2, "0")}:00:00+08:00`);
    const rows = await db.insert(schema.bookings).values([
      { organizationId: orgId, branchId, resourceId: courtId, customerId: customerRows[0].id,
        bookingReference: "PRO-OLD", startAt: new Date("2026-09-28T08:00:00+08:00"), endAt: new Date("2026-09-28T09:00:00+08:00"),
        status: "COMPLETED", source: "STAFF", subtotal: 2000, totalAmount: 2000, currency: "MYR", amountPaid: 2000 },
      { organizationId: orgId, branchId, resourceId: courtId, customerId: customerRows[0].id,
        bookingReference: "PRO-ONE", startAt: slot(8), endAt: slot(9),
        status: "CONFIRMED", source: "ONLINE", subtotal: 6000, totalAmount: 6000, currency: "MYR", amountPaid: 2000 },
      { organizationId: orgId, branchId, resourceId: courtId, customerId: customerRows[1].id,
        bookingReference: "PRO-TWO", startAt: slot(9), endAt: slot(10),
        status: "COMPLETED", source: "STAFF", subtotal: 4000, totalAmount: 4000, currency: "MYR", amountPaid: 4000 },
      { organizationId: orgId, branchId, resourceId: pitchId, customerId: customerRows[2].id,
        bookingReference: "PRO-THREE", startAt: slot(8), endAt: slot(9),
        status: "CANCELLED", source: "STAFF", subtotal: 5000, totalAmount: 5000, currency: "MYR" },
      { organizationId: orgId, branchId, resourceId: pitchId, customerId: customerRows[2].id,
        bookingReference: "PRO-FOUR", startAt: slot(9), endAt: slot(10),
        status: "NO_SHOW", source: "STAFF", subtotal: 3000, totalAmount: 3000, currency: "MYR" },
      { organizationId: orgs[2].id, branchId: branches[1].id, resourceId: otherCourtId,
        bookingReference: "OTHER-ONE", startAt: slot(8), endAt: slot(9),
        status: "CONFIRMED", source: "STAFF", subtotal: 99000, totalAmount: 99000, currency: "MYR" },
    ]).returning();
    await db.insert(schema.bookingUsageRecords).values([0, 1, 2, 4].map(index => ({
      organizationId: orgId, bookingId: rows[index].id,
      periodStartAt: new Date("2026-10-01T00:00:00Z"), periodEndAt: new Date("2026-11-01T00:00:00Z"),
      confirmedAt: index === 0 ? new Date("2026-09-27T00:00:00Z") : slot(8),
    })));
    await db.insert(schema.resourceBlocks).values({ organizationId: orgId, branchId, resourceId: pitchId,
      startAt: slot(8), endAt: slot(9), type: "MAINTENANCE" });
  });
  afterAll(async () => postgres.close());
  const filter = { range: "custom", from: "2026-10-05", to: "2026-10-05" };
  it("gates advanced analytics and defines Professional limits centrally", async () => {
    expect([planLimit("PROFESSIONAL", "MONTHLY_BOOKINGS"), planLimit("PROFESSIONAL", "RESOURCES"),
      planLimit("PROFESSIONAL", "STAFF_SEATS")]).toEqual([1000, 20, 3]);
    expect(planHasFeature("STARTER", "ADVANCED_ANALYTICS")).toBe(false);
    for (const plan of ["PROFESSIONAL", "BUSINESS", "PRO"] as const)
      expect(["ADVANCED_ANALYTICS", "ADVANCED_REPORTS", "SCHEDULED_REPORTS"].every(feature =>
        planHasFeature(plan, feature as Parameters<typeof planHasFeature>[1]))).toBe(true);
    await expect(professionalReport(db, starterId, filter)).rejects.toThrow("available from Professional");
  });
  it("calculates merged operating minutes, blocks, and booked time without double-counting", () => {
    const open = mergedSpans([{ start: 0, end: 120 }, { start: 60, end: 180 }]);
    expect(open).toEqual([{ start: 0, end: 180 }]);
    expect(subtractSpans(open, [{ start: 30, end: 90 }])).toEqual([{ start: 0, end: 30 }, { start: 90, end: 180 }]);
    expect(utilization([{ start: 0, end: 60_000 * 120 }], [{ start: 0, end: 60_000 * 60 }]).percent).toBe(50);
  });
  it("reports revenue, outcomes, customers, utilization, peaks, heatmap, and resource value from real tenant data", async () => {
    const report = await professionalReport(db, orgId, filter);
    expect(report.totals).toMatchObject({ bookings: 4, completed: 1, cancelled: 1, noShows: 1,
      bookingValue: 13000, collected: 6000, outstanding: 7000, cancellationValue: 5000,
      cancellationRate: 25, noShowRate: 33 });
    expect(report.utilization).toMatchObject({ availableMinutes: 180, bookedMinutes: 120, percent: 67 });
    expect(report.customers).toMatchObject({ new: 2, returning: 1, returningRate: 33 });
    expect(report.peak).toEqual({ day: "Monday", period: "08:00–10:00" });
    expect(report.heatmap[4][0]).toBe(3);
    expect(report.resourceRevenue.map(item => item.bookingValue)).toEqual([10000, 3000]);
    expect(report.series[0]).toMatchObject({ date: "2026-10-05", bookings: 4, bookingValue: 13000, collected: 6000 });
    expect(report.customers.top[0].name).toBe("Returning");
    expect(report.resourceRevenue.every(item => item.id !== otherCourtId)).toBe(true);
  });
  it("applies sport, resource and status filters and rejects cross-tenant IDs", async () => {
    const court = await professionalReport(db, orgId, { ...filter, resource: courtId, status: "COMPLETED" });
    expect(court.totals.bookings).toBe(1);
    expect(court.totals.bookingValue).toBe(4000);
    await expect(professionalReport(db, orgId, { ...filter, resource: otherCourtId })).rejects.toThrow("at this venue");
    expect((await professionalReport(db, orgId, filter)).totals.bookingValue).not.toBe(99000);
  });
  it("uses local timezone date boundaries", async () => {
    const window = professionalWindow({ range: "today" }, "Asia/Kuala_Lumpur", new Date("2026-10-04T17:00:00Z"));
    expect(window.fromDate).toBe("2026-10-05");
    expect(window.from.toISOString()).toBe("2026-10-04T16:00:00.000Z");
  });
  it("creates tenant-scoped schedules and development delivery previews without claiming sent email", async () => {
    const now = new Date("2026-10-06T01:00:00Z");
    expect(nextReportRun("WEEKLY", "Asia/Kuala_Lumpur", now).toISOString()).toBe("2026-10-12T01:00:00.000Z");
    expect(reportPeriod("WEEKLY", "Asia/Kuala_Lumpur", new Date("2026-10-12T01:00:00Z")))
      .toEqual({ from: "2026-10-05", to: "2026-10-11" });
    await expect(createReportSchedule(db, starterId, ownerId, "OWNER", {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now)).rejects.toThrow("available from Professional");
    await expect(createReportSchedule(db, orgId, ownerId, "VIEWER", {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now)).rejects.toThrow("cannot manage");
    const schedule = await createReportSchedule(db, orgId, ownerId, "OWNER", {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now);
    expect((await listReportSchedules(db, orgId)).map(item => item.id)).toEqual([schedule.id]);
    expect(await listReportSchedules(db, (await db.select().from(schema.organizations)
      .where(eq(schema.organizations.slug, "other-venue")))[0].id)).toEqual([]);
    const result = await runDueReports(db, new Date("2026-10-12T02:00:00Z"));
    expect(result).toMatchObject({ processed: 1, sent: 0, previews: 1, emailConfigured: false });
    expect((await db.select().from(schema.reportDeliveries).where(eq(schema.reportDeliveries.scheduleId, schedule.id)))[0].status)
      .toBe("DEV_PREVIEW");
    expect((await runDueReports(db, new Date("2026-10-12T03:00:00Z"))).sent).toBe(0);
    await setReportScheduleActive(db, orgId, "OWNER", schedule.id, false);
    await expect(setReportScheduleActive(db, starterId, "OWNER", schedule.id, false)).rejects.toThrow();
  });
});
