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
import { addCorporateCustomer, createCorporateAccount, createCorporateBooking } from "@/lib/pro-corporate-service";
import { cancelBooking } from "@/lib/booking-service";

describe("Pro corporate allowance", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", organizationId = "", branchId = "", customerId = "", accountId = "";
  let resources: string[] = [];
  const now = new Date("2026-10-01T00:00:00.000Z");
  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    ownerId = (await db.insert(schema.users).values({ name: "Owner", email: "corporate-owner@test.example" }).returning())[0].id;
    organizationId = (await createOrganization(db, ownerId, { name: "Corporate Venue", slug: "corporate-venue" })).id;
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, organizationId));
    branchId = (await db.insert(schema.branches).values({ organizationId, name: "Main", slug: "main" }).returning())[0].id;
    const sportId = (await db.select({ id: schema.sportTypes.id }).from(schema.sportTypes)
      .where(eq(schema.sportTypes.code, "BADMINTON")))[0].id;
    await db.insert(schema.organizationSports).values({ organizationId, sportTypeId: sportId });
    resources = (await db.insert(schema.resources).values(["Court 1", "Court 2"].map(name => ({
      organizationId, branchId, sportTypeId: sportId, name,
    }))).returning()).map(row => row.id);
    await db.insert(schema.basePrices).values({ organizationId, branchId, sportTypeId: sportId, amountMinor: 8000 });
    await db.insert(schema.operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({
      organizationId, branchId, dayOfWeek, startMinute: 480, endMinute: 1440,
    })));
    customerId = (await db.insert(schema.customers).values({ organizationId, name: "Employee",
      phone: "+60123456789" }).returning())[0].id;
    accountId = (await createCorporateAccount(db, ownerId, organizationId, {
      name: "PETRONAS", billingEmail: "accounts@example.com", monthlyLimitMinor: 10000,
    })).id;
    await addCorporateCustomer(db, ownerId, organizationId, accountId, customerId);
  }, 120000);
  afterAll(async () => postgres.close());

  it("rejects an unapproved or cross-tenant customer", async () => {
    const [other] = await db.insert(schema.organizations).values({ name: "Other", slug: "other-corporate" }).returning();
    const outsider = (await db.insert(schema.customers).values({ organizationId: other.id,
      name: "Outsider", phone: "+60199999999" }).returning())[0];
    await expect(addCorporateCustomer(db, ownerId, organizationId, accountId, outsider.id)).rejects.toThrow("not found");
  });

  it("does not let two RM80 bookings consume a RM100 monthly allowance", async () => {
    const input = (resourceId: string) => ({ accountId, customerId, branchId, resourceId,
      startAt: new Date("2026-10-05T01:00:00.000Z"), endAt: new Date("2026-10-05T02:00:00.000Z") });
    const results = await Promise.allSettled(resources.map(resourceId => createCorporateBooking(db, ownerId,
      organizationId, input(resourceId), now)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const charges = await db.select().from(schema.corporateCharges).where(and(
      eq(schema.corporateCharges.organizationId, organizationId), eq(schema.corporateCharges.status, "APPLIED")));
    expect(charges).toHaveLength(1);
    expect(charges[0].amountMinor).toBe(8000);
    await cancelBooking(db, ownerId, organizationId, charges[0].bookingId, "Cancelled", now);
    const [reversed] = await db.select().from(schema.corporateCharges)
      .where(eq(schema.corporateCharges.id, charges[0].id));
    expect(reversed.status).toBe("REVERSED");
  });
});
