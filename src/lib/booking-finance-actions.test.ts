import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ refund: vi.fn(), reschedule: vi.fn(), quote: vi.fn(),
  detail: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: fixture.refresh }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/authorization", () => ({ requireOrganizationMember: async () => ({
  session: { user: { id: "server-actor" } }, organization: { organizationId: "server-tenant" },
}) }));
vi.mock("@/lib/booking-service", () => ({ rescheduleBooking: fixture.reschedule, quoteReschedule: fixture.quote,
  createBooking: vi.fn(), createResourceBlock: vi.fn(), transitionBooking: vi.fn() }));
vi.mock("@/lib/booking-management", () => ({ staffBookingDetail: fixture.detail,
  searchBookingCustomers: vi.fn(), bookingSetup: vi.fn() }));
vi.mock("@/lib/payment-service", () => ({ requestRefund: fixture.refund,
  connectTestAccount: vi.fn(), disconnectTestAccount: vi.fn(), connectToyyibSandboxAccount: vi.fn(),
  disconnectToyyibSandboxAccount: vi.fn(), recordManualPayment: vi.fn(), savePaymentPolicy: vi.fn() }));
import { BookingError } from "@/lib/booking-availability";
import { quoteRescheduleAction, rescheduleStaffBookingAction } from "@/app/actions/bookings";
import { requestRefundAction } from "@/app/actions/payments";

const bookingId = "7e59e9bf-700d-4572-b1cb-13cb33884ff4";
const resourceId = "6b9734d2-ae76-439d-bf4d-ad0cbf257e1c";
const paymentId = "bc7c8d9e-71b2-484f-86c5-a2582c6ea7cc";
const updatedAt = "2026-10-16T00:00:00.000Z";
const target = { resourceId, date: "2026-10-20", time: "10:00", durationMinutes: 60 };

beforeEach(() => {
  for (const mock of [fixture.refund, fixture.reschedule, fixture.quote, fixture.detail, fixture.refresh]) mock.mockReset();
  fixture.detail.mockResolvedValue({ timezone: "Asia/Kuala_Lumpur" });
  fixture.quote.mockResolvedValue({ currentTotal: 2500, newTotal: 3000, currency: "MYR",
    priceChanged: true, bookingUpdatedAt: updatedAt });
  fixture.reschedule.mockResolvedValue({ id: bookingId });
});

describe("booking reschedule and refund action boundaries", () => {
  it("requires an acknowledged quote before attempting a UI reschedule", async () => {
    const response = await rescheduleStaffBookingAction(bookingId, target);
    expect(response.error).toBeTruthy();
    expect(fixture.reschedule).not.toHaveBeenCalled(); expect(fixture.detail).not.toHaveBeenCalled();
  });

  it("passes the server tenant, branch timezone and acknowledged quote to the domain service", async () => {
    expect(await rescheduleStaffBookingAction(bookingId, { ...target, expectedTotalMinor: 3000,
      expectedBookingUpdatedAt: updatedAt, organizationId: "forged-tenant", actorId: "forged-actor" }))
      .toEqual({ error: null });
    expect(fixture.detail).toHaveBeenCalledWith(expect.anything(), "server-actor", "server-tenant", bookingId);
    expect(fixture.reschedule).toHaveBeenCalledWith(expect.anything(), "server-actor", "server-tenant", bookingId, {
      resourceId, startAt: new Date("2026-10-20T02:00:00.000Z"), endAt: new Date("2026-10-20T03:00:00.000Z"),
      expectedTotalMinor: 3000, expectedBookingUpdatedAt: updatedAt,
    });
  });

  it("retains domain conflicts and price-change errors without reporting success", async () => {
    fixture.reschedule.mockRejectedValue(new BookingError("PRICE_CHANGED", "Check the updated price again."));
    expect(await rescheduleStaffBookingAction(bookingId, { ...target,
      expectedTotalMinor: 3000, expectedBookingUpdatedAt: updatedAt })).toEqual({ error: "Check the updated price again." });
    expect(fixture.refresh).not.toHaveBeenCalled();
  });

  it("returns the booking version with the quote without mutation", async () => {
    const response = await quoteRescheduleAction(bookingId, target);
    expect(response.quote).toMatchObject({ newTotal: 3000, bookingUpdatedAt: updatedAt });
    expect(fixture.reschedule).not.toHaveBeenCalled();
  });

  it.each(["SUCCEEDED", "FAILED", "PENDING", "PROCESSING"])("reports refund %s truthfully", async status => {
    fixture.refund.mockResolvedValue({ bookingId, status });
    const raw = { paymentId, amountMinor: 1000, idempotencyKey: "746d6271-d7ee-4ae4-8b2f-03e458a0e112" };
    const response = await requestRefundAction(raw);
    expect(response).toMatchObject({ paymentId, refundStatus: status });
    expect(response.error === null).toBe(status === "SUCCEEDED");
    expect(fixture.refund).toHaveBeenCalledWith(expect.anything(), "server-actor", "server-tenant", raw);
    expect(fixture.refresh).toHaveBeenCalledWith("/bookings/" + bookingId);
  });

  it("does not expose refund status or success when authorization fails", async () => {
    fixture.refund.mockRejectedValue(new BookingError("PERMISSION_DENIED", "Payment access denied"));
    expect(await requestRefundAction({ paymentId })).toEqual({
      error: "Payment access denied", paymentId: null, refundStatus: null,
    });
    expect(fixture.refresh).not.toHaveBeenCalled();
  });
});
