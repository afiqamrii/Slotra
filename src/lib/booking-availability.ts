import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { bookings, branches, businessBookingPolicies, operatingHours, organizations, resourceBlocks, resources } from "@/db/schema";
import { authorizedMembership } from "@/lib/organization-service";
import { advanceAllowed, containsRange, effectiveWindows, localDateAt, minuteDuration, queryBounds } from "@/lib/booking-time";
import { memberAdvanceBenefits, memberAdvanceForSpace } from "@/lib/business-benefits";
import { planHasFeature, type StandardPlan } from "@/lib/plan-entitlements";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BookingDatabase = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export const blockingStatuses = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] as const;
export class BookingError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "BookingError"; }
}
const instant = z.union([z.date(), z.iso.datetime({ offset: true }).transform(value => new Date(value))])
  .refine(value => !Number.isNaN(value.getTime()), "Choose a valid time");
export const rangeInput = z.object({ startAt: instant, endAt: instant })
  .refine(value => value.endAt > value.startAt, "End must be after start");
export const availabilityInput = rangeInput.extend({
  branchId: z.uuid(), resourceId: z.uuid(),
});
const dateInput = z.iso.date();
export type AvailabilitySnapshot = Awaited<ReturnType<typeof loadAvailabilitySnapshot>>;

export async function loadAvailabilitySnapshot(database: BookingDatabase, organizationId: string, branchId: string, resourceIds: string[], from: Date, to: Date) {
  if (!resourceIds.length || resourceIds.length > 100 || new Set(resourceIds).size !== resourceIds.length ||
    !resourceIds.every(id => z.uuid().safeParse(id).success)) throw new BookingError("INVALID_RESOURCES", "Choose 1–100 unique spaces");
  const [venue, spaces, hours, blocks, reserved, policies] = await Promise.all([
    database.select({ branch: branches, planCode: organizations.planCode }).from(branches)
      .innerJoin(organizations, eq(organizations.id, branches.organizationId))
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, organizationId))).limit(1),
    database.select().from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.branchId, branchId), inArray(resources.id, resourceIds))),
    database.select().from(operatingHours).where(and(eq(operatingHours.organizationId, organizationId), eq(operatingHours.branchId, branchId), or(isNull(operatingHours.resourceId), inArray(operatingHours.resourceId, resourceIds)))),
    database.select().from(resourceBlocks).where(and(eq(resourceBlocks.organizationId, organizationId), eq(resourceBlocks.branchId, branchId), inArray(resourceBlocks.resourceId, resourceIds), lt(resourceBlocks.startAt, to), gt(resourceBlocks.endAt, from))),
    database.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.branchId, branchId), inArray(bookings.resourceId, resourceIds), inArray(bookings.status, [...blockingStatuses]), lt(bookings.startAt, to), gt(bookings.endAt, from))),
    database.select().from(businessBookingPolicies).where(eq(businessBookingPolicies.organizationId, organizationId)).limit(1),
  ]);
  if (!venue[0] || !venue[0].branch.isActive) throw new BookingError("BRANCH_INACTIVE", "This branch is not active");
  if (spaces.length !== resourceIds.length) throw new BookingError("RESOURCE_NOT_FOUND", "A selected space does not belong to this branch");
  return { branch: venue[0].branch, spaces, hours, blocks, reserved,
    policy: planHasFeature(venue[0].planCode as StandardPlan, "ADVANCED_BOOKING_RULES") ?
      policies[0] ?? null : null };
}

export function evaluateAvailability(snapshot: AvailabilitySnapshot, resourceId: string, startAt: Date, endAt: Date,
  now: Date, excludingBookingId?: string, membershipAdvanceDays?: number | null) {
  const space = snapshot.spaces.find(item => item.id === resourceId);
  if (!space) return { available: false as const, reason: "RESOURCE_NOT_FOUND" };
  if (space.status !== "ACTIVE") return { available: false as const, reason: "RESOURCE_INACTIVE" };
  const duration = minuteDuration(startAt, endAt);
  const maxDuration = Math.min(space.maximumDurationMinutes ?? Infinity, snapshot.policy?.maximumDurationMinutes ?? Infinity);
  if (!duration || duration < space.minimumDurationMinutes || duration > maxDuration ||
    duration % space.bookingIntervalMinutes !== 0) return { available: false as const, reason: "INVALID_DURATION" };
  const minNotice = Math.max(space.minimumAdvanceMinutes, snapshot.policy?.minimumNoticeMinutes ?? 0);
  const memberWindow = membershipAdvanceDays === null || membershipAdvanceDays === undefined ?
    space.maximumAdvanceDays ?? Infinity : Math.max(space.maximumAdvanceDays ?? Infinity, membershipAdvanceDays);
  const maxAdvance = Math.min(memberWindow, snapshot.policy?.maximumAdvanceDays ?? Infinity);
  if (!advanceAllowed(startAt, now, minNotice, Number.isFinite(maxAdvance) ? maxAdvance : null)) return { available: false as const, reason: "ADVANCE_WINDOW" };
  const localDate = localDateAt(startAt, snapshot.branch.timezone);
  const window = containsRange(effectiveWindows(snapshot.hours, resourceId, localDate, snapshot.branch.timezone), startAt, endAt);
  if (!window) return { available: false as const, reason: "CLOSED" };
  if ((startAt.getTime() - window.startAt.getTime()) % (space.bookingIntervalMinutes * 60_000) !== 0) return { available: false as const, reason: "INTERVAL" };
  if (snapshot.blocks.some(block => block.resourceId === resourceId && startAt < block.endAt && endAt > block.startAt)) return { available: false as const, reason: "BLOCKED" };
  const bufferMs = (snapshot.policy?.bookingBufferMinutes ?? 0) * 60_000;
  if (snapshot.reserved.some(booking => booking.id !== excludingBookingId && booking.resourceId === resourceId && (booking.status !== "AWAITING_PAYMENT" || (booking.holdExpiresAt && booking.holdExpiresAt > now)) &&
    startAt.getTime() < booking.endAt.getTime() + bufferMs && endAt.getTime() > booking.startAt.getTime() - bufferMs))
    return { available: false as const, reason: "CONFLICT" };
  return { available: true as const, reason: null };
}

export async function isResourceAvailable(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date(), excludingBookingId?: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:view")) throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  const input = availabilityInput.parse(raw);
  const date = localDateAt(input.startAt, "UTC"); // broad UTC bounds also cover local dates at either side
  const snapshot = await loadAvailabilitySnapshot(database, organizationId, input.branchId, [input.resourceId],
    new Date(date.subtract({ days: 2 }).toString() + "T00:00:00Z"), new Date(date.add({ days: 3 }).toString() + "T00:00:00Z"));
  return evaluateAvailability(snapshot, input.resourceId, input.startAt, input.endAt, now, excludingBookingId);
}

export async function availableSlotsForResources(database: BookingDatabase, actorId: string, organizationId: string,
  raw: { branchId: string; resourceIds: string[]; localDate: string; durationMinutes?: number; customerId?: string }, now = new Date()) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:view")) throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  const input = z.object({ branchId: z.uuid(), resourceIds: z.array(z.uuid()).min(1).max(100), localDate: dateInput,
    durationMinutes: z.number().int().positive().max(1440).optional(), customerId: z.uuid().optional() }).parse(raw);
  // The branch lookup establishes its timezone before the one-date batched snapshot.
  const [branch] = await database.select({ timezone: branches.timezone }).from(branches).where(and(eq(branches.organizationId, organizationId), eq(branches.id, input.branchId))).limit(1);
  if (!branch) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
  const date = Temporal.PlainDate.from(input.localDate);
  const bounds = queryBounds(date, branch.timezone);
  const snapshot = await loadAvailabilitySnapshot(database, organizationId, input.branchId, input.resourceIds, bounds.from, bounds.to);
  const localMidday = Temporal.ZonedDateTime.from({ timeZone: branch.timezone,
    year: date.year, month: date.month, day: date.day, hour: 12 });
  const advanceBenefits = await memberAdvanceBenefits(database, organizationId, input.customerId,
    new Date(Number(localMidday.epochMilliseconds)));
  return Object.fromEntries(snapshot.spaces.map(space => {
    const advanceDays = memberAdvanceForSpace(advanceBenefits, space.sportTypeId, space.id);
    const duration = input.durationMinutes ?? space.minimumDurationMinutes;
    const windowList = effectiveWindows(snapshot.hours, space.id, date, snapshot.branch.timezone);
    const slots = new Map<string, { startAt: Date; endAt: Date }>();
    for (const window of windowList) {
      for (let start = window.startAt.getTime(); start + duration * 60_000 <= window.endAt.getTime(); start += space.bookingIntervalMinutes * 60_000) {
        const startAt = new Date(start), endAt = new Date(start + duration * 60_000);
        if (localDateAt(startAt, snapshot.branch.timezone).toString() !== input.localDate) continue;
        if (evaluateAvailability(snapshot, space.id, startAt, endAt, now, undefined, advanceDays).available)
          slots.set(startAt.toISOString(), { startAt, endAt });
      }
    }
    return [space.id, [...slots.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())];
  }));
}




