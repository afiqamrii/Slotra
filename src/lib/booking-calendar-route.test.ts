import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ db: {}, lookup: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => fixture.db }));
vi.mock("@/lib/public-booking", () => ({ publicConfirmation: fixture.lookup }));
vi.mock("@/lib/brand", () => ({ brand: { name: "Test Venue Desk" } }));
import { GET } from "@/app/book/[organizationSlug]/confirmation/[token]/calendar.ics/route";

const token = "A".repeat(43);
const booking = { id: "booking-id", status: "CONFIRMED", startAt: new Date("2026-11-16T01:00:00Z"), endAt: new Date("2026-11-16T02:00:00Z"),
  customerName: "Private Guest", reference: "BK-PRIVATE", resourceName: "Court 1", sportName: "Badminton",
  venue: { id: "venue-id", name: "Play Arena", branchName: "Main branch", address: null, city: "KL", state: null } };
function download(organizationSlug = "play-arena", privateToken = token) {
  return GET(new Request("https://book.example.test/download"), { params: Promise.resolve({ organizationSlug, token: privateToken }) });
}
function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
}
beforeEach(() => { fixture.lookup.mockReset().mockResolvedValue(booking); });

describe("private booking calendar route", () => {
  it("authorizes using the existing slug+token lookup and returns a private attachment", async () => {
    const response = await download();
    expect(fixture.lookup).toHaveBeenCalledWith(fixture.db, "play-arena", token);
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="booking.ics"');
    const text = await response.text();
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).not.toContain(token);
    expect(text).not.toContain(booking.customerName);
    expect(text).not.toContain(booking.reference);
  });
  it("does not export when the token lookup rejects a foreign venue or missing booking", async () => {
    fixture.lookup.mockResolvedValue(null);
    const response = await download("another-venue");
    expect(fixture.lookup).toHaveBeenCalledWith(fixture.db, "another-venue", token);
    expect(response.status).toBe(404);
    expectPrivateHeaders(response);
    expect(await response.text()).not.toContain("BEGIN:VEVENT");
  });
  it.each(["AWAITING_PAYMENT", "PENDING", "CANCELLED", "EXPIRED", "NO_SHOW"])("rejects %s even with a valid private link", async status => {
    fixture.lookup.mockResolvedValue({ ...booking, status });
    const response = await download();
    expect(response.status).toBe(409);
    expectPrivateHeaders(response);
    expect(await response.text()).not.toContain("BEGIN:VEVENT");
  });
  it("returns a safe private failure without database details or tokens", async () => {
    fixture.lookup.mockRejectedValue(new Error("private database password " + token));
    const response = await download();
    expect(response.status).toBe(503);
    expectPrivateHeaders(response);
    expect(await response.text()).toBe("Calendar download is temporarily unavailable. Try again shortly.");
  });
});
