import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  scope: "SELECTED",
  permissions: new Set<string>(),
  advanced: false,
  authorize: vi.fn(),
  basicReport: vi.fn(),
  basicSeries: vi.fn(),
  bookingList: vi.fn(),
  availableNow: vi.fn(),
  availableSlots: vi.fn(),
  paymentHistory: vi.fn(),
  detailActions: vi.fn(() => null),
  paymentSection: vi.fn(() => null),
  dashboardOperations: vi.fn(),
}));
const branch = { id: "branch-a", name: "Assigned branch", timezone: "Asia/Kuala_Lumpur", isActive: true };

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (path: string) => { throw new Error("redirect:" + path); },
}));
vi.mock("@/db/client", () => ({ getDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ completed: true, currency: "MYR" }] }) }) }),
}) }));
vi.mock("@/lib/authorization", () => ({
  requireOrganizationMember: async () => ({
    session: { user: { id: "user-a", name: "Afiq" } },
    organization: { organizationId: "organization-a", name: "Venue", role: "ADMIN" },
  }),
  requirePermission: async () => ({
    session: { user: { id: "user-a", name: "Afiq" } },
    organization: { organizationId: "organization-a", name: "Venue", role: "ADMIN" },
    member: { role: "ADMIN", branchScope: fixture.scope },
  }),
}));
vi.mock("@/lib/organization-service", () => ({ authorizedMembership: fixture.authorize }));
vi.mock("@/lib/branch-context", () => ({ branchContext: async () => ({
  selected: "branch-a", branches: [branch], canSwitch: false,
}) }));
vi.mock("@/lib/venue-schema", () => ({ venueSchemaReady: async () => true }));
vi.mock("@/lib/organization-entitlements", () => ({ hasOrganizationFeature: async (_db: unknown, _org: string, feature: string) =>
  ["ADVANCED_REPORTS", "ADVANCED_ANALYTICS"].includes(feature) ? fixture.advanced : true,
}));
vi.mock("@/lib/booking-management", () => ({
  bookingSetup: async () => ({ currency: "MYR", branches: [branch], spaces: [] }),
  listStaffBookings: fixture.bookingList,
  staffAvailableNow: fixture.availableNow,
  staffCalendar: async () => ({
    date: "2026-10-16", branch, branches: [branch], currency: "MYR", view: "day", rows: [], blocks: [],
    from: new Date("2026-10-15T16:00:00Z"), to: new Date("2026-10-16T16:00:00Z"),
    hasMoreBookings: false, hasMoreBlocks: false,
    spaces: [{ id: "space-a", branchId: branch.id, status: "ACTIVE", name: "Court 1", sportName: "Tennis",
      sportTypeId: "tennis", sportCode: "TENNIS", bookingIntervalMinutes: 30, minimumDurationMinutes: 60, maximumDurationMinutes: null }],
  }),
  staffBookingDetail: async () => ({
    booking: {
      id: "booking-a", branchId: branch.id, bookingReference: "BK-TEST", status: "CONFIRMED",
      startAt: new Date("2026-10-16T10:00:00Z"), endAt: new Date("2026-10-16T11:00:00Z"),
      createdAt: new Date("2026-10-15T10:00:00Z"), source: "STAFF", currency: "MYR",
      subtotal: 2500, discountAmount: 0, taxAmount: 0, totalAmount: 2500, amountPaid: 0,
      requiredNowMinor: 0, holdExpiresAt: null, notes: null,
    },
    customer: { name: "Guest", phone: "0123456789", email: "guest@example.test" },
    sportName: "Tennis", resourceName: "Court 1", branchName: branch.name, timezone: branch.timezone,
  }),
}));
vi.mock("@/lib/booking-availability", () => ({ availableSlotsForResources: fixture.availableSlots }));
vi.mock("@/lib/starter-reporting", () => ({
  basicReport: fixture.basicReport, basicReportSeries: fixture.basicSeries,
  starterPlanUsage: async () => ({ booking: { stage: "NORMAL", used: 0, included: 200 } }),
}));
vi.mock("@/lib/professional-reporting", () => ({ professionalReport: async () => ({}) }));
vi.mock("@/lib/pro-reporting", () => ({ proExecutiveReport: async () => ({}) }));
vi.mock("@/lib/dashboard-operations", () => ({ dashboardOperations: fixture.dashboardOperations }));
vi.mock("@/components/dashboard-operations", () => ({ DashboardOperations: () => "Today’s operations" }));
vi.mock("@/lib/booking-service", () => ({ allowedBookingTransitions: { CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"] } }));
vi.mock("@/lib/payment-service", () => ({ paymentHistory: fixture.paymentHistory }));
vi.mock("@/components/professional-insights", () => ({ ProfessionalInsights: () => null }));
vi.mock("@/components/professional-dashboard", () => ({ ProfessionalDashboard: () => null }));
vi.mock("@/components/pro-dashboard", () => ({ ProDashboard: () => null }));
vi.mock("@/components/booking-detail-actions", () => ({ BookingDetailActions: fixture.detailActions }));
vi.mock("@/components/booking-payment-section", () => ({ BookingPaymentSection: fixture.paymentSection }));

import DashboardPage from "@/app/(workspace)/dashboard/page";
import ReportsPage from "@/app/(workspace)/reports/page";
import CalendarPage from "@/app/(workspace)/calendar/page";
import BookingDetailPage from "@/app/(workspace)/bookings/[id]/page";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.scope = "SELECTED";
  fixture.advanced = false;
  fixture.permissions = new Set(["booking:view", "report:view_financial"]);
  fixture.authorize.mockImplementation(async (_db, _user, _org, permission, branchId) =>
    fixture.permissions.has(permission) && (fixture.scope === "ALL" || branchId === "branch-a")
      ? { role: "ADMIN", branchScope: fixture.scope }
      : null);
  fixture.availableSlots.mockResolvedValue({});
  fixture.dashboardOperations.mockImplementation(async () => fixture.permissions.has("booking:view") ? {} : null);
  fixture.paymentHistory.mockRejectedValue(new Error("Payment access denied"));
  fixture.basicReport.mockResolvedValue({ totals: { bookings: 0, bookingValue: 0, collected: 0, outstanding: 0 } });
});

describe("workspace effective permission boundaries", () => {
  it("denies organization-wide basic reports after a branch-restricted tenant downgrades", async () => {
    await expect(ReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
    expect(fixture.basicReport).not.toHaveBeenCalled();
    expect(fixture.basicSeries).not.toHaveBeenCalled();
  });

  it("keeps organization totals out of the basic dashboard for branch-restricted members", async () => {
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain("Good to see you, Afiq");
    expect(html).toContain("Today’s operations");
    expect(fixture.dashboardOperations).toHaveBeenCalledWith(expect.anything(), "user-a", "organization-a", "branch-a");
    expect(fixture.basicReport).not.toHaveBeenCalled();
    expect(fixture.bookingList).not.toHaveBeenCalled();
  });

  it("retains branch-scoped advanced reports and dashboard access", async () => {
    fixture.advanced = true;
    await expect(ReportsPage({ searchParams: Promise.resolve({}) })).resolves.toBeDefined();
    await expect(DashboardPage()).resolves.toBeDefined();
    expect(fixture.basicReport).not.toHaveBeenCalled();
  });

  it("hides calendar mutation controls for a custom ADMIN with only booking view", async () => {
    fixture.permissions = new Set(["booking:view"]);
    const html = renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve({}) }));
    const linkLabels = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(match => match[1].replace(/<[^>]*>/g, "").trim());
    expect(html).toContain("Court 1");
    expect(linkLabels.some(label => /new booking/i.test(label))).toBe(false);
    expect(linkLabels.some(label => /block space/i.test(label))).toBe(false);
    expect(html).not.toMatch(/href="\/(?:bookings\/new|calendar\/block)/);
    expect(fixture.availableSlots).not.toHaveBeenCalled();
  });

  it("shows calendar mutation links only when the effective branch grants allow them", async () => {
    fixture.permissions = new Set(["booking:view", "booking:create", "resource:manage"]);
    const html = renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve({}) }));
    const linkLabels = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(match => match[1].replace(/<[^>]*>/g, "").trim());
    expect(linkLabels.some(label => /new booking/i.test(label))).toBe(true);
    expect(linkLabels.some(label => /block space/i.test(label))).toBe(true);
    expect(fixture.availableSlots).toHaveBeenCalledWith(expect.anything(), "user-a", "organization-a",
      expect.objectContaining({ branchId: branch.id, resourceIds: ["space-a"] }));
  });

  it("opens reservation details without querying payment history or offering denied actions", async () => {
    fixture.permissions = new Set(["booking:view"]);
    const html = renderToStaticMarkup(await BookingDetailPage({ params: Promise.resolve({ id: "booking-a" }) }));
    expect(html).toContain("BK-TEST");
    expect(fixture.paymentHistory).not.toHaveBeenCalled();
    expect(fixture.paymentSection).not.toHaveBeenCalled();
    expect(fixture.detailActions).toHaveBeenCalledWith(expect.objectContaining({ allowed: [], canReschedule: false }), undefined);
  });

  it("keeps permitted payment and booking actions usable for an effective custom grant", async () => {
    fixture.permissions = new Set(["booking:view", "booking:check_in", "payment:view", "payment:record_manual"]);
    fixture.paymentHistory.mockResolvedValue({ payments: [], refunds: [] });
    renderToStaticMarkup(await BookingDetailPage({ params: Promise.resolve({ id: "booking-a" }) }));
    expect(fixture.paymentHistory).toHaveBeenCalledOnce();
    expect(fixture.detailActions).toHaveBeenCalledWith(expect.objectContaining({ allowed: ["CHECKED_IN"], canReschedule: false }), undefined);
    expect(fixture.paymentSection).toHaveBeenCalledWith(expect.objectContaining({ canRecord: true, canRefund: false }), undefined);
  });

  it("renders allowed basic financial summaries when the role lacks operational booking access", async () => {
    fixture.scope = "ALL";
    fixture.permissions = new Set(["report:view_financial"]);
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain("Booking value today");
    expect(html).not.toContain("Today’s operations");
    expect(html).not.toContain("New booking</a>");
    expect(fixture.basicReport).toHaveBeenCalledTimes(2);
    expect(fixture.bookingList).not.toHaveBeenCalled();
    expect(fixture.availableNow).not.toHaveBeenCalled();
  });
});
