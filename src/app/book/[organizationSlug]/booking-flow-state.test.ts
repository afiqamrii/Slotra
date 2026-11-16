import { describe, expect, it } from "vitest";
import { filterBookingTimes, resolvePaymentChoice, selectablePayments } from "./booking-flow-state";
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
