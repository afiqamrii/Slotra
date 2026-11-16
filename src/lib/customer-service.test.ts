import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { customerHistoryFilters, customerListFilters, getBookingCustomer, getCustomerProfile, listCustomers, updateCustomer } from "@/lib/customer-service";
import { searchBookingCustomers } from "@/lib/booking-management";

describe("customer directory and profile boundaries", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-11-16T00:00:00Z");
  let organizationId = "", otherId = "", owner = "", staff = "", contactOnly = "", restricted = "", bookingCreator = "";
  let regular = "", newCustomer = "", foreignCustomer = "";
  beforeAll(async () => {
    for (const { tag } of JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries as { tag: string }[])
      for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8").split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    [organizationId, otherId] = (await db.insert(schema.organizations).values([
      { name: "Customer Venue", slug: "customer-venue", planCode: "PRO" }, { name: "Other Venue", slug: "other-customer-venue" },
    ]).returning()).map(row => row.id);
    [owner, staff, contactOnly, restricted, bookingCreator] = (await db.insert(schema.users).values([
      { name: "Owner", email: "customer-owner@example.test" }, { name: "Staff", email: "customer-staff@example.test" },
      { name: "Contacts", email: "customer-only@example.test" }, { name: "Limited", email: "customer-limited@example.test" },
      { name: "Booking creator", email: "customer-booking-creator@example.test" },
    ]).returning()).map(row => row.id);
    const [customRole] = await db.insert(schema.customRoles).values({ organizationId, name: "Contact viewer", baseRole: "ADMIN", permissions: ["customer:view"] }).returning();
    const [creatorRole] = await db.insert(schema.customRoles).values({ organizationId, name: "Contact booking creator", baseRole: "ADMIN", permissions: ["customer:view", "booking:create"] }).returning();
    await db.insert(schema.organizationMembers).values([
      { organizationId, userId: owner, role: "OWNER" }, { organizationId, userId: staff, role: "STAFF" },
      { organizationId, userId: contactOnly, role: "ADMIN", customRoleId: customRole.id },
      { organizationId, userId: restricted, role: "ADMIN", branchScope: "SELECTED" },
      { organizationId, userId: bookingCreator, role: "ADMIN", customRoleId: creatorRole.id },
    ]);
    const [branch] = await db.insert(schema.branches).values({ organizationId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur" }).returning();
    const [sport] = await db.select().from(schema.sportTypes).limit(1);
    const [resource] = await db.insert(schema.resources).values({ organizationId, branchId: branch.id, sportTypeId: sport.id, name: "Court 1" }).returning();
    [regular, newCustomer, foreignCustomer] = (await db.insert(schema.customers).values([
      { organizationId, name: "Regular\\_%", phone: "+60123456789", email: "regular@example.test" },
      { organizationId, name: "New Customer", phone: "0120000000" },
      { organizationId: otherId, name: "Private Customer", phone: "0190000000" },
    ]).returning()).map(row => row.id);
    const cases = [
      { status: "COMPLETED", startAt: "2026-11-14T02:00:00Z", totalAmount: 3000, amountPaid: 3000, currency: "MYR" },
      { status: "CONFIRMED", startAt: "2026-11-17T02:00:00Z", totalAmount: 4000, amountPaid: 1000, currency: "MYR" },
      { status: "CANCELLED", startAt: "2026-11-18T02:00:00Z", totalAmount: 5000, amountPaid: 2000, currency: "MYR" },
      { status: "AWAITING_PAYMENT", startAt: "2026-11-19T02:00:00Z", totalAmount: 6000, amountPaid: 0, currency: "MYR", holdExpiresAt: new Date(now.getTime() - 1) },
      { status: "COMPLETED", startAt: "2026-11-13T02:00:00Z", totalAmount: 1000, amountPaid: 500, currency: "USD" },
    ];
    for (const row of cases) await db.insert(schema.bookings).values({ ...row, organizationId, branchId: branch.id, resourceId: resource.id,
      customerId: regular, bookingReference: randomUUID().slice(0, 20), startAt: new Date(row.startAt),
      endAt: new Date(new Date(row.startAt).getTime() + 60 * 60_000), source: "STAFF", subtotal: row.totalAmount });
  }, 120000);
  afterAll(async () => postgres.close());

  it("recovers malformed URL fields and retains valid view and search", () => {
    expect(customerListFilters({ q: ["bad"], page: "not-a-number", view: "unknown", sort: "bad" })).toEqual({ q: "", page: 1, view: "all", sort: "newest" });
    expect(customerListFilters({ q: "  Regular  ", page: "2", view: "returning" })).toMatchObject({ q: "Regular", page: 2, view: "returning" });
    expect(customerHistoryFilters({ view: "bad", page: "-1" })).toEqual({ view: "all", page: 1 });
  });
  it("searches literal wildcards and local phone format within the tenant", async () => {
    for (const q of ["\\_%", "0123456789"]) expect((await listCustomers(db, owner, organizationId, { q }, now)).rows.map(row => row.id)).toEqual([regular]);
    expect((await listCustomers(db, owner, organizationId, { q: "0%" }, now)).rows).toEqual([]);
    expect((await listCustomers(db, owner, organizationId, { q: "Private" }, now)).rows).toEqual([]);
  });
  it("filters activity correctly and recovers an out-of-range page", async () => {
    expect((await listCustomers(db, owner, organizationId, { view: "returning", page: 999 }, now))).toMatchObject({ total: 1, pageCount: 1, filters: { page: 1 } });
    expect((await listCustomers(db, owner, organizationId, { view: "upcoming" }, now)).rows.map(row => row.id)).toEqual([regular]);
    expect((await listCustomers(db, owner, organizationId, { view: "no_bookings" }, now)).rows.map(row => row.id)).toEqual([newCustomer]);
  });
  it("paginates the full directory with stable boundaries and an exact result count", async () => {
    const added = await db.insert(schema.customers).values(Array.from({ length: 31 }, (_, index) => ({
      organizationId, name: `Pagination ${String(index).padStart(2, "0")}`, phone: "0120000000", createdAt: now,
    }))).returning({ id: schema.customers.id });
    try {
      const first = await listCustomers(db, owner, organizationId, { q: "Pagination", sort: "name" }, now);
      const second = await listCustomers(db, owner, organizationId, { q: "Pagination", sort: "name", page: 2 }, now);
      expect(first).toMatchObject({ total: 31, pageCount: 2 }); expect(first.rows).toHaveLength(30);
      expect(second.rows).toHaveLength(1); expect(second.rows[0].name).toBe("Pagination 30");
      expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(31);
    } finally { await db.delete(schema.customers).where(inArray(schema.customers.id, added.map(row => row.id))); }
  });
  it("shows per-currency finance and excludes cancelled/expired holds from outstanding", async () => {
    const profile = await getCustomerProfile(db, owner, organizationId, regular, {}, now);
    expect(profile.activity).toEqual({ total: 5, completed: 2, upcoming: 1, cancelled: 1 });
    expect(profile.money).toEqual([{ currency: "MYR", booked: 7000, collected: 6000, outstanding: 3000 },
      { currency: "USD", booked: 1000, collected: 500, outstanding: 500 }]);
    const next = await getCustomerProfile(db, owner, organizationId, regular, { view: "upcoming" }, now);
    expect(next.history).toHaveLength(1); expect(next.history[0].status).toBe("CONFIRMED");
    expect(next.history[0].timezone).toBe("Asia/Kuala_Lumpur");
  });
  it("denies cross-tenant and selected-branch access before returning contact data", async () => {
    await expect(getCustomerProfile(db, owner, organizationId, foreignCustomer, {}, now)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    await expect(listCustomers(db, owner, otherId, {}, now)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(listCustomers(db, restricted, organizationId, {}, now)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("redacts aggregate money and booking history according to effective permissions", async () => {
    const staffProfile = await getCustomerProfile(db, staff, organizationId, regular, {}, now);
    expect(staffProfile.history).toHaveLength(5); expect(staffProfile.money).toEqual([]);
    expect(staffProfile.history[0]).not.toHaveProperty("totalAmount");
    const contacts = await getCustomerProfile(db, contactOnly, organizationId, regular, {}, now);
    expect(contacts.customer.name).toBe("Regular\\_%"); expect(contacts.history).toEqual([]); expect(contacts.activity).toBeUndefined();
    expect(contacts.access).toMatchObject({ canManage: false, canBook: false, canViewFinancial: false });
    const directory = await listCustomers(db, contactOnly, organizationId, { view: "returning", sort: "recent" }, now);
    expect(directory.filters).toMatchObject({ view: "all", sort: "newest" }); expect(directory.rows[0]).not.toHaveProperty("bookingCount");
  });
  it("saves contact and notes with authorization and rejects stale edits", async () => {
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, newCustomer));
    const input = { name: "Updated Customer", phone: "+60120000000", email: "updated@example.test", notes: "Prefers Court 1", expectedUpdatedAt: customer.updatedAt.toISOString() };
    await expect(updateCustomer(db, staff, organizationId, newCustomer, input)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const saved = await updateCustomer(db, owner, organizationId, newCustomer, input);
    expect(saved).toMatchObject({ name: "Updated Customer", notes: "Prefers Court 1" });
    await expect(updateCustomer(db, owner, organizationId, newCustomer, input)).rejects.toMatchObject({ code: "STALE_CUSTOMER" });
    await expect(updateCustomer(db, owner, organizationId, foreignCustomer, input)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, newCustomer))).at(-1)?.summary).toBe("Updated customer contact details or internal notes");
  });
  it("preselects an exact authorized customer for new booking and rejects foreign IDs", async () => {
    expect(await getBookingCustomer(db, owner, organizationId, regular)).toMatchObject({ id: regular, previousBookings: 5 });
    await expect(getBookingCustomer(db, owner, organizationId, foreignCustomer)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    await expect(getBookingCustomer(db, contactOnly, organizationId, regular)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("allows customer preselection without exposing booking counts to a custom booking creator", async () => {
    const customer = await getBookingCustomer(db, bookingCreator, organizationId, regular);
    expect(customer).toMatchObject({ id: regular, phone: "+60123456789", email: "regular@example.test" });
    expect(customer).not.toHaveProperty("previousBookings");
    await expect(getBookingCustomer(db, bookingCreator, organizationId, foreignCustomer)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });
  it("gates customer search counts by effective booking view permission", async () => {
    const visible = await searchBookingCustomers(db, owner, organizationId, "Regular");
    expect(visible).toHaveLength(1); expect(visible[0]).toMatchObject({ id: regular, previousBookings: 5 });
    const redacted = await searchBookingCustomers(db, bookingCreator, organizationId, "Regular");
    expect(redacted).toHaveLength(1); expect(redacted[0]).toMatchObject({ id: regular, phone: "+60123456789" });
    expect(redacted[0]).not.toHaveProperty("previousBookings");
    expect(await searchBookingCustomers(db, bookingCreator, organizationId, "Private")).toEqual([]);
    await expect(searchBookingCustomers(db, contactOnly, organizationId, "Regular")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
