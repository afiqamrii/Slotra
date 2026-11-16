import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { dashboardOperations } from "@/lib/dashboard-operations";

describe("daily operational dashboard", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-11-16T00:30:00Z");
  let organizationId = "", otherOrgId = "", ownerId = "", staffId = "", restrictedId = "", financialOnlyId = "";
  let mainId = "", abroadId = "";
  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"));
    for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) await postgres.exec(statement);
    const users = await db.insert(schema.users).values(["owner", "staff", "restricted", "finance"].map(name =>
      ({ name, email: `dashboard-${name}@example.test` }))).returning();
    [ownerId, staffId, restrictedId, financialOnlyId] = users.map(user => user.id);
    const venues = await db.insert(schema.organizations).values([
      { name: "Operations venue", slug: "operations-venue", planCode: "PRO" },
      { name: "Other venue", slug: "other-operations-venue", planCode: "PRO" },
    ]).returning();
    [organizationId, otherOrgId] = venues.map(venue => venue.id);
    const roles = await db.insert(schema.customRoles).values([
      { organizationId, name: "Booking only", baseRole: "ADMIN", permissions: ["organization:view", "booking:view"] },
      { organizationId, name: "Finance only", baseRole: "ADMIN", permissions: ["organization:view", "report:view_financial"] },
    ]).returning();
    const members = await db.insert(schema.organizationMembers).values([
      { organizationId, userId: ownerId, role: "OWNER" },
      { organizationId, userId: staffId, role: "STAFF" },
      { organizationId, userId: restrictedId, role: "ADMIN", branchScope: "SELECTED", customRoleId: roles[0].id },
      { organizationId, userId: financialOnlyId, role: "ADMIN", customRoleId: roles[1].id },
    ]).returning();
    const branches = await db.insert(schema.branches).values([
      { organizationId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur" },
      { organizationId, name: "Overseas", slug: "overseas", timezone: "America/Los_Angeles" },
      { organizationId: otherOrgId, name: "Other", slug: "other" },
    ]).returning();
    [mainId, abroadId] = branches.map(branch => branch.id);
    await db.insert(schema.memberBranches).values({ organizationId, memberId: members[2].id, branchId: mainId });
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    const courts = await db.insert(schema.resources).values([
      { organizationId, branchId: mainId, sportTypeId: sport.id, name: "Court 1" },
      { organizationId, branchId: mainId, sportTypeId: sport.id, name: "Overnight court" },
      { organizationId, branchId: abroadId, sportTypeId: sport.id, name: "Overseas court" },
      { organizationId: otherOrgId, branchId: branches[2].id, sportTypeId: sport.id, name: "Other court" },
    ]).returning();
    const local = (hour: string) => new Date(`2026-11-16T${hour}:00+08:00`);
    const common = { organizationId, branchId: mainId, resourceId: courts[0].id, source: "STAFF", subtotal: 2500, totalAmount: 2500, currency: "MYR" };
    await db.insert(schema.bookings).values([
      ...Array.from({ length: 60 }, (_, index) => ({ ...common, bookingReference: `DASH-PAST-${index}`, status: "COMPLETED", startAt: local("00:00"), endAt: local("01:00") })),
      { ...common, bookingReference: "DASH-LIVE", status: "CONFIRMED", startAt: local("08:00"), endAt: local("09:00") },
      { ...common, bookingReference: "DASH-FINISH", status: "CHECKED_IN", startAt: local("06:00"), endAt: local("07:00") },
      { ...common, bookingReference: "DASH-NEXT", status: "CONFIRMED", startAt: local("10:00"), endAt: local("11:00") },
      { ...common, bookingReference: "DASH-HOLD", status: "AWAITING_PAYMENT", startAt: local("11:00"), endAt: local("12:00"), holdExpiresAt: local("08:40") },
      { ...common, bookingReference: "DASH-OLD-HOLD", status: "AWAITING_PAYMENT", startAt: local("12:00"), endAt: local("13:00"), holdExpiresAt: local("08:20") },
      { ...common, bookingReference: "DASH-CANCEL", status: "CANCELLED", startAt: local("13:00"), endAt: local("14:00") },
      { ...common, resourceId: courts[1].id, bookingReference: "DASH-OVERNIGHT", status: "IN_PROGRESS", startAt: new Date("2026-11-15T23:00:00+08:00"), endAt: local("09:00") },
      { ...common, branchId: abroadId, resourceId: courts[2].id, bookingReference: "DASH-ABROAD", status: "CONFIRMED", startAt: new Date("2026-11-15T17:00:00-08:00"), endAt: new Date("2026-11-15T18:00:00-08:00") },
      { ...common, branchId: abroadId, resourceId: courts[2].id, bookingReference: "DASH-YESTERDAY", status: "COMPLETED", startAt: new Date("2026-11-14T17:00:00-08:00"), endAt: new Date("2026-11-14T18:00:00-08:00") },
      { ...common, organizationId: otherOrgId, branchId: branches[2].id, resourceId: courts[3].id, bookingReference: "DASH-OTHER", status: "CONFIRMED", startAt: local("08:00"), endAt: local("09:00") },
    ]);
  });
  afterAll(async () => { await postgres.close(); });

  it("counts the entire day beyond one booking-list page and keeps overnight sessions live", async () => {
    const result = await dashboardOperations(db, ownerId, organizationId, mainId, now);
    expect(result?.counts).toMatchObject({ scheduled: 63, live: 2, arriving: 1, lateCheckIn: 1, wrapUp: 1, held: 1, outstanding: 64 });
    expect(result?.sessions.map(row => row.reference)).toEqual(["DASH-OVERNIGHT", "DASH-LIVE", "DASH-NEXT"]);
    expect(result?.attention.map(row => row.reference)).toEqual(["DASH-FINISH", "DASH-LIVE"]);
  });
  it("uses each branch's local day for a combined view", async () => {
    const result = await dashboardOperations(db, ownerId, organizationId, undefined, now);
    expect(result?.counts.scheduled).toBe(64);
    expect(result?.counts.arriving).toBe(2);
    expect(result?.sessions.map(row => row.reference)).toContain("DASH-ABROAD");
    expect(result?.sessions.map(row => row.reference)).not.toContain("DASH-OTHER");
  });
  it("gives reception staff operations without financial reporting access", async () => {
    const result = await dashboardOperations(db, staffId, organizationId, mainId, now);
    expect(result?.counts.scheduled).toBe(63);
    expect(result?.canCreate).toBe(true);
    expect(result?.sessions[0]).not.toHaveProperty("totalAmount");
  });
  it("honors custom permissions and branch assignments without base-role fallback", async () => {
    const result = await dashboardOperations(db, restrictedId, organizationId, mainId, now);
    expect(result?.canCreate).toBe(false);
    expect(result?.canViewPayments).toBe(false);
    expect(result?.counts.outstanding).toBe(0);
    expect(result?.branches.map(branch => branch.id)).toEqual([mainId]);
    expect(await dashboardOperations(db, restrictedId, organizationId, abroadId, now)).toBeNull();
    expect(await dashboardOperations(db, restrictedId, organizationId, undefined, now)).toBeNull();
  });
  it("does not expose booking details to report-only roles or another tenant", async () => {
    expect(await dashboardOperations(db, financialOnlyId, organizationId, mainId, now)).toBeNull();
    expect(await dashboardOperations(db, ownerId, otherOrgId, undefined, now)).toBeNull();
  });
});
