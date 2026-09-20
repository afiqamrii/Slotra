import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { calendarDatedHref } from "@/lib/booking-calendar-links";

describe("calendar date links", () => {
  it("serializes PlainDate explicitly for booking and block links", () => {
    const day = Temporal.PlainDate.from("2026-09-20");
    expect(calendarDatedHref("/calendar/block", day)).toBe("/calendar/block?date=2026-09-20");
    expect(calendarDatedHref("/bookings/new", day)).toBe("/bookings/new?date=2026-09-20");
  });
});
