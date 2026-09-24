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
  it("unlocks Business growth features and caps resources and staff", () => {
    const features = ["DYNAMIC_PRICING", "RECURRING_BOOKINGS", "MEMBERSHIPS", "PACKAGES",
      "CREDITS", "PROMOTIONS", "WAITLIST", "QR_CHECK_IN", "WHATSAPP", "AUTOMATIONS",
      "CUSTOMER_SEGMENTATION", "RETENTION_TOOLS", "ADVANCED_BOOKING_RULES"] as const;
    for (const feature of features) {
      expect(planHasFeature("STARTER", feature)).toBe(false);
      expect(planHasFeature("PROFESSIONAL", feature)).toBe(false);
      expect(planHasFeature("BUSINESS", feature)).toBe(true);
      expect(planHasFeature("PRO", feature)).toBe(true);
    }
    expect(planLimit("BUSINESS", "MONTHLY_BOOKINGS")).toBe(3000);
    expect(planLimit("BUSINESS", "BRANCHES")).toBe(1);
    expect(planLimit("BUSINESS", "RESOURCES")).toBe(50);
    expect(planLimit("BUSINESS", "STAFF_SEATS")).toBe(5);
  });
});
