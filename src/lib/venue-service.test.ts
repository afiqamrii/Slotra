import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createOrganization } from "@/lib/organization-service";
import { changeResourceStatus, completeSetup, createBranch, createResource, hoursInput, slugAvailable, slugSchema, updateBranch, updateBranchSetup, updateResource } from "@/lib/venue-service";
import { generatedNames, spaceTerm } from "@/lib/space-terminology";
import { baseQuote, createBooking } from "@/lib/booking-service";

describe("venue onboarding and tenant management", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", viewerId = "", outsiderId = "", orgId = "", branchId = "", badmintonId = "", pickleballId = "";
  beforeAll(async () => {
    const files = (JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries as { tag: string }[]).map(entry => entry.tag);
    for (const file of files) {
      const sql = readFileSync(resolve(`drizzle/${file}.sql`), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    }
    const users = await db.insert(schema.users).values([
      { name: "Owner", email: "venue-owner@test.example" },
      { name: "Viewer", email: "venue-viewer@test.example" },
      { name: "Outsider", email: "venue-outsider@test.example" },
    ]).returning();
    [ownerId, viewerId, outsiderId] = users.map(user => user.id);
    orgId = (await createOrganization(db, ownerId, { name: "Rally Club", slug: "rally-club" }, { startTrial: false })).id;
    await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: viewerId, role: "VIEWER" });
    const sports = await db.select().from(schema.sportTypes).where(eq(schema.sportTypes.code, "BADMINTON"));
    const pickleball = await db.select().from(schema.sportTypes).where(eq(schema.sportTypes.code, "PICKLEBALL"));
    [badmintonId, pickleballId] = [sports[0].id, pickleball[0].id];
  });
  afterAll(async () => postgres.close());
  const address = { addressLine1: "12 Court Road", addressLine2: "", city: "Kuala Lumpur", state: "Wilayah Persekutuan", postcode: "50000", country: "MY" };
  function draft(slug = "rally-club") {
    return {
      name: "Rally Club", displayName: "Rally Club", contactPhone: "+60312345678", contactEmail: "hello@rally.test",
      ...address, timezone: "Asia/Kuala_Lumpur", currency: "MYR", locale: "en-MY", slug, primaryColor: "#176b5b",
      sports: [badmintonId, pickleballId],
      branch: { name: "Main Venue", ...address, timezone: "Asia/Kuala_Lumpur", isActive: true },
      resources: [
        ...generatedNames({ name: "Badminton", code: "badminton" }, 2).map(name => ({ name, sportTypeId: badmintonId, bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })),
        ...generatedNames({ name: "Pickleball", code: "pickleball" }, 1).map(name => ({ name, sportTypeId: pickleballId, bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })),
      ],
      hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, closed: dayOfWeek === 0, startMinute: 480, endMinute: 1440 })),
      prices: [{ sportTypeId: badmintonId, amountMinor: 2500 }, { sportTypeId: pickleballId, amountMinor: 3000 }],
    };
  }
  it("uses contextual terminology and generates sport-specific names", () => {
    expect(spaceTerm("swimming")).toBe("Lane");
    expect(spaceTerm("golf_simulator")).toBe("Simulator");
    expect(spaceTerm("unknown")).toBe("Space");
    expect(generatedNames({ name: "Badminton", code: "badminton" }, 2)).toEqual(["Badminton Court 1", "Badminton Court 2"]);
    expect(generatedNames({ name: "Pickleball", code: "pickleball" }, 2)).toEqual(["Pickleball Court 1", "Pickleball Court 2"]);
    expect(() => generatedNames({ name: "Badminton", code: "badminton" }, 101)).toThrow();
  });
  it("rejects reserved, malformed, and duplicated public slugs", async () => {
    expect(slugSchema.safeParse("admin").success).toBe(false);
    expect(slugSchema.safeParse("Bad Slug").success).toBe(false);
    expect(await slugAvailable(db, "rally-club")).toBe(false);
    expect(await slugAvailable(db, "rally-club", orgId)).toBe(true);
  });
  it("validates weekly hours and overnight closing", () => {
    expect(hoursInput.safeParse(draft().hours).success).toBe(true);
    expect(hoursInput.safeParse(draft().hours.map(day => day.dayOfWeek === 1 ? { ...day, endMinute: 30 } : day)).success).toBe(false);
    expect(hoursInput.safeParse(draft().hours.map(day => day.dayOfWeek === 1 ? { ...day, endMinute: 1500 } : day)).success).toBe(true);
    expect(hoursInput.safeParse(draft().hours.slice(1)).success).toBe(false);
  });
  it("denies unauthorized setup and an unrelated tenant", async () => {
    await expect(completeSetup(db, viewerId, orgId, draft())).rejects.toThrow("Permission denied");
    await expect(completeSetup(db, outsiderId, orgId, draft())).rejects.toThrow("Permission denied");
  });
  it("allows an owner to finish setup with multiple sports, correctly scoped spaces, prices, and hours", async () => {
    branchId = await completeSetup(db, ownerId, orgId, draft());
    expect((await db.select().from(schema.organizationSports).where(eq(schema.organizationSports.organizationId, orgId)))).toHaveLength(2);
    const spaces = await db.select().from(schema.resources).where(eq(schema.resources.organizationId, orgId));
    expect(spaces.map(space => space.name)).toEqual(["Badminton Court 1", "Badminton Court 2", "Pickleball Court 1"]);
    expect(spaces.every(space => space.branchId === branchId && space.organizationId === orgId)).toBe(true);
    expect((await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.branchId, branchId)))).toHaveLength(6);
    expect((await db.select().from(schema.basePrices).where(eq(schema.basePrices.organizationId, orgId)))).toHaveLength(2);
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].onboardingCompletedAt).toBeInstanceOf(Date);
    await expect(completeSetup(db, ownerId, orgId, draft())).rejects.toThrow("already complete");
  });
  it("lets Starter maintain opening hours and future prices without repricing existing bookings", async () => {
    const [space] = await db.select().from(schema.resources).where(and(eq(schema.resources.organizationId, orgId),
      eq(schema.resources.sportTypeId, badmintonId))).limit(1);
    const booking = await createBooking(db, ownerId, orgId, { branchId, resourceId: space.id,
      source: "STAFF", startAt: new Date("2026-10-19T02:00:00Z"), endAt: new Date("2026-10-19T03:00:00Z") },
    new Date("2026-10-18T12:00:00Z"));
    const input = { branch: { ...draft().branch, name: "Updated Main Venue" },
      hours: draft().hours.map(day => day.dayOfWeek === 2 ? { ...day, closed: true } : day),
      prices: draft().prices.map(price => price.sportTypeId === badmintonId ? { ...price, amountMinor: 3200 } : price) };
    await updateBranchSetup(db, ownerId, orgId, branchId, input);
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].planCode).toBe("STARTER");
    expect((await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)))[0].name).toBe("Updated Main Venue");
    expect(await db.select().from(schema.operatingHours).where(and(eq(schema.operatingHours.branchId, branchId),
      eq(schema.operatingHours.dayOfWeek, 2)))).toHaveLength(0);
    expect((await baseQuote(db, orgId, branchId, badmintonId, 60)).subtotal).toBe(3200);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, booking.id)))[0].totalAmount).toBe(2500);
    await expect(createBranch(db, ownerId, orgId, input)).rejects.toThrow("available on Pro");
    await updateBranchSetup(db, ownerId, orgId, branchId, { branch: draft().branch, hours: draft().hours, prices: draft().prices });
  });
  it("keeps Starter branch configuration tenant-scoped and rejects viewers", async () => {
    const input = { branch: { ...draft().branch, name: "Wrong tenant" }, hours: draft().hours, prices: draft().prices };
    await expect(updateBranchSetup(db, viewerId, orgId, branchId, input)).rejects.toThrow("Permission denied");
    await expect(updateBranchSetup(db, outsiderId, orgId, branchId, input)).rejects.toThrow("Permission denied");
    const other = await createOrganization(db, outsiderId, { name: "Hours Other", slug: "hours-other" }, { startTrial: false });
    const [otherBranch] = await db.insert(schema.branches).values({ organizationId: other.id, name: "Other branch", slug: "main" }).returning();
    await expect(updateBranchSetup(db, ownerId, orgId, otherBranch.id, input)).rejects.toThrow("Branch not found");
    expect((await db.select().from(schema.branches).where(eq(schema.branches.id, otherBranch.id)))[0].name).toBe("Other branch");
  });
  it("separates custom branch and pricing permissions without weakening selected-branch restrictions", async () => {
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, orgId));
    const [operator] = await db.insert(schema.users).values({ name: "Branch operator", email: "branch-operator@test.example" }).returning();
    const [role] = await db.insert(schema.customRoles).values({ organizationId: orgId, name: "Hours only", baseRole: "MANAGER",
      permissions: ["branch:view", "branch:manage"], createdByUserId: ownerId }).returning();
    const [member] = await db.insert(schema.organizationMembers).values({ organizationId: orgId, userId: operator.id,
      role: "MANAGER", customRoleId: role.id }).returning();
    const beforePrices = await db.select().from(schema.basePrices).where(eq(schema.basePrices.branchId, branchId));
    const input = { branch: draft().branch, hours: draft().hours.map(day => day.dayOfWeek === 2 ? { ...day, closed: true } : day),
      prices: draft().prices };
    await updateBranchSetup(db, operator.id, orgId, branchId, input);
    expect(await db.select().from(schema.basePrices).where(eq(schema.basePrices.branchId, branchId))).toEqual(beforePrices);
    await expect(updateBranchSetup(db, operator.id, orgId, branchId, { ...input,
      prices: draft().prices.map(price => ({ ...price, amountMinor: price.amountMinor + 100 })) })).rejects.toThrow("Pricing permission required");
    await expect(createBranch(db, operator.id, orgId, { ...input, branch: { ...input.branch, name: "No pricing grant" } }))
      .rejects.toThrow("Pricing permission required");
    await db.update(schema.organizationMembers).set({ branchScope: "SELECTED" }).where(eq(schema.organizationMembers.id, member.id));
    await db.insert(schema.memberBranches).values({ organizationId: orgId, memberId: member.id, branchId });
    await expect(updateBranchSetup(db, operator.id, orgId, branchId, input)).rejects.toThrow("Permission denied");
    await updateBranchSetup(db, ownerId, orgId, branchId, { branch: draft().branch, hours: draft().hours, prices: draft().prices });
    await db.update(schema.organizations).set({ planCode: "STARTER" }).where(eq(schema.organizations.id, orgId));
  });
  it("prevents a viewer from changing branch and rejects cross-tenant branch references", async () => {
    await expect(updateBranch(db, viewerId, orgId, branchId, draft().branch)).rejects.toThrow("Permission denied");
    const other = await createOrganization(db, outsiderId, { name: "Other Club", slug: "other-club" }, { startTrial: false });
    await expect(updateBranch(db, ownerId, orgId, other.id, draft().branch)).rejects.toThrow("Branch not found");
    await expect(createResource(db, ownerId, orgId, { name: "Wrong", sportTypeId: badmintonId, branchId: other.id, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })).rejects.toThrow();
  });
  it("allows scoped status changes but denies cross-tenant resource access", async () => {
    const [space] = await db.select().from(schema.resources).where(and(eq(schema.resources.organizationId, orgId), eq(schema.resources.branchId, branchId))).limit(1);
    expect((await changeResourceStatus(db, ownerId, orgId, space.id, "MAINTENANCE")).status).toBe("MAINTENANCE");
    expect((await changeResourceStatus(db, ownerId, orgId, space.id, "DISABLED")).status).toBe("DISABLED");
    expect((await changeResourceStatus(db, ownerId, orgId, space.id, "ACTIVE")).status).toBe("ACTIVE");
    await expect(changeResourceStatus(db, outsiderId, orgId, space.id, "DISABLED")).rejects.toThrow("Permission denied");
    await expect(updateResource(db, outsiderId, orgId, space.id, { name: "Hacked", sportTypeId: badmintonId, branchId, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })).rejects.toThrow("Permission denied");
    await expect(createResource(db, viewerId, orgId, { name: "Viewer", sportTypeId: badmintonId, branchId, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })).rejects.toThrow("Permission denied");
    const other = await createOrganization(db, outsiderId, { name: "Rival Club", slug: "rival-club" }, { startTrial: false });
    await expect(changeResourceStatus(db, outsiderId, other.id, space.id, "DISABLED")).rejects.toThrow("Space not found");
    await expect(updateResource(db, outsiderId, other.id, space.id, { name: "Cross-tenant", sportTypeId: badmintonId, branchId, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })).rejects.toThrow("Space not found");
    expect((await db.select().from(schema.resources).where(eq(schema.resources.id, space.id)))[0].name).toBe(space.name);
  });
  it("blocks an eleventh active Starter space while retaining existing spaces", async () => {
    const existing = await db.select().from(schema.resources).where(eq(schema.resources.organizationId, orgId));
    const needed = 10 - existing.filter(space => space.status !== "DISABLED").length;
    for (let index = 0; index < needed; index++) await createResource(db, ownerId, orgId, {
      name: `Extra Court ${index + 1}`, sportTypeId: badmintonId, branchId, status: "ACTIVE",
      bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null,
    });
    await expect(createResource(db, ownerId, orgId, { name: "Court 11", sportTypeId: badmintonId,
      branchId, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60,
      maximumDurationMinutes: null })).rejects.toThrow("Starter resource limit");
    expect((await db.select().from(schema.resources).where(eq(schema.resources.organizationId, orgId))).filter(space => space.status !== "DISABLED")).toHaveLength(10);
  });
  it("gates extra branches, stores branch-local hours/prices, and enforces the Pro cap", async () => {
    const input = { branch: { ...draft().branch, name: "Kemaman" }, hours: draft().hours,
      prices: draft().prices };
    await expect(createBranch(db, ownerId, orgId, input)).rejects.toThrow("available on Pro");
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, orgId));
    await expect(createBranch(db, viewerId, orgId, input)).rejects.toThrow("Permission denied");
    const second = await createBranch(db, ownerId, orgId, input);
    expect(second.organizationId).toBe(orgId);
    expect(second.slug).toBe("kemaman");
    expect(await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.branchId, second.id))).toHaveLength(6);
    expect(await db.select().from(schema.basePrices).where(eq(schema.basePrices.branchId, second.id))).toHaveLength(2);
    const changed = { ...input, hours: input.hours.map(day => day.dayOfWeek === 2 ? { ...day, closed: true } : day),
      prices: [{ sportTypeId: badmintonId, amountMinor: 3500 }] };
    await updateBranchSetup(db, ownerId, orgId, second.id, changed);
    expect(await db.select().from(schema.operatingHours).where(eq(schema.operatingHours.branchId, second.id))).toHaveLength(5);
    expect((await db.select().from(schema.basePrices).where(eq(schema.basePrices.branchId, second.id)))[0].amountMinor).toBe(3500);
    const outsider = await createOrganization(db, outsiderId, { name: "Another Venue", slug: "another-venue" }, { startTrial: false });
    await expect(updateBranchSetup(db, outsiderId, outsider.id, second.id, input)).rejects.toThrow("Branch not found");
    for (const name of ["Kerteh", "Dungun", "Kuala Terengganu"]) await createBranch(db, ownerId, orgId,
      { ...input, branch: { ...input.branch, name } });
    await expect(createBranch(db, ownerId, orgId, { ...input, branch: { ...input.branch, name: "Sixth" } }))
      .rejects.toThrow("5 active branches");
  });
});




