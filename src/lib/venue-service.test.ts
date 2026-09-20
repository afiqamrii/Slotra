import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createOrganization } from "@/lib/organization-service";
import { changeResourceStatus, completeSetup, createResource, hoursInput, slugAvailable, slugSchema, updateBranch, updateResource } from "@/lib/venue-service";
import { generatedNames, spaceTerm } from "@/lib/space-terminology";

describe("venue onboarding and tenant management", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", viewerId = "", outsiderId = "", orgId = "", branchId = "", badmintonId = "", pickleballId = "";
  beforeAll(async () => {
    const files = ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman", "0003_panoramic_gravity", "0004_flashy_enchantress", "0005_soft_wrecker", "0006_graceful_miek", "0007_flaky_madelyne_pryor", "0008_worthless_expediter", "0012_massive_marvel_zombies"];
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
    orgId = (await createOrganization(db, ownerId, { name: "Rally Club", slug: "rally-club" })).id;
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
  it("prevents a viewer from changing branch and rejects cross-tenant branch references", async () => {
    await expect(updateBranch(db, viewerId, orgId, branchId, draft().branch)).rejects.toThrow("Permission denied");
    const other = await createOrganization(db, outsiderId, { name: "Other Club", slug: "other-club" });
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
    const other = await createOrganization(db, outsiderId, { name: "Rival Club", slug: "rival-club" });
    await expect(changeResourceStatus(db, outsiderId, other.id, space.id, "DISABLED")).rejects.toThrow("Space not found");
    await expect(updateResource(db, outsiderId, other.id, space.id, { name: "Cross-tenant", sportTypeId: badmintonId, branchId, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })).rejects.toThrow("Space not found");
    expect((await db.select().from(schema.resources).where(eq(schema.resources.id, space.id)))[0].name).toBe(space.name);
  });
});





