import { Temporal } from "@js-temporal/polyfill";
import type { InferSelectModel } from "drizzle-orm";
import { operatingHours } from "@/db/schema";

type Hour = InferSelectModel<typeof operatingHours>;
export type TimeWindow = { startAt: Date; endAt: Date };
const DAY_MS = 86_400_000;

export function localDateAt(instant: Date, timezone: string) {
  return Temporal.Instant.from(instant.toISOString()).toZonedDateTimeISO(timezone).toPlainDate();
}

export function localDayBounds(date: Temporal.PlainDate, timezone: string) {
  return {
    from: boundary(date, 0, timezone, false),
    to: boundary(date.add({ days: 1 }), 0, timezone, false),
  };
}

function boundary(date: Temporal.PlainDate, minute: number, timezone: string, closing: boolean) {
  const day = date.add({ days: Math.floor(minute / 1440) });
  const localMinute = minute % 1440;
  return new Date(Number(Temporal.ZonedDateTime.from({
    timeZone: timezone, year: day.year, month: day.month, day: day.day,
    hour: Math.floor(localMinute / 60), minute: localMinute % 60,
  }, { disambiguation: closing ? "later" : "compatible" }).epochMilliseconds));
}

export function windowsForDate(hours: Hour[], date: Temporal.PlainDate, timezone: string): TimeWindow[] {
  const weekday = date.dayOfWeek % 7;
  return hours.filter(hour => hour.dayOfWeek === weekday).map(hour => ({
    startAt: boundary(date, hour.startMinute, timezone, false),
    endAt: boundary(date, hour.endMinute, timezone, true),
  })).filter(window => window.endAt > window.startAt);
}

export function effectiveWindows(hours: Hour[], resourceId: string, date: Temporal.PlainDate, timezone: string) {
  const branch = hours.filter(hour => hour.resourceId === null);
  const resource = hours.filter(hour => hour.resourceId === resourceId);
  const dates = [date.subtract({ days: 1 }), date, date.add({ days: 1 })];
  const branchWindows = dates.flatMap(day => windowsForDate(branch, day, timezone));
  if (!resource.length) return branchWindows;
  const resourceWindows = dates.flatMap(day => windowsForDate(resource, day, timezone));
  return branchWindows.flatMap(venue => resourceWindows.map(space => ({
    startAt: new Date(Math.max(venue.startAt.getTime(), space.startAt.getTime())),
    endAt: new Date(Math.min(venue.endAt.getTime(), space.endAt.getTime())),
  })).filter(window => window.startAt < window.endAt));
}

export function containsRange(windows: TimeWindow[], startAt: Date, endAt: Date) {
  return windows.find(window => startAt >= window.startAt && endAt <= window.endAt);
}

export function queryBounds(date: Temporal.PlainDate, timezone: string) {
  return { from: boundary(date.subtract({ days: 1 }), 0, timezone, false),
    to: boundary(date.add({ days: 2 }), 0, timezone, true) };
}

export function advanceAllowed(startAt: Date, now: Date, minimumMinutes: number, maximumDays: number | null) {
  const difference = startAt.getTime() - now.getTime();
  return difference >= minimumMinutes * 60_000 && (maximumDays === null || difference <= maximumDays * DAY_MS);
}

export function minuteDuration(startAt: Date, endAt: Date) {
  const duration = (endAt.getTime() - startAt.getTime()) / 60_000;
  return Number.isInteger(duration) ? duration : null;
}

