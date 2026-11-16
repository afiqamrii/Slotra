import { describe, expect, it } from "vitest";
import { customerHistoryFilters, customerListFilters } from "@/lib/customer-service";

describe("customer URL filters", () => {
  it("ignores repeated and malformed parameters without losing valid filters", () => {
    expect(customerListFilters({ q: "  Jane  ", view: ["upcoming"], sort: "name", page: ["2"] }))
      .toEqual({ q: "Jane", view: "all", sort: "name", page: 1 });
    expect(customerListFilters({ page: "Infinity", q: "x".repeat(101), sort: "unknown" }))
      .toEqual({ q: "", view: "all", sort: "newest", page: 1 });
    expect(customerHistoryFilters({ page: ["2"], view: "past" })).toEqual({ page: 1, view: "past" });
  });
  it("preserves valid deep-linked history pages", () => {
    expect(customerHistoryFilters({ page: "3", view: "upcoming" })).toEqual({ page: 3, view: "upcoming" });
  });
});
