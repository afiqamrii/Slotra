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
import { proExecutiveReport } from "@/lib/pro-reporting";

describe("Professional reporting", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", viewerId = "", orgId = "", starterId = "", branchId = "", courtId = "", pitchId = "", otherCourtId = "";
  beforeAll(async () => {
    const files = (JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries as { tag: string }[]).map(entry => entry.tag);
    for (const file of files) for (const statement of readFileSync(resolve(`drizzle/${file}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    const [owner, viewer] = await db.insert(schema.users).values([
      { name: "Owner", email: "pro-owner@example.test" },
      { name: "Viewer", email: "pro-viewer@example.test" },
    ]).returning();
    ownerId = owner.id;
    viewerId = viewer.id;
    const orgs = await db.insert(schema.organizations).values([
      { name: "Pro Venue", slug: "pro-venue", planCode: "PROFESSIONAL" },
      { name: "Starter Venue", slug: "starter-venue" },
      { name: "Other Venue", slug: "other-venue", planCode: "PROFESSIONAL" },
    ]).returning();
    [orgId, starterId] = orgs.map(item => item.id);
    await db.insert(schema.organizationMembers).values([
      { organizationId: orgId, userId: ownerId, role: "OWNER" },
      { organizationId: orgId, userId: viewerId, role: "VIEWER" },
    ]);
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
    await expect(createReportSchedule(db, starterId, ownerId, {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now)).rejects.toThrow("available from Professional");
    await expect(createReportSchedule(db, orgId, viewerId, {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now)).rejects.toThrow("cannot manage");
    const schedule = await createReportSchedule(db, orgId, ownerId, {
      name: "Weekly", reportType: "OVERVIEW", frequency: "WEEKLY", recipients: ["owner@example.test"],
    }, now);
    expect(schedule.branchId).toBe(branchId);
    await expect(createReportSchedule(db, orgId, ownerId, {
      name: "Other branch", reportType: "OVERVIEW", frequency: "WEEKLY",
      recipients: ["owner@example.test"], branchId,
    }, now)).rejects.toThrow("available on Pro");
    expect((await listReportSchedules(db, orgId)).map(item => item.id)).toEqual([schedule.id]);
    expect(await listReportSchedules(db, (await db.select().from(schema.organizations)
      .where(eq(schema.organizations.slug, "other-venue")))[0].id)).toEqual([]);
    const result = await runDueReports(db, new Date("2026-10-12T02:00:00Z"));
    expect(result).toMatchObject({ processed: 1, sent: 0, previews: 1, emailConfigured: false });
    expect((await db.select().from(schema.reportDeliveries).where(eq(schema.reportDeliveries.scheduleId, schedule.id)))[0].status)
      .toBe("DEV_PREVIEW");
    expect((await runDueReports(db, new Date("2026-10-12T03:00:00Z"))).sent).toBe(0);
    await setReportScheduleActive(db, orgId, ownerId, schedule.id, false);
    await expect(setReportScheduleActive(db, starterId, ownerId, schedule.id, false)).rejects.toThrow();
  });
  it("compares Pro branches using each local date without double-counting another tenant", async () => {
    await expect(proExecutiveReport(db, ownerId, orgId, filter)).rejects.toThrow("available on Pro");
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, orgId));
    const [branch] = await db.insert(schema.branches).values({ organizationId: orgId, name: "Tokyo",
      slug: "tokyo", timezone: "Asia/Tokyo" }).returning();
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    const [space] = await db.insert(schema.resources).values({ organizationId: orgId, branchId: branch.id,
      sportTypeId: sport.id, name: "Tokyo Court" }).returning();
    await db.insert(schema.operatingHours).values({ organizationId: orgId, branchId: branch.id,
      dayOfWeek: 1, startMinute: 0, endMinute: 120 });
    await db.insert(schema.bookings).values({ organizationId: orgId, branchId: branch.id, resourceId: space.id,
      bookingReference: "TOKYO-ONE", startAt: new Date("2026-10-05T00:30:00+09:00"),
      endAt: new Date("2026-10-05T01:30:00+09:00"), status: "CONFIRMED", source: "STAFF",
      subtotal: 5000, totalAmount: 5000, amountPaid: 3000, currency: "MYR" });
    const report = await proExecutiveReport(db, ownerId, orgId, filter);
    expect(report.branches).toHaveLength(2);
    expect(report.totals).toMatchObject({ bookings: 4, bookingValue: 18000, collected: 9000, outstanding: 9000 });
    expect(report.branches.find(item => item.id === branch.id)).toMatchObject({ bookings: 1, bookingValue: 5000,
      collected: 3000, fromDate: "2026-10-05", timezone: "Asia/Tokyo" });
    expect(report.resources.some(item => item.name === "Other Court")).toBe(false);
    const [other] = await db.select().from(schema.branches).where(eq(schema.branches.slug, "other"));
    await expect(proExecutiveReport(db, ownerId, orgId, { ...filter, branchId: other.id })).rejects.toThrow("Branch not found");
    const one = await proExecutiveReport(db, ownerId, orgId, { ...filter, branchId: branch.id });
    expect(one.totals.bookingValue).toBe(5000);
  });
  it("schedules Pro All Branches and branch reports without claiming email delivery", async () => {
    const now = new Date("2026-10-06T01:00:00Z");
    const input = { name: "Executive week", reportType: "OVERVIEW", frequency: "WEEKLY",
      recipients: ["owner@example.test"] };
    const all = await createReportSchedule(db, orgId, ownerId, input, now);
    expect(all.branchId).toBeNull();
    await expect(createReportSchedule(db, orgId, ownerId, { ...input, reportType: "REVENUE" }, now))
      .rejects.toThrow("Overview");
    const branch = await createReportSchedule(db, orgId, ownerId, { ...input, name: "Main week", branchId }, now);
    expect(branch.branchId).toBe(branchId);
    const [other] = await db.select().from(schema.branches).where(eq(schema.branches.slug, "other"));
    await expect(createReportSchedule(db, orgId, ownerId, { ...input, branchId: other.id }, now))
      .rejects.toThrow("Branch not found");
    const result = await runDueReports(db, new Date("2026-10-12T02:00:00Z"));
    expect(result).toMatchObject({ processed: 2, previews: 2, sent: 0 });
    const deliveries = await db.select().from(schema.reportDeliveries).where(eq(schema.reportDeliveries.organizationId, orgId));
    expect(deliveries.filter(row => row.scheduleId === all.id || row.scheduleId === branch.id)
      .every(row => row.status === "DEV_PREVIEW")).toBe(true);
  });
});
