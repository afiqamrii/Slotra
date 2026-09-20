import type { Temporal } from "@js-temporal/polyfill";

export function calendarDatedHref(path: "/calendar/block" | "/bookings/new", day: Temporal.PlainDate) {
  return path + "?date=" + encodeURIComponent(day.toString());
}
