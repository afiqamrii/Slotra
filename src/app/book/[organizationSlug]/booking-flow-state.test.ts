import { describe, expect, it } from "vitest";
import { availabilityLabel, filterBookingTimes, resolvePaymentChoice, resolveVenueSelection, selectablePayments } from "./booking-flow-state";
import type { PublicGrid, PublicVenue } from "@/lib/public-booking";

const options: PublicVenue["paymentOptions"] = [
  { value: "ONLINE", label: "Online", description: "Test payment" },
  { value: "PAY_AT_VENUE", label: "Pay at venue", description: "Pay later" },
];
function row(startAt: string, available = true): PublicGrid["times"][number] {
  return { startAt, endAt: new Date(new Date(startAt).getTime() + 3600000).toISOString(),
    options: [{ resourceId: "space", available, reason: available ? null : "CONFLICT", priceMinor: 100, dueNowMinor: 100 }] };
}

describe("guest booking display filters", () => {
  it("filters using the venue timezone, with exact noon and evening boundaries", () => {
    const rows = [row("2026-11-16T03:00:00Z"), row("2026-11-16T04:00:00Z"), row("2026-11-16T10:00:00Z")];
    expect(filterBookingTimes(rows, "Asia/Kuala_Lumpur", "morning", false)).toEqual([rows[0]]);
    expect(filterBookingTimes(rows, "Asia/Kuala_Lumpur", "afternoon", false)).toEqual([rows[1]]);
    expect(filterBookingTimes(rows, "Asia/Kuala_Lumpur", "evening", false)).toEqual([rows[2]]);
  });
  it("keeps both distinct instants during a repeated local hour", () => {
    const rows = [row("2026-11-01T05:30:00Z"), row("2026-11-01T06:30:00Z")];
    expect(filterBookingTimes(rows, "America/New_York", "morning", true)).toEqual(rows);
  });
  it("hides full rows only when requested, retaining waitlist browsing otherwise", () => {
    const rows = [row("2026-11-16T03:00:00Z"), row("2026-11-16T04:00:00Z", false)];
    expect(filterBookingTimes(rows, "Asia/Kuala_Lumpur", "all", true)).toEqual([rows[0]]);
    expect(filterBookingTimes(rows, "Asia/Kuala_Lumpur", "all", false)).toEqual(rows);
  });
});

describe("guest payment choice", () => {
  it("falls back to pay at venue when a selected sandbox deposit falls below the gateway minimum", () => {
    const eligible = selectablePayments(options, "TOYYIBPAY_SANDBOX", 99);
    expect(eligible.map(option => option.value)).toEqual(["PAY_AT_VENUE"]);
    expect(resolvePaymentChoice(eligible, "ONLINE")).toBe("PAY_AT_VENUE");
    expect(selectablePayments(options, "TOYYIBPAY_SANDBOX", 100)).toEqual(options);
  });
  it("does not invent a payment option when none are available", () => {
    expect(resolvePaymentChoice(selectablePayments(options.slice(0, 1), "TOYYIBPAY_SANDBOX", 0), "ONLINE")).toBeUndefined();
  });
});

describe("3D booking selection", () => {
  const spaces = [{ id: "space", name: "Court 1", label: "Court" }];
  it("uses the selected exact server row even when that time is full", () => {
    const rows = [row("2026-11-16T03:00:00Z"), row("2026-11-16T04:00:00Z", false)];
    const selected = resolveVenueSelection(rows, spaces, rows[1].startAt, "space");
    expect(selected.row).toBe(rows[1]);
    expect(selected.option?.available).toBe(false);
    expect(availabilityLabel(selected.option)).toBe("Full");
  });
  it("drops a time and resource removed by date, page, or display filters", () => {
    const rows = [row("2026-11-17T03:00:00Z")];
    const selected = resolveVenueSelection(rows, spaces, "2026-11-16T03:00:00Z", "previous-page-court");
    expect(selected.row).toBe(rows[0]);
    expect(selected.space?.id).toBe("space");
    expect(resolveVenueSelection([], [], rows[0].startAt, "space")).toEqual({
      row: undefined, space: undefined, option: undefined,
    });
  });
  it("preserves the selected occurrence of a repeated local time", () => {
    const rows = [row("2026-11-01T05:30:00Z"), row("2026-11-01T06:30:00Z")];
    expect(resolveVenueSelection(rows, spaces, rows[1].startAt, "space").row).toBe(rows[1]);
  });
  it("keeps server prices and missing availability tied to the displayed time", () => {
    const early = row("2026-11-16T03:00:00Z");
    const late = row("2026-11-16T04:00:00Z");
    late.options[0].priceMinor = 2500;
    expect(resolveVenueSelection([early, late], spaces, late.startAt).option?.priceMinor).toBe(2500);
    expect(availabilityLabel(undefined)).toBe("Unavailable");
    expect(availabilityLabel({ ...late.options[0], available: false, reason: "BLOCKED" })).toBe("Blocked");
  });
});
