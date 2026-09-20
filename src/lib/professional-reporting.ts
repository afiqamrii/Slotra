import { and, eq, gte, gt, lt, sql } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { bookings, bookingUsageRecords, branches, customers, operatingHours, refunds, resourceBlocks, resources, sportTypes } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { effectiveWindows, localDateAt, localDayBounds, type TimeWindow } from "@/lib/booking-time";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

const filterSchema = z.object({
  range: z.enum(["today", "last7", "this_month", "last_month", "last30", "custom"]).default("this_month"),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  sport: z.uuid().optional(), resource: z.uuid().optional(),
  status: z.enum(["ALL", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).default("ALL"),
});
export type ProfessionalFilter = z.infer<typeof filterSchema>;
type Span = { start: number; end: number };
const asSpan = (item: TimeWindow) => ({ start: item.startAt.getTime(), end: item.endAt.getTime() });
export function mergedSpans(items: Span[]): Span[] {
  const sorted = items.filter(item => item.end > item.start).sort((a, b) => a.start - b.start);
  const result: Span[] = [];
  for (const item of sorted) {
    const previous = result.at(-1);
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
export function subtractSpans(base: Span[], excluded: Span[]): Span[] {
  const cuts = mergedSpans(excluded);
  return base.flatMap(item => {
    let pieces: Span[] = [item];
    for (const cut of cuts) pieces = pieces.flatMap(piece =>
      cut.end <= piece.start || cut.start >= piece.end ? [piece] :
        [{ start: piece.start, end: Math.min(piece.end, cut.start) },
          { start: Math.max(piece.start, cut.end), end: piece.end }].filter(part => part.end > part.start));
    return pieces;
  });
}
export function intersectionMinutes(left: Span[], right: Span[]) {
  return mergedSpans(left.flatMap(a => right.map(b => ({
    start: Math.max(a.start, b.start), end: Math.min(a.end, b.end),
  })))).reduce((total, span) => total + (span.end - span.start) / 60_000, 0);
}
export function utilization(usable: Span[], booked: Span[]) {
  const availableMinutes = mergedSpans(usable).reduce((sum, span) => sum + (span.end - span.start) / 60_000, 0);
  const bookedMinutes = intersectionMinutes(usable, mergedSpans(booked));
  return { availableMinutes, bookedMinutes, percent: availableMinutes ? Math.round(bookedMinutes / availableMinutes * 100) : null };
}
export function professionalWindow(raw: unknown, timezone: string, now = new Date()) {
  const filter = filterSchema.parse(raw);
  const today = localDateAt(now, timezone);
  let first = today, last = today;
  if (filter.range === "last7") first = today.subtract({ days: 6 });
  if (filter.range === "last30") first = today.subtract({ days: 29 });
  if (filter.range === "this_month") first = today.with({ day: 1 });
  if (filter.range === "last_month") {
    first = today.with({ day: 1 }).subtract({ months: 1 });
    last = today.with({ day: 1 }).subtract({ days: 1 });
  }
  if (filter.range === "custom") {
    if (!filter.from || !filter.to) throw new Error("Choose both dates.");
    first = Temporal.PlainDate.from(filter.from); last = Temporal.PlainDate.from(filter.to);
  }
  const days = last.since(first).days + 1;
  if (days < 1 || days > 93) throw new Error("Choose a date range of up to 93 days.");
  return { filter, fromDate: first.toString(), toDate: last.toString(), days,
    from: localDayBounds(first, timezone).from, to: localDayBounds(last.add({ days: 1 }), timezone).from };
}
const countedStatuses = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]);
const occupiedStatuses = new Set(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"]);
function localParts(date: Date, timezone: string) {
  return Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(timezone);
}
function pct(part: number, total: number) { return total ? Math.round(part / total * 100) : null; }

export async function professionalReport(db: BookingDatabase, organizationId: string, raw: unknown, now = new Date()) {
  await requireOrganizationFeature(db, organizationId, "ADVANCED_ANALYTICS");
  const [branch] = await db.select({ id: branches.id, timezone: branches.timezone }).from(branches)
    .where(and(eq(branches.organizationId, organizationId), eq(branches.isActive, true))).limit(1);
  if (!branch) throw new Error("Set up an active branch before viewing reports.");
  const window = professionalWindow(raw, branch.timezone, now);
  const allResources = await db.select({ id: resources.id, name: resources.name, sportTypeId: resources.sportTypeId,
    sportName: sportTypes.name, status: resources.status }).from(resources)
    .innerJoin(sportTypes, eq(resources.sportTypeId, sportTypes.id))
    .where(and(eq(resources.organizationId, organizationId), eq(resources.branchId, branch.id)));
  if (window.filter.sport && !allResources.some(item => item.sportTypeId === window.filter.sport))
    throw new Error("Choose a sport at this venue.");
  if (window.filter.resource && !allResources.some(item => item.id === window.filter.resource &&
    (!window.filter.sport || item.sportTypeId === window.filter.sport))) throw new Error("Choose a space at this venue.");
  const selected = allResources.filter(item => (!window.filter.sport || item.sportTypeId === window.filter.sport) &&
    (!window.filter.resource || item.id === window.filter.resource));
  const selectedIds = new Set(selected.map(item => item.id));
  const [bookingRows, hourRows, blockRows, firstRows, refundRows] = await Promise.all([
    db.select({ id: bookings.id, resourceId: bookings.resourceId, customerId: bookings.customerId,
      startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status,
      total: bookings.totalAmount, paid: bookings.amountPaid })
      .from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.branchId, branch.id),
        lt(bookings.startAt, window.to), gt(bookings.endAt, window.from))).limit(10001),
    db.select().from(operatingHours).where(and(eq(operatingHours.organizationId, organizationId),
      eq(operatingHours.branchId, branch.id))),
    db.select({ resourceId: resourceBlocks.resourceId, startAt: resourceBlocks.startAt, endAt: resourceBlocks.endAt })
      .from(resourceBlocks).where(and(eq(resourceBlocks.organizationId, organizationId),
        eq(resourceBlocks.branchId, branch.id), lt(resourceBlocks.startAt, window.to), gt(resourceBlocks.endAt, window.from))),
    db.select({ customerId: bookings.customerId, firstAt: sql<Date>`min(${bookingUsageRecords.confirmedAt})`.mapWith(value => new Date(value)) })
      .from(bookingUsageRecords).innerJoin(bookings, and(eq(bookingUsageRecords.bookingId, bookings.id),
        eq(bookings.organizationId, organizationId)))
      .where(and(eq(bookingUsageRecords.organizationId, organizationId), sql`${bookings.customerId} is not null`))
      .groupBy(bookings.customerId),
    db.select({ amount: refunds.amountMinor, bookingId: refunds.bookingId }).from(refunds)
      .where(and(eq(refunds.organizationId, organizationId), eq(refunds.status, "SUCCEEDED"),
        gte(refunds.updatedAt, window.from), lt(refunds.updatedAt, window.to))),
  ]);
  if (bookingRows.length > 10000) throw new Error("This report has too much data. Choose a shorter period.");
  const rows = bookingRows.filter(row => selectedIds.has(row.resourceId));
  const periodRows = rows.filter(row => row.startAt >= window.from && row.startAt < window.to &&
    (window.filter.status === "ALL" || row.status === window.filter.status));
  const active = periodRows.filter(row => countedStatuses.has(row.status));
  const cancelled = periodRows.filter(row => row.status === "CANCELLED");
  const noShows = periodRows.filter(row => row.status === "NO_SHOW");
  const refundIds = new Set(periodRows.map(row => row.id));
  const bookingValue = active.reduce((sum, row) => sum + row.total, 0);
  const collected = periodRows.reduce((sum, row) => sum + row.paid, 0);
  const outstanding = active.reduce((sum, row) => sum + Math.max(0, row.total - row.paid), 0);
  const refundsTotal = refundRows.filter(row => refundIds.has(row.bookingId)).reduce((sum, row) => sum + row.amount, 0);
  const firstByCustomer = new Map(firstRows.filter(row => row.customerId).map(row => [row.customerId, row.firstAt]));
  const customerIds = [...new Set(active.map(row => row.customerId).filter((id): id is string => Boolean(id)))];
  const newCustomers = customerIds.filter(id => {
    const first = firstByCustomer.get(id);
    return first && first >= window.from && first < window.to;
  }).length;
  const returningCustomers = customerIds.filter(id => {
    const first = firstByCustomer.get(id);
    return first && first < window.from;
  }).length;
  const bounds: Span = { start: window.from.getTime(), end: window.to.getTime() };
  const utilizationRows = selected.filter(item => item.status !== "DISABLED").map(item => {
    const open: Span[] = [];
    let day = Temporal.PlainDate.from(window.fromDate);
    const last = Temporal.PlainDate.from(window.toDate);
    while (Temporal.PlainDate.compare(day, last) <= 0) {
      open.push(...effectiveWindows(hourRows, item.id, day, branch.timezone).map(asSpan));
      day = day.add({ days: 1 });
    }
    const clipped = mergedSpans(open.map(span => ({ start: Math.max(span.start, bounds.start),
      end: Math.min(span.end, bounds.end) })));
    const cuts = blockRows.filter(block => block.resourceId === item.id).map(block =>
      ({ start: block.startAt.getTime(), end: block.endAt.getTime() }));
    const usable = item.status === "MAINTENANCE" ? [] : subtractSpans(clipped, cuts);
    const occupied = rows.filter(row => row.resourceId === item.id && occupiedStatuses.has(row.status))
      .map(row => ({ start: row.startAt.getTime(), end: row.endAt.getTime() }));
    return { ...item, ...utilization(usable, occupied) };
  });
  const availableMinutes = utilizationRows.reduce((sum, item) => sum + item.availableMinutes, 0);
  const bookedMinutes = utilizationRows.reduce((sum, item) => sum + item.bookedMinutes, 0);
  const seriesMap = new Map<string, { bookings: number; bookingValue: number; collected: number }>();
  const heatmap = Array.from({ length: 12 }, () => Array<number>(7).fill(0));
  const weekdays = Array<number>(7).fill(0);
  const periods = Array<number>(12).fill(0);
  for (const row of periodRows) {
    const local = localParts(row.startAt, branch.timezone);
    const key = local.toPlainDate().toString();
    const point = seriesMap.get(key) ?? { bookings: 0, bookingValue: 0, collected: 0 };
    point.bookings += 1;
    point.collected += row.paid;
    if (countedStatuses.has(row.status)) point.bookingValue += row.total;
    seriesMap.set(key, point);
    if (countedStatuses.has(row.status)) {
      const weekday = local.dayOfWeek - 1, period = Math.floor(local.hour / 2);
      heatmap[period][weekday] += 1; weekdays[weekday] += 1; periods[period] += 1;
    }
  }
  const series: { date: string; bookings: number; bookingValue: number; collected: number }[] = [];
  let day = Temporal.PlainDate.from(window.fromDate);
  const last = Temporal.PlainDate.from(window.toDate);
  while (Temporal.PlainDate.compare(day, last) <= 0) {
    const date = day.toString();
    series.push({ date, ...(seriesMap.get(date) ?? { bookings: 0, bookingValue: 0, collected: 0 }) });
    day = day.add({ days: 1 });
  }
  const resourceRevenue = selected.map(item => ({
    id: item.id, name: item.name, sport: item.sportName,
    bookingValue: active.filter(row => row.resourceId === item.id).reduce((sum, row) => sum + row.total, 0),
    collected: periodRows.filter(row => row.resourceId === item.id).reduce((sum, row) => sum + row.paid, 0),
  })).sort((a, b) => b.bookingValue - a.bookingValue);
  const topIds = [...new Map(active.filter(row => row.customerId).map(row => [row.customerId!, true])).keys()];
  const names = topIds.length ? await db.select({ id: customers.id, name: customers.name }).from(customers)
    .where(and(eq(customers.organizationId, organizationId), sql`${customers.id} in (${sql.join(topIds.map(id => sql`${id}::uuid`), sql`, `)})`)) : [];
  const nameById = new Map(names.map(item => [item.id, item.name]));
  const customerSpending = customerIds.map(id => {
    const bookingsForCustomer = active.filter(row => row.customerId === id);
    return { id, name: nameById.get(id) ?? "Customer", bookings: bookingsForCustomer.length,
      bookingValue: bookingsForCustomer.reduce((sum, row) => sum + row.total, 0) };
  }).sort((a, b) => b.bookingValue - a.bookingValue).slice(0, 10);
  const peakDayIndex = weekdays.some(Boolean) ? weekdays.indexOf(Math.max(...weekdays)) : -1;
  const peakPeriodIndex = periods.some(Boolean) ? periods.indexOf(Math.max(...periods)) : -1;
  return { ...window, timezone: branch.timezone, resources: selected, availableResources: allResources,
    series, heatmap, resourceRevenue,
    utilization: { ...utilizationRows.length ? { resources: utilizationRows } : { resources: [] },
      availableMinutes, bookedMinutes, percent: pct(bookedMinutes, availableMinutes) },
    customers: { new: newCustomers, returning: returningCustomers, returningRate: pct(returningCustomers, newCustomers + returningCustomers),
      top: customerSpending },
    peak: { day: peakDayIndex < 0 ? null : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][peakDayIndex],
      period: peakPeriodIndex < 0 ? null : `${String(peakPeriodIndex * 2).padStart(2, "0")}:00–${String((peakPeriodIndex + 1) * 2).padStart(2, "0")}:00` },
    totals: { bookings: periodRows.length, completed: periodRows.filter(row => row.status === "COMPLETED").length,
      cancelled: cancelled.length, noShows: noShows.length, bookingValue, collected, outstanding, refunds: refundsTotal,
      cancellationValue: cancelled.reduce((sum, row) => sum + row.total, 0),
      cancellationRate: pct(cancelled.length, periodRows.length),
      noShowRate: pct(noShows.length, active.length) } };
}
