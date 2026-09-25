import { and, eq, gte, lt } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { bookings, branches, corporateAccounts, corporateCharges, operatingHours, organizations, resourceBlocks, resources } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { effectiveWindows } from "@/lib/booking-time";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { intersectionMinutes, mergedSpans, professionalWindow, subtractSpans } from "@/lib/professional-reporting";

const inputSchema = z.object({
  range: z.enum(["today", "last7", "this_month", "last_month", "last30", "custom"]).default("this_month"),
  from: z.iso.date().optional(), to: z.iso.date().optional(), branchId: z.uuid().optional(),
  sort: z.enum(["bookings", "bookingValue", "collected", "utilization"]).default("bookingValue"),
});
const counted = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]);
const occupied = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"]);
type Span = { start: number; end: number };

export async function proExecutiveReport(db: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown, now = new Date()) {
  const input = inputSchema.parse(raw);
  const member = await authorizedMembership(db, actorId, organizationId, "report:view_financial", input.branchId);
  if (!member || (member.branchScope === "SELECTED" && !input.branchId)) throw new Error("Permission denied");
  await requireOrganizationFeature(db, organizationId, "EXECUTIVE_REPORTS");
  const [venue, branchRows] = await Promise.all([
    db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select({ id: branches.id, name: branches.name, timezone: branches.timezone, isActive: branches.isActive })
      .from(branches).where(eq(branches.organizationId, organizationId)).orderBy(branches.createdAt),
  ]);
  if (!venue[0]) throw new Error("Venue not found");
  if (input.branchId && !branchRows.some(branch => branch.id === input.branchId)) throw new Error("Branch not found");
  const allowedBranches = member.branchScope === "SELECTED" ? branchRows.filter(branch => branch.id === input.branchId) : branchRows;
  const selected = input.branchId ? allowedBranches.filter(branch => branch.id === input.branchId) : allowedBranches;
  const windows = new Map(selected.map(branch => [branch.id, professionalWindow(input, branch.timezone, now)]));
  if (!selected.length) return { branches: [], branchOptions: allowedBranches, currency: venue[0].currency,
    filter: input, totals: { bookings: 0, bookingValue: 0, collected: 0, outstanding: 0,
      availableMinutes: 0, bookedMinutes: 0, utilization: null as number | null, activeResources: 0 },
    resources: [], corporate: [] };
  const from = new Date(Math.min(...[...windows.values()].map(window => window.from.getTime())));
  const to = new Date(Math.max(...[...windows.values()].map(window => window.to.getTime())));
  const [bookingRows, resourceRows, hourRows, blockRows, corporateRows] = await Promise.all([
    db.select({ id: bookings.id, branchId: bookings.branchId, resourceId: bookings.resourceId, startAt: bookings.startAt,
      endAt: bookings.endAt, status: bookings.status, total: bookings.totalAmount, paid: bookings.amountPaid })
      .from(bookings).where(and(eq(bookings.organizationId, organizationId), lt(bookings.startAt, to),
        gte(bookings.endAt, from))).limit(50001),
    db.select({ id: resources.id, branchId: resources.branchId, name: resources.name, status: resources.status })
      .from(resources).where(eq(resources.organizationId, organizationId)),
    db.select().from(operatingHours).where(eq(operatingHours.organizationId, organizationId)),
    db.select({ branchId: resourceBlocks.branchId, resourceId: resourceBlocks.resourceId,
      startAt: resourceBlocks.startAt, endAt: resourceBlocks.endAt })
      .from(resourceBlocks).where(and(eq(resourceBlocks.organizationId, organizationId),
        lt(resourceBlocks.startAt, to), gte(resourceBlocks.endAt, from))),
    db.select({ bookingId: corporateCharges.bookingId, accountId: corporateCharges.accountId,
      accountName: corporateAccounts.name, amountMinor: corporateCharges.amountMinor })
      .from(corporateCharges).innerJoin(bookings, and(eq(corporateCharges.organizationId, bookings.organizationId),
        eq(corporateCharges.bookingId, bookings.id)))
      .innerJoin(corporateAccounts, and(eq(corporateCharges.organizationId, corporateAccounts.organizationId),
        eq(corporateCharges.accountId, corporateAccounts.id)))
      .where(and(eq(corporateCharges.organizationId, organizationId), eq(corporateCharges.status, "APPLIED"),
        lt(bookings.startAt, to), gte(bookings.startAt, from))).limit(50001),
  ]);
  if (bookingRows.length > 50000 || corporateRows.length > 50000)
    throw new Error("This period has too many bookings. Choose a shorter range.");
  const bookingByBranch = new Map(selected.map(branch => [branch.id, bookingRows.filter(row => row.branchId === branch.id)]));
  const bookingByResource = new Map<string, typeof bookingRows>();
  for (const row of bookingRows) bookingByResource.set(row.resourceId, [...(bookingByResource.get(row.resourceId) ?? []), row]);
  const hoursByBranch = new Map(selected.map(branch => [branch.id, hourRows.filter(hour => hour.branchId === branch.id)]));
  const blocksByResource = new Map<string, typeof blockRows>();
  for (const block of blockRows) blocksByResource.set(block.resourceId, [...(blocksByResource.get(block.resourceId) ?? []), block]);
  const includedBookingIds = new Set<string>();
  const branchResults = selected.map(branch => {
    const window = windows.get(branch.id)!;
    const rows = bookingByBranch.get(branch.id)!;
    const starting = rows.filter(row => row.startAt >= window.from && row.startAt < window.to);
    const valid = starting.filter(row => counted.has(row.status));
    for (const row of valid) includedBookingIds.add(row.id);
    const branchResources = resourceRows.filter(row => row.branchId === branch.id && row.status !== "DISABLED");
    let availableMinutes = 0, bookedMinutes = 0;
    const resourceMetrics = branchResources.map(space => {
      const spaceBookings = bookingByResource.get(space.id) ?? [];
      const open: Span[] = [];
      let day = Temporal.PlainDate.from(window.fromDate);
      const last = Temporal.PlainDate.from(window.toDate);
      while (Temporal.PlainDate.compare(day, last) <= 0) {
        open.push(...effectiveWindows(hoursByBranch.get(branch.id) ?? [], space.id,
          day, branch.timezone).map(item => ({ start: item.startAt.getTime(), end: item.endAt.getTime() })));
        day = day.add({ days: 1 });
      }
      const clipped = mergedSpans(open.map(span => ({ start: Math.max(span.start, window.from.getTime()),
        end: Math.min(span.end, window.to.getTime()) })));
      const cuts = (blocksByResource.get(space.id) ?? []).filter(block => block.branchId === branch.id)
        .map(block => ({ start: block.startAt.getTime(), end: block.endAt.getTime() }));
      const usable = space.status === "MAINTENANCE" ? [] : subtractSpans(clipped, cuts);
      const reserved = spaceBookings.filter(row => occupied.has(row.status))
        .map(row => ({ start: row.startAt.getTime(), end: row.endAt.getTime() }));
      const available = usable.reduce((sum, span) => sum + (span.end - span.start) / 60000, 0);
      const booked = intersectionMinutes(usable, reserved);
      availableMinutes += available; bookedMinutes += booked;
      return { id: space.id, name: space.name, branchId: branch.id, branchName: branch.name,
        bookingValue: spaceBookings.filter(row => row.startAt >= window.from && row.startAt < window.to && counted.has(row.status))
          .reduce((sum, row) => sum + row.total, 0),
        collected: spaceBookings.filter(row => row.startAt >= window.from && row.startAt < window.to)
          .reduce((sum, row) => sum + row.paid, 0),
        bookedHours: Math.round(booked / 60 * 10) / 10,
        utilization: available ? Math.round(booked / available * 100) : null };
    });
    return { id: branch.id, name: branch.name, timezone: branch.timezone, isActive: branch.isActive,
      bookings: valid.length, bookingValue: valid.reduce((sum, row) => sum + row.total, 0),
      collected: starting.reduce((sum, row) => sum + row.paid, 0),
      outstanding: valid.reduce((sum, row) => sum + Math.max(0, row.total - row.paid), 0),
      availableMinutes, bookedMinutes, utilization: availableMinutes ? Math.round(bookedMinutes / availableMinutes * 100) : null,
      resources: resourceMetrics, fromDate: window.fromDate, toDate: window.toDate };
  });
  branchResults.sort((a, b) => input.sort === "utilization" ? (b.utilization ?? -1) - (a.utilization ?? -1) :
    b[input.sort] - a[input.sort]);
  const totals = branchResults.reduce((sum, branch) => ({ bookings: sum.bookings + branch.bookings,
    bookingValue: sum.bookingValue + branch.bookingValue, collected: sum.collected + branch.collected,
    outstanding: sum.outstanding + branch.outstanding,
    availableMinutes: sum.availableMinutes + branch.availableMinutes,
    bookedMinutes: sum.bookedMinutes + branch.bookedMinutes }),
  { bookings: 0, bookingValue: 0, collected: 0, outstanding: 0, availableMinutes: 0, bookedMinutes: 0 });
  const corporate = new Map<string, { id: string; name: string; bookings: number; valueMinor: number }>();
  for (const row of corporateRows) if (includedBookingIds.has(row.bookingId)) {
    const current = corporate.get(row.accountId) ?? { id: row.accountId, name: row.accountName,
      bookings: 0, valueMinor: 0 };
    current.bookings++; current.valueMinor += row.amountMinor; corporate.set(row.accountId, current);
  }
  return { branches: branchResults, branchOptions: allowedBranches, currency: venue[0].currency, filter: input,
    totals: { ...totals, utilization: totals.availableMinutes ? Math.round(totals.bookedMinutes / totals.availableMinutes * 100) : null,
      activeResources: resourceRows.filter(row => selected.some(branch => branch.id === row.branchId) && row.status === "ACTIVE").length },
    resources: branchResults.flatMap(branch => branch.resources).sort((a, b) => b.bookingValue - a.bookingValue),
    corporate: [...corporate.values()].sort((a, b) => b.valueMinor - a.valueMinor) };
}
