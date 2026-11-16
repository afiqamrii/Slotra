import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export type CalendarView = "day" | "week" | "agenda";

export function normalizeCalendarQuery(params: Record<string, unknown>) {
  const date = z.iso.date().safeParse(params.date);
  const branch = z.uuid().safeParse(params.branchId);
  const view = params.view === "week" || params.view === "agenda" ? params.view : "day";
  return { date: date.success ? date.data : undefined, branchId: branch.success ? branch.data : undefined, view } as {
    date?: string; branchId?: string; view: CalendarView;
  };
}

export function calendarHref(date: string, view: CalendarView, branchId?: string) {
  return "/calendar?" + new URLSearchParams({ date, view, ...(branchId ? { branchId } : {}) });
}

export function dayBounds(date: Temporal.PlainDate, timezone: string) {
  const from = date.toZonedDateTime(timezone);
  const to = date.add({ days: 1 }).toZonedDateTime(timezone);
  return { from: new Date(from.epochMilliseconds), to: new Date(to.epochMilliseconds) };
}

/** Half-open overlap includes overnight entries on every day they occupy. */
export function overlapsDay(start: Date, end: Date, date: Temporal.PlainDate, timezone: string) {
  const { from, to } = dayBounds(date, timezone);
  return start < to && end > from;
}

export function timelinePercent(value: Date, from: Date, to: Date) {
  return Math.max(0, Math.min(100, (value.getTime() - from.getTime()) / (to.getTime() - from.getTime()) * 100));
}

export function timelineRange(start: Date, end: Date, from: Date, to: Date) {
  const left = timelinePercent(start, from, to);
  const right = timelinePercent(end, from, to);
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
}

/** UTC increments preserve both repeated hours and skip nonexistent DST hours. */
export function timelineTicks(from: Date, to: Date, timezone: string) {
  const ticks: { iso: string; label: string; position: number }[] = [];
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let ms = from.getTime(); ms < to.getTime(); ms += 3_600_000) {
    const instant = new Date(ms);
    ticks.push({ iso: instant.toISOString(), label: format.format(instant), position: timelinePercent(instant, from, to) });
  }
  const counts = new Map<string, number>();
  for (const tick of ticks) counts.set(tick.label, (counts.get(tick.label) ?? 0) + 1);
  return ticks.map(tick => ({ ...tick, label: (counts.get(tick.label) ?? 0) > 1 ?
    `${tick.label} ${Temporal.Instant.from(tick.iso).toZonedDateTimeISO(timezone).offset}` : tick.label }));
}

export function calendarTimeRange(start: Date, end: Date, timezone: string) {
  const startZone = Temporal.Instant.from(start.toISOString()).toZonedDateTimeISO(timezone);
  const endZone = Temporal.Instant.from(end.toISOString()).toZonedDateTimeISO(timezone);
  const format = new Intl.DateTimeFormat("en-MY", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
    ...(startZone.offset !== endZone.offset ? { timeZoneName: "shortOffset" as const } : {}) });
  return `${format.format(start)} – ${format.format(end)}`;
}

export function hourlyStartSlots<T extends { startAt: Date }>(slots: T[], from: Date) {
  const firstByHour = new Map<number, T>();
  for (const slot of slots) {
    const hour = Math.floor((slot.startAt.getTime() - from.getTime()) / 3_600_000);
    if (!firstByHour.has(hour)) firstByHour.set(hour, slot);
  }
  return [...firstByHour.values()];
}

export function calendarStatus(status: string) {
  if (status === "AWAITING_PAYMENT") return "held";
  if (status === "CHECKED_IN" || status === "IN_PROGRESS") return "active";
  if (status === "COMPLETED" || status === "NO_SHOW" || status === "PENDING") return "muted";
  return "booked";
}
