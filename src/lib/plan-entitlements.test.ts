import { describe, expect, it } from "vitest";
import { planFeatures, planHasFeature } from "@/lib/plan-entitlements";

describe("planned payment entitlements", () => {
  it("keeps online payments, deposits, and online refunds off Starter and on from Professional upward", () => {
    expect(planFeatures.STARTER).toEqual({ ONLINE_PAYMENTS: false, DEPOSITS: false, ONLINE_REFUNDS: false });
    for (const plan of ["PROFESSIONAL", "BUSINESS", "PRO"] as const) {
      expect(planHasFeature(plan, "ONLINE_PAYMENTS")).toBe(true);
      expect(planHasFeature(plan, "DEPOSITS")).toBe(true);
      expect(planHasFeature(plan, "ONLINE_REFUNDS")).toBe(true);
    }
  });
});