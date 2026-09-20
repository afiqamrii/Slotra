import { describe, expect, it } from "vitest";
import { planFeatures, planHasFeature, planLimit } from "@/lib/plan-entitlements";

describe("planned payment entitlements", () => {
  it("keeps online payments, deposits, and online refunds off Starter and on from Professional upward", () => {
    expect(planFeatures.STARTER).toMatchObject({ ONLINE_PAYMENTS: false, DEPOSITS: false, ONLINE_REFUNDS: false,
      BASIC_REPORTS: true, CSV_EXPORT: true, PUBLIC_BOOKING: true, MANUAL_PAYMENTS: true });
    for (const plan of ["PROFESSIONAL", "BUSINESS", "PRO"] as const) {
      expect(planHasFeature(plan, "ONLINE_PAYMENTS")).toBe(true);
      expect(planHasFeature(plan, "DEPOSITS")).toBe(true);
      expect(planHasFeature(plan, "ONLINE_REFUNDS")).toBe(true);
    }
  });
  it("centrally defines Starter limits and keeps premium analytics locked", () => {
    expect(["MONTHLY_BOOKINGS", "BRANCHES", "RESOURCES", "OWNER_SEATS", "STAFF_SEATS"].map(limit =>
      planLimit("STARTER", limit as Parameters<typeof planLimit>[1]))).toEqual([200, 1, 10, 1, 1]);
    expect(planHasFeature("STARTER", "ADVANCED_ANALYTICS")).toBe(false);
  });
});
