import { describe, expect, it } from "vitest";
import { bookingListHref, bookingViewHref } from "./booking-list-navigation";

describe("booking list navigation", () => {
  it("retains branch and search but removes conflicting date/status when changing views", () => {
    const url = new URL(bookingViewHref({ branchId: "branch-2", q: "A & B", date: "2026-11-16", status: "CANCELLED", page: 4 }, "upcoming"), "https://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ branchId: "branch-2", q: "A & B", view: "upcoming" });
  });
  it("can remove one filter and restart pagination without losing other filters", () => {
    expect(bookingListHref({ view: "all", branchId: "branch-2", q: "Alice", page: 3 }, { q: undefined, page: undefined }))
      .toBe("/bookings?view=all&branchId=branch-2");
  });
});
