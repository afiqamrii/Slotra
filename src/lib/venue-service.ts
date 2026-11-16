import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { basePrices, branches, operatingHours, organizationSports, organizations, resources, sportTypes } from "@/db/schema";
import { authorizedMembership } from "@/lib/organization-service";
import { organizationLimit } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const reservedSlugs = new Set(["admin", "api", "app", "auth", "book", "dashboard", "help", "login", "register", "settings", "setup", "support", "www"]);
export const slugSchema = z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens").refine(value => !reservedSlugs.has(value), "This address is reserved");
const name = z.string().trim().min(2).max(120);
const address = z.object({
  addressLine1: z.string().trim().min(3).max(250),
  addressLine2: z.string().trim().max(250).optional().default(""),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  postcode: z.string().trim().min(2).max(20),
  country: z.string().length(2).regex(/^[A-Z]{2}$/),
});
const duration = z.number().int().min(15).max(1440);
const timezone = z.string().refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Choose a valid timezone");
export const branchInput = address.extend({ name, timezone, isActive: z.boolean() });
const resourceCore = z.object({
  name, sportTypeId: z.uuid(), branchId: z.uuid(),
  bookingIntervalMinutes: duration, minimumDurationMinutes: duration,
  maximumDurationMinutes: duration.nullable(),
  status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
});
export const resourceInput = resourceCore.refine(value => value.maximumDurationMinutes === null || value.maximumDurationMinutes >= value.minimumDurationMinutes, "Maximum duration must be at least the minimum");
export const hoursInput = z.array(z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  closed: z.boolean(), startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(2880),
}).refine(value => value.closed || value.endMinute > value.startMinute, "Closing must be after opening")).length(7)
  .refine(value => new Set(value.map(day => day.dayOfWeek)).size === 7, "Provide each day once");
export const branchSetupInput = z.object({
  branch: branchInput,
  hours: hoursInput,
  prices: z.array(z.object({ sportTypeId: z.uuid(), amountMinor: z.number().int().min(0).max(100000000) }))
    .min(1).max(11).refine(rows => new Set(rows.map(row => row.sportTypeId)).size === rows.length,
      "Choose each sport only once"),
});
export const setupInput = z.object({
  name, displayName: name, contactPhone: z.string().trim().min(7).max(30).regex(/^[+\d()\s-]+$/),
  contactEmail: z.email().max(254), ...address.shape,
  timezone, currency: z.string().regex(/^[A-Z]{3}$/), locale: z.string().min(2).max(20),
  slug: slugSchema, primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sports: z.array(z.uuid()).min(1).max(11).refine(value => new Set(value).size === value.length),
  branch: branchInput,
  resources: z.array(resourceCore.omit({ branchId: true, status: true }).refine(value => value.maximumDurationMinutes === null || value.maximumDurationMinutes >= value.minimumDurationMinutes)).min(1).max(100)
    .refine(value => new Set(value.map(item => item.name.toLowerCase())).size === value.length, "Space names must be unique"),
  hours: hoursInput,
  prices: z.array(z.object({ sportTypeId: z.uuid(), amountMinor: z.number().int().min(0).max(100000000) })),
}).superRefine((value, ctx) => {
  if (value.resources.some(item => !value.sports.includes(item.sportTypeId))) ctx.addIssue({ code: "custom", path: ["resources"], message: "Spaces must use a selected sport" });
  if (value.prices.length !== value.sports.length || new Set(value.prices.map(item => item.sportTypeId)).size !== value.sports.length || value.prices.some(item => !value.sports.includes(item.sportTypeId))) ctx.addIssue({ code: "custom", path: ["prices"], message: "Provide one base price per sport" });
});

export async function slugAvailable(database: Database, slug: string, excludeId?: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return false;
  const [existing] = await database.select({ id: organizations.id }).from(organizations)
    .where(excludeId ? and(eq(organizations.slug, parsed.data), ne(organizations.id, excludeId)) : eq(organizations.slug, parsed.data)).limit(1);
  return !existing;
}
export async function completeSetup(database: Database, actorId: string, organizationId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:update")) throw new Error("Permission denied");
  const input = setupInput.parse(raw);
  return database.transaction(async tx => {
    const [current] = await tx.select({ completed: organizations.onboardingCompletedAt, planCode: organizations.planCode }).from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!current || current.completed) throw new Error("Setup is already complete");
    const resourceLimit = await organizationLimit(tx, organizationId, "RESOURCES");
    if (resourceLimit !== null && input.resources.length > resourceLimit)
      throw new Error("You've reached the Starter resource limit. Set up to 10 courts or spaces, or upgrade to Professional for a higher allowance.");
    const branchLimit = await organizationLimit(tx, organizationId, "BRANCHES");
    if (branchLimit !== null && branchLimit < 1) throw new Error("This plan cannot add a branch.");
    const catalog = await tx.select({ id: sportTypes.id }).from(sportTypes).where(eq(sportTypes.isActive, true));
    if (input.sports.some(id => !catalog.some(item => item.id === id))) throw new Error("Choose available sports");
    if (!await slugAvailable(tx, input.slug, organizationId)) throw new Error("Booking page address is unavailable");
    const now = new Date();
    await tx.update(organizations).set({
      name: input.name, displayName: input.displayName, contactPhone: input.contactPhone, contactEmail: input.contactEmail,
      addressLine1: input.addressLine1, addressLine2: input.addressLine2, city: input.city, state: input.state,
      postcode: input.postcode, country: input.country, timezone: input.timezone, currency: input.currency,
      locale: input.locale, slug: input.slug, primaryColor: input.primaryColor, onboardingCompletedAt: now, updatedAt: now,
    }).where(eq(organizations.id, organizationId));
    const [branch] = await tx.insert(branches).values({
      organizationId, slug: "main-venue", ...input.branch,
    }).returning();
    await tx.insert(organizationSports).values(input.sports.map(sportTypeId => ({ organizationId, sportTypeId })));
    await tx.insert(resources).values(input.resources.map(item => ({ ...item, organizationId, branchId: branch.id })));
    const open = input.hours.filter(day => !day.closed);
    if (open.length) await tx.insert(operatingHours).values(open.map(day => ({
      organizationId, branchId: branch.id, dayOfWeek: day.dayOfWeek, startMinute: day.startMinute, endMinute: day.endMinute,
    })));
    await tx.insert(basePrices).values(input.prices.map(item => ({ ...item, organizationId, branchId: branch.id })));
    return branch.id;
  });
}
export async function updateBranch(database: Database, actorId: string, organizationId: string, branchId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "branch:manage")) throw new Error("Permission denied");
  const input = branchInput.parse(raw);
  return database.transaction(async tx => {
    const [current] = await tx.select({ isActive: branches.isActive }).from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, organizationId))).for("update").limit(1);
    if (!current) throw new Error("Branch not found");
    if (!current.isActive && input.isActive) await assertBranchCapacity(tx, organizationId);
    const [updated] = await tx.update(branches).set({ ...input, updatedAt: new Date() })
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, organizationId))).returning();
    await recordAudit(tx, { organizationId, branchId, actorUserId: actorId, action: "branch.updated",
      entityType: "branch", entityId: branchId, summary: `Updated ${updated.name} branch` });
    return updated;
  });
}
async function assertBranchCapacity(database: Database, organizationId: string) {
  const [venue] = await database.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!venue) throw new Error("Venue not found");
  const limit = await organizationLimit(database, organizationId, "BRANCHES");
  if (limit === null) return;
  const [used] = await database.select({ count: count() }).from(branches)
    .where(and(eq(branches.organizationId, organizationId), eq(branches.isActive, true)));
  if ((used?.count ?? 0) >= limit) throw new Error(`Your plan allows ${limit} active branches.`);
}

export async function createBranch(database: Database, actorId: string, organizationId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "branch:manage")) throw new Error("Permission denied");
  if (!await authorizedMembership(database, actorId, organizationId, "pricing:manage")) throw new Error("Pricing permission required to set base prices.");
  await requireOrganizationFeature(database, organizationId, "MULTI_BRANCH");
  const input = branchSetupInput.parse(raw);
  if (!input.branch.isActive) throw new Error("Create an active branch, then pause it later if needed.");
  return database.transaction(async tx => {
    await assertBranchCapacity(tx, organizationId);
    const ownedSports = await tx.select({ sportTypeId: organizationSports.sportTypeId }).from(organizationSports)
      .where(eq(organizationSports.organizationId, organizationId));
    if (input.prices.some(price => !ownedSports.some(sport => sport.sportTypeId === price.sportTypeId)))
      throw new Error("Choose sports offered by this venue.");
    const base = input.branch.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 80) || "branch";
    const existing = await tx.select({ slug: branches.slug }).from(branches)
      .where(eq(branches.organizationId, organizationId));
    const taken = new Set(existing.map(row => row.slug));
    let slug = base;
    for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`;
    const [created] = await tx.insert(branches).values({ organizationId, slug, ...input.branch }).returning();
    const open = input.hours.filter(day => !day.closed);
    if (open.length) await tx.insert(operatingHours).values(open.map(day => ({ organizationId,
      branchId: created.id, dayOfWeek: day.dayOfWeek, startMinute: day.startMinute, endMinute: day.endMinute })));
    await tx.insert(basePrices).values(input.prices.map(price => ({ organizationId, branchId: created.id, ...price })));
    await recordAudit(tx, { organizationId, branchId: created.id, actorUserId: actorId, action: "branch.created",
      entityType: "branch", entityId: created.id, summary: `Created ${created.name} branch` });
    return created;
  });
}
export async function updateBranchSetup(database: Database, actorId: string, organizationId: string,
  branchId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "branch:manage")) throw new Error("Permission denied");
  const input = branchSetupInput.parse(raw);
  return database.transaction(async tx => {
    const [current] = await tx.select().from(branches)
      .where(and(eq(branches.organizationId, organizationId), eq(branches.id, branchId))).for("update").limit(1);
    if (!current) throw new Error("Branch not found");
    if (!current.isActive && input.branch.isActive) await assertBranchCapacity(tx, organizationId);
    const [ownedSports, branchResources] = await Promise.all([
      tx.select({ sportTypeId: organizationSports.sportTypeId }).from(organizationSports)
        .where(eq(organizationSports.organizationId, organizationId)),
      tx.select({ sportTypeId: resources.sportTypeId }).from(resources)
        .where(and(eq(resources.organizationId, organizationId), eq(resources.branchId, branchId), ne(resources.status, "DISABLED"))),
    ]);
    const selected = new Set(input.prices.map(price => price.sportTypeId));
    if (input.prices.some(price => !ownedSports.some(sport => sport.sportTypeId === price.sportTypeId)) ||
      branchResources.some(space => !selected.has(space.sportTypeId)))
      throw new Error("Keep a price for every sport with an active court or space at this branch.");
    const previousPrices = await tx.select({ sportTypeId: basePrices.sportTypeId, amountMinor: basePrices.amountMinor })
      .from(basePrices).where(and(eq(basePrices.organizationId, organizationId), eq(basePrices.branchId, branchId)));
    const pricesChanged = input.prices.length !== previousPrices.length || input.prices.some(price =>
      !previousPrices.some(previous => previous.sportTypeId === price.sportTypeId && previous.amountMinor === price.amountMinor));
    if (pricesChanged && !await authorizedMembership(tx, actorId, organizationId, "pricing:manage"))
      throw new Error("Pricing permission required to change base prices.");
    await tx.update(branches).set({ ...input.branch, updatedAt: new Date() })
      .where(and(eq(branches.organizationId, organizationId), eq(branches.id, branchId)));
    await tx.delete(operatingHours).where(and(eq(operatingHours.organizationId, organizationId),
      eq(operatingHours.branchId, branchId), isNull(operatingHours.resourceId)));
    const open = input.hours.filter(day => !day.closed);
    if (open.length) await tx.insert(operatingHours).values(open.map(day => ({ organizationId,
      branchId, dayOfWeek: day.dayOfWeek, startMinute: day.startMinute, endMinute: day.endMinute })));
    if (pricesChanged) {
      await tx.delete(basePrices).where(and(eq(basePrices.organizationId, organizationId), eq(basePrices.branchId, branchId)));
      await tx.insert(basePrices).values(input.prices.map(price => ({ organizationId, branchId, ...price })));
    }
    for (const price of input.prices) {
      const previous = previousPrices.find(row => row.sportTypeId === price.sportTypeId)?.amountMinor ?? null;
      if (previous !== price.amountMinor) await recordAudit(tx, { organizationId, branchId, actorUserId: actorId,
        action: "pricing.changed", entityType: "base_price", summary: `Changed ${current.name} base pricing`,
        details: { sportTypeId: price.sportTypeId, previousMinor: previous, nextMinor: price.amountMinor } });
    }
    await recordAudit(tx, { organizationId, branchId, actorUserId: actorId, action: "branch.updated",
      entityType: "branch", entityId: branchId, summary: `Updated ${current.name} branch details and hours` });
    return current.id;
  });
}
export async function createResource(database: Database, actorId: string, organizationId: string, raw: unknown) {
  const input = resourceInput.parse(raw);
  if (!await authorizedMembership(database, actorId, organizationId, "resource:manage", input.branchId)) throw new Error("Permission denied");
  return database.transaction(async tx => {
    if (input.status !== "DISABLED") await assertResourceCapacity(tx, organizationId);
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.organizationId, organizationId), eq(branches.id, input.branchId))).limit(1);
    const [sport] = await tx.select({ id: organizationSports.sportTypeId }).from(organizationSports).where(and(eq(organizationSports.organizationId, organizationId), eq(organizationSports.sportTypeId, input.sportTypeId))).limit(1);
    if (!branch || !sport) throw new Error("Branch or sport is not in this venue");
    const [created] = await tx.insert(resources).values({ ...input, organizationId }).returning();
    return created;
  });
}
async function assertResourceCapacity(database: Database, organizationId: string) {
  const [venue] = await database.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!venue) throw new Error("Venue not found");
  const limit = await organizationLimit(database, organizationId, "RESOURCES");
  if (limit === null) return;
  const [row] = await database.select({ used: count() }).from(resources)
    .where(and(eq(resources.organizationId, organizationId), ne(resources.status, "DISABLED")));
  if ((row?.used ?? 0) >= limit)
    throw new Error("You've reached the Starter resource limit. Upgrade to Professional for a higher resource allowance.");
}
export async function updateResource(database: Database, actorId: string, organizationId: string, resourceId: string, raw: unknown) {
  const input = resourceInput.parse(raw);
  return database.transaction(async tx => {
    // Match booking mutations: resource row before organization quota row.
    const [existing] = await tx.select().from(resources).where(and(eq(resources.id, resourceId), eq(resources.organizationId, organizationId))).for("update").limit(1);
    if (!existing) throw new Error("Space not found");
    if (!await authorizedMembership(tx, actorId, organizationId, "resource:manage", existing.branchId) ||
      !await authorizedMembership(tx, actorId, organizationId, "resource:manage", input.branchId)) throw new Error("Permission denied");
    if (existing.status === "DISABLED" && input.status !== "DISABLED") await assertResourceCapacity(tx, organizationId);
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, input.branchId), eq(branches.organizationId, organizationId))).limit(1);
    const [sport] = await tx.select({ id: organizationSports.sportTypeId }).from(organizationSports).where(and(eq(organizationSports.organizationId, organizationId), eq(organizationSports.sportTypeId, input.sportTypeId))).limit(1);
    if (!branch || !sport) throw new Error("Branch or sport is not in this venue");
    const [updated] = await tx.update(resources).set({ ...input, updatedAt: new Date() })
      .where(and(eq(resources.id, resourceId), eq(resources.organizationId, organizationId))).returning();
    return updated;
  });
}
export async function changeResourceStatus(database: Database, actorId: string, organizationId: string, resourceId: string, status: unknown) {
  const parsed = z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]).parse(status);
  return database.transaction(async tx => {
    const [existing] = await tx.select({ status: resources.status, branchId: resources.branchId }).from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.organizationId, organizationId))).for("update").limit(1);
    if (!existing) throw new Error("Space not found");
    if (!await authorizedMembership(tx, actorId, organizationId, "resource:manage", existing.branchId)) throw new Error("Permission denied");
    if (existing.status === "DISABLED" && parsed !== "DISABLED") await assertResourceCapacity(tx, organizationId);
    const [updated] = await tx.update(resources).set({ status: parsed, updatedAt: new Date() })
      .where(and(eq(resources.id, resourceId), eq(resources.organizationId, organizationId))).returning();
    return updated;
  });
}




