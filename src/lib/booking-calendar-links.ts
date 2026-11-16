import type { Temporal } from "@js-temporal/polyfill";

export function calendarDatedHref(path: "/calendar/block" | "/bookings/new", day: Temporal.PlainDate, branchId?: string) {
  return path + "?" + new URLSearchParams({ date: day.toString(), ...(branchId ? { branchId } : {}) });
}
