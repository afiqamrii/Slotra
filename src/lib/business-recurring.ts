import { Temporal } from "@js-temporal/polyfill";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { bookings, branches, customers, recurringSeries, resources } from "@/db/schema";
import { BookingError, evaluateAvailability, loadAvailabilitySnapshot, type BookingDatabase } from "@/lib/booking-availability";
import { localDateAt } from "@/lib/booking-time";
import { localWallTime } from "@/lib/booking-local-input";
import { createBooking, rescheduleBooking } from "@/lib/booking-service";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

const weeklyInput = z.object({
  branchId: z.uuid(), resourceId: z.uuid(), customerId: z.uuid().nullable(),
  startDate: z.iso.date(), endDate: z.iso.date(),
  weekday: z.number().int().min(0).max(6),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(30).max(480),
});
type WeeklyInput = z.infer<typeof weeklyInput>;

async function context(database: BookingDatabase, actorId: string, organizationId: string, input: WeeklyInput, now: Date) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:create"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  await requireOrganizationFeature(database, organizationId, "RECURRING_BOOKINGS");
  const [branch] = await database.select().from(branches).where(and(
    eq(branches.organizationId, organizationId), eq(branches.id, input.branchId))).limit(1);
  const [space] = await database.select().from(resources).where(and(
    eq(resources.organizationId, organizationId), eq(resources.branchId, input.branchId),
    eq(resources.id, input.resourceId))).limit(1);
  if (!branch?.isActive || !space) throw new BookingError("RESOURCE_NOT_FOUND", "Choose an active venue space");
  if (input.customerId) {
    const [customer] = await database.select({ id: customers.id }).from(customers).where(and(
      eq(customers.organizationId, organizationId), eq(customers.id, input.customerId))).limit(1);
    if (!customer) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer does not belong to this venue");
  }
  const start = Temporal.PlainDate.from(input.startDate);
  const end = Temporal.PlainDate.from(input.endDate);
  const today = localDateAt(now, branch.timezone);
  if (Temporal.PlainDate.compare(start, today) < 0 ||
    Temporal.PlainDate.compare(end, start) < 0 ||
    Temporal.PlainDate.compare(end, start.add({ days: 182 })) > 0)
    throw new BookingError("INVALID_DATE", "Choose a start date and an end date within six months");
  const dates: string[] = [];
  for (let date = start; Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 }))
    if (date.dayOfWeek % 7 === input.weekday) dates.push(date.toString());
  if (!dates.length || dates.length > 27) throw new BookingError("INVALID_SERIES", "Choose a weekly series with 1–27 bookings");
  return { branch, dates };
}

export async function previewRecurringBookings(database: BookingDatabase, actorId: string,
  organizationId: string, raw: unknown, now = new Date()) {
  const input = weeklyInput.parse(raw);
  const { branch, dates } = await context(database, actorId, organizationId, input, now);
  const slots = dates.map(date => {
    const startAt = localWallTime(date, input.localTime, branch.timezone);
    return { date, startAt, endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000) };
  });
  const snapshot = await loadAvailabilitySnapshot(database, organizationId, input.branchId, [input.resourceId],
    new Date(slots[0].startAt.getTime() - 2 * 86_400_000),
    new Date(slots.at(-1)!.endAt.getTime() + 2 * 86_400_000));
  const occurrences = slots.map(slot => ({
    ...slot, ...evaluateAvailability(snapshot, input.resourceId, slot.startAt, slot.endAt, now),
  }));
  return { occurrences, available: occurrences.filter(item => item.available).length,
    unavailable: occurrences.filter(item => !item.available).length };
}

export async function createRecurringBookings(database: BookingDatabase, actorId: string,
  organizationId: string, raw: unknown, skipConflicts: boolean, now = new Date()) {
  const input = weeklyInput.parse(raw);
  const preview = await previewRecurringBookings(database, actorId, organizationId, input, now);
  if (preview.unavailable && !skipConflicts)
    throw new BookingError("SERIES_CONFLICT", `${preview.unavailable} weekly times are unavailable. Review them or choose book available times.`);
  const [series] = await database.insert(recurringSeries).values({
    organizationId, branchId: input.branchId, resourceId: input.resourceId,
    customerId: input.customerId, weekday: input.weekday, localTime: input.localTime,
    durationMinutes: input.durationMinutes, startDate: input.startDate, endDate: input.endDate,
    createdByUserId: actorId,
  }).returning();
  const created: { id: string; date: string }[] = [];
  const conflicts: { date: string; reason: string }[] = [];
  for (const occurrence of preview.occurrences) {
    if (!occurrence.available) {
      conflicts.push({ date: occurrence.date, reason: occurrence.reason ?? "Unavailable" });
      continue;
    }
    try {
      const booking = await createBooking(database, actorId, organizationId, {
        branchId: input.branchId, resourceId: input.resourceId, customerId: input.customerId,
        startAt: occurrence.startAt, endAt: occurrence.endAt, source: "STAFF",
        recurringSeriesId: series.id,
      }, now);
      created.push({ id: booking.id, date: occurrence.date });
    } catch (error) {
      if (!(error instanceof BookingError)) throw error;
      conflicts.push({ date: occurrence.date, reason: error.message });
    }
  }
  if (!created.length) await database.update(recurringSeries).set({ status: "CANCELLED", updatedAt: now })
    .where(and(eq(recurringSeries.organizationId, organizationId), eq(recurringSeries.id, series.id)));
  return { seriesId: series.id, created, conflicts };
}

export async function rescheduleFutureInSeries(database: BookingDatabase, actorId: string,
  organizationId: string, seriesId: string, fromBookingId: string,
  raw: unknown, now = new Date()) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:update"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  await requireOrganizationFeature(database, organizationId, "RECURRING_BOOKINGS");
  const input = z.object({ resourceId: z.uuid(), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    durationMinutes: z.number().int().min(30).max(480) }).parse(raw);
  const [series] = await database.select().from(recurringSeries).where(and(
    eq(recurringSeries.organizationId, organizationId), eq(recurringSeries.id, z.uuid().parse(seriesId)))).limit(1);
  const [from] = await database.select().from(bookings).where(and(
    eq(bookings.organizationId, organizationId), eq(bookings.id, z.uuid().parse(fromBookingId)),
    eq(bookings.recurringSeriesId, seriesId))).limit(1);
  if (!series || !from) throw new BookingError("SERIES_NOT_FOUND", "Recurring series not found");
  const [branch] = await database.select({ timezone: branches.timezone }).from(branches).where(and(
    eq(branches.organizationId, organizationId), eq(branches.id, series.branchId))).limit(1);
  if (!branch) throw new BookingError("BRANCH_NOT_FOUND", "Venue not found");
  const future = await database.select().from(bookings).where(and(
    eq(bookings.organizationId, organizationId), eq(bookings.recurringSeriesId, seriesId)));
  const changed: string[] = [], conflicts: { bookingId: string; reason: string }[] = [];
  for (const booking of future.filter(item => item.startAt >= from.startAt).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const date = localDateAt(booking.startAt, branch.timezone).toString();
    const startAt = localWallTime(date, input.localTime, branch.timezone);
    try {
      await rescheduleBooking(database, actorId, organizationId, booking.id, {
        resourceId: input.resourceId, startAt, endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000),
      }, now);
      changed.push(booking.id);
    } catch (error) {
      if (!(error instanceof BookingError)) throw error;
      conflicts.push({ bookingId: booking.id, reason: error.message });
    }
  }
  return { changed, conflicts };
}
