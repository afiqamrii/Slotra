import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { calendarHref, calendarTimeRange, dayBounds, hourlyStartSlots, normalizeCalendarQuery, overlapsDay, timelineRange, timelineTicks } from "./calendar-presentation";

describe("calendar presentation", () => {
  it("discards malformed URL values without accepting impossible dates", () => {
    expect(normalizeCalendarQuery({ date: "2026-02-30", view: "bad", branchId: ["bad"] })).toEqual({ date: undefined, branchId: undefined, view: "day" });
    expect(normalizeCalendarQuery({ date: "2026-11-16", view: "agenda" })).toMatchObject({ date: "2026-11-16", view: "agenda" });
  });
  it("retains date, view, and branch on navigation", () => {
    expect(calendarHref("2026-11-16", "agenda", "branch-2")).toBe("/calendar?date=2026-11-16&view=agenda&branchId=branch-2");
  });
  it("includes overnight entries on both days and excludes exact ending boundaries", () => {
    const start = new Date("2026-11-16T15:00:00Z");
    const end = new Date("2026-11-16T17:00:00Z");
    expect(overlapsDay(start, end, Temporal.PlainDate.from("2026-11-16"), "Asia/Kuala_Lumpur")).toBe(true);
    expect(overlapsDay(start, end, Temporal.PlainDate.from("2026-11-17"), "Asia/Kuala_Lumpur")).toBe(true);
    expect(overlapsDay(start, new Date("2026-11-16T16:00:00Z"), Temporal.PlainDate.from("2026-11-17"), "Asia/Kuala_Lumpur")).toBe(false);
  });
  it("gives a repeated-hour booking its actual positive width on a 25-hour day", () => {
    const { from, to } = dayBounds(Temporal.PlainDate.from("2026-11-01"), "America/New_York");
    expect(to.getTime() - from.getTime()).toBe(25 * 3600000);
    expect(timelineRange(new Date("2026-11-01T05:30:00Z"), new Date("2026-11-01T06:30:00Z"), from, to)).toEqual({ left: "6%", width: "4%" });
    const ticks = timelineTicks(from, to, "America/New_York");
    expect(ticks).toHaveLength(25);
    expect(ticks.filter(tick => tick.label.startsWith("01:00")).map(tick => tick.label)).toEqual(["01:00 -04:00", "01:00 -05:00"]);
  });
  it("skips the nonexistent hour in a 23-hour day and clamps cross-day entries", () => {
    const { from, to } = dayBounds(Temporal.PlainDate.from("2026-03-08"), "America/New_York");
    const ticks = timelineTicks(from, to, "America/New_York");
    expect(ticks).toHaveLength(23);
    expect(ticks.some(tick => tick.label === "02:00")).toBe(false);
    expect(timelineRange(new Date(from.getTime() - 3600000), new Date(to.getTime() + 3600000), from, to)).toEqual({ left: "0%", width: "100%" });
  });
  it("labels both offsets when a session crosses a daylight-saving change", () => {
    const label = calendarTimeRange(new Date("2026-11-01T05:30:00Z"), new Date("2026-11-01T06:30:00Z"), "America/New_York");
    expect(label).toContain("GMT-4");
    expect(label).toContain("GMT-5");
  });
  it("keeps non-hour-aligned opening slots in the timeline", () => {
    const slots = ["2026-11-16T01:30:00Z", "2026-11-16T01:45:00Z", "2026-11-16T02:00:00Z"].map(value => ({ startAt: new Date(value) }));
    expect(hourlyStartSlots(slots, new Date("2026-11-15T16:00:00Z"))).toEqual([slots[0], slots[2]]);
  });
});
