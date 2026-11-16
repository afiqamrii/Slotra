import { and, asc, count, desc, eq, gte, gt, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { bookings, branches, customers, resources } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";

const listInput = z.object({ q: z.string().trim().max(100).default(""),
  view: z.enum(["all", "returning", "upcoming", "no_bookings"]).default("all"),
  sort: z.enum(["newest", "name", "recent"]).default("newest"),
  page: z.coerce.number().int().min(1).max(1000).default(1) });
const historyInput = z.object({ view: z.enum(["all", "upcoming", "past", "cancelled"]).default("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1) });
export function customerListFilters(raw: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(listInput.shape)) {
    if (Array.isArray(raw[key])) continue;
    const parsed = validator.safeParse(raw[key]);
    if (parsed.success) values[key] = parsed.data;
  }
  return listInput.parse(values);
}
export function customerHistoryFilters(raw: Record<string, unknown>) {
  return historyInput.parse({ view: historyInput.shape.view.safeParse(Array.isArray(raw.view) ? undefined : raw.view).data,
    page: historyInput.shape.page.safeParse(Array.isArray(raw.page) ? undefined : raw.page).data });
}
export function customerDirectoryHref(filters: Record<string, string | number | undefined>, changes: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes })) if (value !== undefined && value !== "") query.set(key, String(value));
  return `/customers${query.size ? `?${query}` : ""}`;
}
const committed = inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]);
const upcoming = (now: Date) => and(gte(bookings.startAt, now), or(
  inArray(bookings.status, ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"]),
  and(eq(bookings.status, "AWAITING_PAYMENT"), gt(bookings.holdExpiresAt, now))));

async function customerAccess(db: BookingDatabase, actorId: string, organizationId: string, permission: "customer:view" | "customer:manage" = "customer:view") {
  // Customers are organization-wide. A selected branch must never expand access.
  const member = await authorizedMembership(db, actorId, organizationId, permission);
  if (!member || member.branchScope !== "ALL") throw new BookingError("PERMISSION_DENIED", "Customer access denied");
  await requireOrganizationFeature(db, organizationId, "CUSTOMER_DATABASE");
  const [createMember, manageMember] = await Promise.all([
    authorizedMembership(db, actorId, organizationId, "booking:create"),
    authorizedMembership(db, actorId, organizationId, "customer:manage"),
  ]);
  return { canBook: !!createMember,
    canViewBookings: member.effectivePermissions.includes("booking:view"),
    canViewFinancial: member.effectivePermissions.includes("report:view_financial") && member.effectivePermissions.includes("payment:view"),
    canManage: !!manageMember };
}

export async function listCustomers(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  const access = await customerAccess(db, actorId, organizationId);
  const input = listInput.parse(raw);
  if (!access.canViewBookings) { input.view = "all"; if (input.sort === "recent") input.sort = "newest"; }
  const escaped = input.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const pattern = `%${escaped}%`;
  const conditions: SQL[] = [eq(customers.organizationId, organizationId)];
  if (input.q) conditions.push(or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.email, pattern),
    input.q.startsWith("0") && input.q.length > 1 ? ilike(customers.phone, `%${escaped.slice(1)}%`) : undefined)!);
  const totalBookings = count(bookings.id);
  const completedBookings = sql<number>`count(${bookings.id}) filter (where ${committed})`.mapWith(Number);
  const upcomingBookings = sql<number>`count(${bookings.id}) filter (where ${upcoming(now)})`.mapWith(Number);
  const lastBooking = sql<string | null>`max(${bookings.startAt}) filter (where ${committed} and ${bookings.startAt} <= ${now})`;
  const having = input.view === "returning" ? sql`${completedBookings} >= 2` : input.view === "upcoming" ? sql`${upcomingBookings} > 0`
    : input.view === "no_bookings" ? sql`${totalBookings} = 0` : undefined;
  const query = db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email,
    createdAt: customers.createdAt,
    ...(access.canViewBookings ? { bookingCount: totalBookings, lastBooking, upcomingCount: upcomingBookings } : {}),
  }).from(customers).leftJoin(bookings, and(eq(bookings.organizationId, organizationId), eq(bookings.customerId, customers.id)))
    .where(and(...conditions)).groupBy(customers.id).having(having);
  const [{ total }] = await db.select({ total: count() }).from(query.as("matching_customers"));
  const pageCount = Math.max(1, Math.ceil(total / 30));
  input.page = Math.min(input.page, pageCount);
  const rows = await query.orderBy(...(input.sort === "name" ? [asc(customers.name), asc(customers.id)]
    : input.sort === "recent" ? [sql`${lastBooking} desc nulls last`, asc(customers.name), asc(customers.id)]
      : [desc(customers.createdAt), asc(customers.id)])).limit(30).offset((input.page - 1) * 30);
  return { rows, total, pageCount, filters: input, access };
}

export async function getCustomerProfile(db: BookingDatabase, actorId: string, organizationId: string, customerId: string, raw: unknown, now = new Date()) {
  const access = await customerAccess(db, actorId, organizationId);
  if (!z.uuid().safeParse(customerId).success) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
  const [customer] = await db.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId))).limit(1);
  if (!customer) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
  const input = historyInput.parse(raw);
  const scope = and(eq(bookings.organizationId, organizationId), eq(bookings.customerId, customerId));
  const conditions: SQL[] = [scope!];
  if (input.view === "upcoming") conditions.push(upcoming(now)!);
  if (input.view === "past") conditions.push(lt(bookings.endAt, now));
  if (input.view === "cancelled") conditions.push(inArray(bookings.status, ["CANCELLED", "EXPIRED"]));
  const [{ total }] = access.canViewBookings ? await db.select({ total: count() }).from(bookings).where(and(...conditions)) : [{ total: 0 }];
  const pageCount = Math.max(1, Math.ceil(total / 15));
  input.page = Math.min(input.page, pageCount);
  const history = access.canViewBookings ? await db.select({ id: bookings.id, reference: bookings.bookingReference,
    startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status, source: bookings.source,
    branchName: branches.name, timezone: branches.timezone, resourceName: resources.name,
    ...(access.canViewFinancial ? { totalAmount: bookings.totalAmount, amountPaid: bookings.amountPaid, currency: bookings.currency } : {}),
  }).from(bookings)
    .innerJoin(branches, and(eq(branches.organizationId, organizationId), eq(branches.id, bookings.branchId)))
    .innerJoin(resources, and(eq(resources.organizationId, organizationId), eq(resources.id, bookings.resourceId)))
    .where(and(...conditions)).orderBy(input.view === "upcoming" ? asc(bookings.startAt) : desc(bookings.startAt), asc(bookings.id))
    .limit(15).offset((input.page - 1) * 15) : [];
  const [activity] = access.canViewBookings ? await db.select({ total: count(),
    completed: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED')`.mapWith(Number),
    upcoming: sql<number>`count(*) filter (where ${upcoming(now)})`.mapWith(Number),
    cancelled: sql<number>`count(*) filter (where ${bookings.status} in ('CANCELLED', 'EXPIRED'))`.mapWith(Number),
  }).from(bookings).where(scope) : [];
  const money = access.canViewBookings && access.canViewFinancial ? await db.select({ currency: bookings.currency,
    booked: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${committed}), 0)`.mapWith(Number),
    collected: sql<number>`coalesce(sum(${bookings.amountPaid}), 0)`.mapWith(Number),
    outstanding: sql<number>`coalesce(sum(greatest(0, ${bookings.totalAmount} - ${bookings.amountPaid})) filter (where ${committed}), 0)`.mapWith(Number),
  }).from(bookings).where(scope).groupBy(bookings.currency).orderBy(asc(bookings.currency)) : [];
  return { customer, access, history, activity, money, total, pageCount, filters: input };
}

const updateInput = z.object({ name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30).regex(/^[+0-9()\s-]+$/, "Enter a valid phone number"),
  email: z.union([z.email(), z.literal("")]), notes: z.string().trim().max(2000), expectedUpdatedAt: z.iso.datetime({ offset: true }) });
export async function updateCustomer(db: BookingDatabase, actorId: string, organizationId: string, customerId: string, raw: unknown) {
  await customerAccess(db, actorId, organizationId, "customer:manage");
  if (!z.uuid().safeParse(customerId).success) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
  const input = updateInput.parse(raw);
  return db.transaction(async tx => {
    const [current] = await tx.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId))).for("update").limit(1);
    if (!current) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
    if (current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime())
      throw new BookingError("STALE_CUSTOMER", "This customer was updated by someone else. Refresh the page before editing again.");
    const [saved] = await tx.update(customers).set({ name: input.name, phone: input.phone, email: input.email || null,
      notes: input.notes || null, updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) })
      .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId))).returning();
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "customer.updated", entityType: "customer", entityId: customerId,
      summary: "Updated customer contact details or internal notes" });
    return saved;
  });
}

export async function getBookingCustomer(db: BookingDatabase, actorId: string, organizationId: string, customerId: string) {
  const access = await customerAccess(db, actorId, organizationId);
  if (!access.canBook || !await authorizedMembership(db, actorId, organizationId, "booking:create"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  if (!z.uuid().safeParse(customerId).success) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
  const [customer] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email })
    .from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId))).limit(1);
  if (!customer) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found");
  if (!access.canViewBookings) return customer;
  const [{ total }] = await db.select({ total: count() }).from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.customerId, customerId)));
  return { ...customer, previousBookings: total };
}
