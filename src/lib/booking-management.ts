import { and, asc, count, desc, eq, gte, gt, ilike, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { bookings, branches, customers, memberBranches, organizations, resourceBlocks, resources, sportTypes, bookingStatuses, bookingSources } from "@/db/schema";
import { BookingError, loadAvailabilitySnapshot, type BookingDatabase } from "@/lib/booking-availability";
import { containsRange, effectiveWindows, localDateAt, localDayBounds } from "@/lib/booking-time";
import { authorizedMembership } from "@/lib/organization-service";
import type { Permission } from "@/lib/permissions";

const uuid = z.uuid();
const listInput = z.object({
  view: z.enum(["today", "upcoming", "past", "cancelled", "all"]).default("today"),
  date: z.iso.date().optional(),
  branchId: uuid.optional(), resourceId: uuid.optional(), sportTypeId: uuid.optional(),
  status: z.enum(bookingStatuses).optional(), source: z.enum(bookingSources).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type BookingListInput = z.input<typeof listInput>;
// URL filters are editable/bookmarkable: discard malformed fields without crashing the page.
// Domain callers still use listInput.parse and receive strict validation errors.
export function normalizeBookingListInput(raw: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(listInput.shape)) {
    const result = validator.safeParse(raw[key]);
    if (result.success) fields[key] = result.data;
  }
  return listInput.parse(fields);
}
const calendarInput = z.object({
  branchId: uuid.optional(), date: z.iso.date().optional(),
  view: z.enum(["day", "week"]).default("day"),
});
const searchInput = z.string().trim().min(2).max(100);

async function requireAccess(database: BookingDatabase, actorId: string, organizationId: string, permission: Permission, branchId?: string) {
  if (!await authorizedMembership(database, actorId, organizationId, permission, branchId))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
}

export async function bookingSetup(database: BookingDatabase, actorId: string, organizationId: string, permission: Permission = "booking:view") {
  const member = await authorizedMembership(database, actorId, organizationId, "organization:view");
  if (!member) throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  const allowedIds = member.branchScope === "SELECTED" ? (await database.select({ branchId: memberBranches.branchId })
    .from(memberBranches).where(and(eq(memberBranches.organizationId, organizationId),
      eq(memberBranches.memberId, member.memberId)))).map(row => row.branchId) : null;
  if (allowedIds && !allowedIds.length) throw new BookingError("PERMISSION_DENIED", "No branch assigned");
  await requireAccess(database, actorId, organizationId, permission, allowedIds?.[0]);
  const [venue, branchRows, spaceRows] = await Promise.all([
    database.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    database.select({ id: branches.id, name: branches.name, timezone: branches.timezone, isActive: branches.isActive })
      .from(branches).where(and(eq(branches.organizationId, organizationId),
        ...(allowedIds ? [inArray(branches.id, allowedIds)] : []))).orderBy(asc(branches.name)),
    database.select({
      id: resources.id, branchId: resources.branchId, name: resources.name, status: resources.status,
      sportTypeId: resources.sportTypeId, sportName: sportTypes.name, sportCode: sportTypes.code,
      bookingIntervalMinutes: resources.bookingIntervalMinutes, minimumDurationMinutes: resources.minimumDurationMinutes,
      maximumDurationMinutes: resources.maximumDurationMinutes,
    }).from(resources).innerJoin(sportTypes, eq(resources.sportTypeId, sportTypes.id))
      .where(and(eq(resources.organizationId, organizationId),
        ...(allowedIds ? [inArray(resources.branchId, allowedIds)] : [])))
      .orderBy(asc(sportTypes.name), asc(resources.name)),
  ]);
  return { currency: venue[0]?.currency ?? "MYR", branches: branchRows, spaces: spaceRows };
}

export async function listStaffBookings(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  let input = listInput.parse(raw);
  const setup = await bookingSetup(database, actorId, organizationId);
  const branch = input.branchId ? setup.branches.find(item => item.id === input.branchId) : setup.branches[0];
  if (input.branchId && !branch) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
  if (!branch) return { ...setup, branch: null, filters: input, rows: [], hasMore: false, localDate: null };
  // A bookmarked space/sport from another branch must not hide this branch's bookings.
  const branchSpaces = setup.spaces.filter(space => space.branchId === branch.id);
  input = { ...input,
    resourceId: branchSpaces.some(space => space.id === input.resourceId && (!input.sportTypeId || space.sportTypeId === input.sportTypeId)) ? input.resourceId : undefined,
    sportTypeId: branchSpaces.some(space => space.sportTypeId === input.sportTypeId) ? input.sportTypeId : undefined,
  };
  const date = input.date ? Temporal.PlainDate.from(input.date) : localDateAt(now, branch.timezone);
  const bounds = localDayBounds(date, branch.timezone);
  const conditions: SQL[] = [eq(bookings.organizationId, organizationId), eq(bookings.branchId, branch.id)];
  // Reception must still see sessions that began yesterday and cross midnight.
  // Match the calendar's half-open overlap rule, including date-filtered searches.
  if (input.view === "today" || input.date) conditions.push(gt(bookings.endAt, bounds.from), lt(bookings.startAt, bounds.to));
  if (input.view === "upcoming") conditions.push(gte(bookings.startAt, now), ne(bookings.status, "CANCELLED"));
  if (input.view === "past") conditions.push(lt(bookings.endAt, now));
  if (input.view === "cancelled") conditions.push(eq(bookings.status, "CANCELLED"));
  else if (input.view === "today") conditions.push(ne(bookings.status, "CANCELLED"));
  if (input.resourceId) conditions.push(eq(bookings.resourceId, input.resourceId));
  if (input.sportTypeId) conditions.push(eq(resources.sportTypeId, input.sportTypeId));
  if (input.status) conditions.push(eq(bookings.status, input.status));
  if (input.source) conditions.push(eq(bookings.source, input.source));
  if (input.q) {
    const escaped = input.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const pattern = "%" + escaped + "%";
    const phoneVariant = input.q.startsWith("0") ? "%" + escaped.slice(1) + "%" : pattern;
    conditions.push(or(
      ilike(bookings.bookingReference, pattern), ilike(customers.name, pattern),
      ilike(customers.phone, pattern), ilike(customers.phone, phoneVariant),
      ilike(customers.email, pattern),
    )!);
  }
  const rows = await database.select({
    id: bookings.id, reference: bookings.bookingReference, startAt: bookings.startAt, endAt: bookings.endAt,
    status: bookings.status, source: bookings.source, totalAmount: bookings.totalAmount, amountPaid: bookings.amountPaid,
    currency: bookings.currency, customerName: customers.name, customerPhone: customers.phone,
    resourceId: resources.id, resourceName: resources.name, sportName: sportTypes.name, sportTypeId: sportTypes.id,
    branchId: branches.id, branchName: branches.name,
  }).from(bookings)
    .innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(bookings.organizationId, resources.organizationId)))
    .innerJoin(sportTypes, eq(resources.sportTypeId, sportTypes.id))
    .innerJoin(branches, and(eq(bookings.branchId, branches.id), eq(bookings.organizationId, branches.organizationId)))
    .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(bookings.organizationId, customers.organizationId)))
    .where(and(...conditions)).orderBy(input.view === "past" || input.view === "cancelled" || input.view === "all" ? desc(bookings.startAt) : asc(bookings.startAt), asc(bookings.id))
    .limit(51).offset((input.page - 1) * 50);
  return { ...setup, branch, filters: input, rows: rows.slice(0, 50), hasMore: rows.length > 50, localDate: date.toString() };
}

export async function staffBookingDetail(database: BookingDatabase, actorId: string, organizationId: string, bookingId: string) {
  if (!uuid.safeParse(bookingId).success) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  const [row] = await database.select({
    booking: bookings, customer: customers,
    branchName: branches.name, timezone: branches.timezone,
    resourceName: resources.name, sportName: sportTypes.name, sportCode: sportTypes.code,
  }).from(bookings)
    .innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(bookings.organizationId, resources.organizationId)))
    .innerJoin(sportTypes, eq(resources.sportTypeId, sportTypes.id))
    .innerJoin(branches, and(eq(bookings.branchId, branches.id), eq(bookings.organizationId, branches.organizationId)))
    .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(bookings.organizationId, customers.organizationId)))
    .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
  if (!row) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  await requireAccess(database, actorId, organizationId, "booking:view", row.booking.branchId);
  return row;
}

export async function searchBookingCustomers(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  const member = await authorizedMembership(database, actorId, organizationId, "booking:create");
  if (!member) throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  const term = searchInput.parse(raw);
  const escaped = term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const pattern = "%" + escaped + "%";
  const phoneVariant = term.startsWith("0") ? "%" + escaped.slice(1) + "%" : pattern;
  const matches = await database.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email })
    .from(customers).where(and(eq(customers.organizationId, organizationId),
      or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.phone, phoneVariant), ilike(customers.email, pattern))))
    .orderBy(asc(customers.name)).limit(8);
  if (!matches.length || !member.effectivePermissions.includes("booking:view")) return matches;
  const counts = await database.select({ customerId: bookings.customerId, total: count() })
    .from(bookings).where(and(eq(bookings.organizationId, organizationId),
      inArray(bookings.customerId, matches.map(item => item.id)))).groupBy(bookings.customerId);
  const byCustomer = new Map(counts.map(row => [row.customerId, row.total]));
  return matches.map(item => ({ ...item, previousBookings: byCustomer.get(item.id) ?? 0 }));
}

export async function staffCalendar(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  const input = calendarInput.parse(raw);
  const setup = await bookingSetup(database, actorId, organizationId);
  const branch = input.branchId ? setup.branches.find(item => item.id === input.branchId) : setup.branches[0];
  if (input.branchId && !branch) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
  if (!branch) return { ...setup, branch: null, date: null, view: input.view, rows: [], blocks: [], hasMoreBookings: false, hasMoreBlocks: false, from: now, to: now };
  const date = input.date ? Temporal.PlainDate.from(input.date) : localDateAt(now, branch.timezone);
  const first = input.view === "week" ? date.subtract({ days: date.dayOfWeek - 1 }) : date;
  const from = localDayBounds(first, branch.timezone).from;
  const to = localDayBounds(first.add({ days: input.view === "week" ? 7 : 1 }), branch.timezone).from;
  const [rows, blocks] = await Promise.all([
    database.select({
      id: bookings.id, reference: bookings.bookingReference, resourceId: bookings.resourceId,
      startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status, source: bookings.source,
      customerName: customers.name,
    }).from(bookings).leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(bookings.organizationId, customers.organizationId)))
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.branchId, branch.id),
        lt(bookings.startAt, to), gt(bookings.endAt, from), ne(bookings.status, "CANCELLED"), ne(bookings.status, "EXPIRED"),
        or(ne(bookings.status, "AWAITING_PAYMENT"), gt(bookings.holdExpiresAt, now))))
      .orderBy(asc(bookings.startAt), asc(bookings.id)).limit(501),
    database.select({ id: resourceBlocks.id, resourceId: resourceBlocks.resourceId, startAt: resourceBlocks.startAt,
      endAt: resourceBlocks.endAt, type: resourceBlocks.type, reason: resourceBlocks.reason })
      .from(resourceBlocks).where(and(eq(resourceBlocks.organizationId, organizationId), eq(resourceBlocks.branchId, branch.id),
        lt(resourceBlocks.startAt, to), gt(resourceBlocks.endAt, from))).orderBy(asc(resourceBlocks.startAt), asc(resourceBlocks.id)).limit(501),
  ]);
  return { ...setup, branch, date: date.toString(), view: input.view, rows: rows.slice(0, 500), blocks: blocks.slice(0, 500), hasMoreBookings: rows.length > 500, hasMoreBlocks: blocks.length > 500, from, to };
}

export async function staffAvailableNow(database: BookingDatabase, actorId: string, organizationId: string,
  branchId?: string, now = new Date()) {
  const setup = await bookingSetup(database, actorId, organizationId);
  if (branchId && !uuid.safeParse(branchId).success) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
  const branch = branchId ? setup.branches.find(item => item.id === branchId) : setup.branches[0];
  if (branchId && !branch) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
  if (!branch) return { ...setup, branch: null, at: now, spaces: [] };
  const spaces = setup.spaces.filter(item => item.branchId === branch.id);
  if (!spaces.length) return { ...setup, branch, at: now, spaces: [] };
  if (!branch.isActive) return { ...setup, branch, at: now,
    spaces: spaces.map(space => ({ ...space, state: "CLOSED", until: null, reason: null })) };
  const batches = [];
  // Pro branches may have more than the availability loader's 100-space request limit.
  for (let offset = 0; offset < spaces.length; offset += 100) {
    const batch = spaces.slice(offset, offset + 100);
    const snapshot = await loadAvailabilitySnapshot(database, organizationId, branch.id, batch.map(item => item.id),
      new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000));
    batches.push({ spaces: batch, snapshot });
  }
  const date = localDateAt(now, branch.timezone);
  const result = batches.flatMap(({ spaces, snapshot }) => spaces.map(space => {
    const activeBooking = snapshot.reserved.find(row => row.resourceId === space.id && row.startAt <= now && row.endAt > now &&
      (row.status !== "AWAITING_PAYMENT" || (!!row.holdExpiresAt && row.holdExpiresAt > now)));
    const block = snapshot.blocks.find(row => row.resourceId === space.id && row.startAt <= now && row.endAt > now);
    const open = containsRange(effectiveWindows(snapshot.hours, space.id, date, branch.timezone),
      now, new Date(now.getTime() + 1));
    const state = space.status === "MAINTENANCE" ? "MAINTENANCE" : space.status === "DISABLED" ? "DISABLED" :
      activeBooking ? (activeBooking.status === "AWAITING_PAYMENT" ? "HELD" : "IN_USE") : block ? "BLOCKED" : open ? "AVAILABLE" : "CLOSED";
    return { ...space, state, until: activeBooking?.status === "AWAITING_PAYMENT" ? activeBooking.holdExpiresAt : activeBooking?.endAt ?? block?.endAt ?? null, reason: block?.reason ?? null };
  }));
  return { ...setup, branch, at: now, spaces: result };
}


