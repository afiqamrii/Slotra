import { describe, expect, it } from "vitest";
import { bookingCalendarFile, canDownloadBookingCalendar, escapeCalendarText, foldCalendarLine } from "./booking-calendar-file";

const booking = { id: "booking-id", status: "CONFIRMED", startAt: new Date("2026-11-01T05:30:00Z"), endAt: new Date("2026-11-01T06:30:00Z"),
  resourceName: "Court 1", sportName: "Badminton", venue: { id: "venue-id", name: "Play Arena", branchName: "Main branch", address: "1 Main Street", city: "Kuala Lumpur", state: "Selangor" } };
const generatedAt = new Date("2026-10-20T01:02:03.456Z");
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");

describe("booking calendar downloads", () => {
  it("exports a private confirmed event with UTC instants across a repeated local hour", () => {
    const text = unfold(bookingCalendarFile(booking, "Venue Desk", generatedAt));
    expect(text).toContain("PRODID:-//Venue Desk//Venue bookings//EN\r\n");
    expect(text).toContain("DTSTAMP:20261020T010203Z\r\n");
    expect(text).toContain("DTSTART:20261101T053000Z\r\nDTEND:20261101T063000Z\r\n");
    expect(text).toContain("CLASS:PRIVATE\r\n");
    expect(text).not.toContain("TZID");
    expect(text).not.toMatch(/(^|\r\n)(ATTENDEE|ORGANIZER|URL|METHOD):/);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });
  it("keeps the event UID stable on reschedule while separating bookings and tenants", () => {
    const uid = (value: typeof booking) => unfold(bookingCalendarFile(value, "Desk", generatedAt)).match(/UID:([^\r]+)/)![1];
    expect(uid({ ...booking, startAt: new Date("2026-10-30T05:30:00Z") })).toBe(uid(booking));
    expect(uid({ ...booking, id: "another-booking" })).not.toBe(uid(booking));
    expect(uid({ ...booking, venue: { ...booking.venue, id: "another-venue" } })).not.toBe(uid(booking));
    expect(uid(booking)).not.toContain(booking.id);
  });
  it("escapes calendar delimiters and newline injection without creating extra components", () => {
    expect(escapeCalendarText("Court\\A, B; C\r\nNext\rLine\nLast: value")).toBe("Court\\\\A\\, B\\; C\\nNext\\nLine\\nLast: value");
    const text = unfold(bookingCalendarFile({ ...booking, resourceName: "Court\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:mailto:fake@example.test" }, "Desk", generatedAt));
    expect(text.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
    expect(text.match(/\r\nEND:VEVENT\r\n/g)).toHaveLength(1);
    expect(text).not.toContain("\r\nATTENDEE:");
    expect(escapeCalendarText("a" + String.fromCharCode(0, 1, 127) + "b")).toBe("ab");
  });
  it("folds at 75 UTF-8 octets without splitting emoji or multibyte characters", () => {
    const line = "SUMMARY:" + "場地🏸é".repeat(40);
    const folded = foldCalendarLine(line);
    expect(folded).toContain("\r\n ");
    for (const physical of folded.split("\r\n")) {
      expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
      expect(Buffer.from(physical).toString("utf8")).toBe(physical);
    }
    expect(unfold(folded)).toBe(line);
  });
  it("never serializes guest data, private tokens, booking references or payment fields", () => {
    const fullRecord = { ...booking, customerName: "Private Guest", email: "private@example.test", phone: "+60129999999", reference: "BK-PRIVATE",
      token: "secret-confirmation-token", amountPaid: 2500, paymentHistory: [{ providerPaymentId: "private-payment" }] };
    const text = bookingCalendarFile(fullRecord, "Desk", generatedAt);
    for (const value of [fullRecord.customerName, fullRecord.email, fullRecord.phone, fullRecord.reference, fullRecord.token, "private-payment"])
      expect(text).not.toContain(value);
  });
  it.each(["PENDING", "AWAITING_PAYMENT", "EXPIRED", "CANCELLED", "NO_SHOW", "UNKNOWN"])("does not export %s as a confirmed event", status => {
    expect(canDownloadBookingCalendar(status)).toBe(false);
    expect(() => bookingCalendarFile({ ...booking, status }, "Desk", generatedAt)).toThrow("not confirmed");
  });
  it.each(["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"])("allows a confirmed lifecycle state %s", status => {
    expect(canDownloadBookingCalendar(status)).toBe(true);
  });
  it("rejects empty ranges and invalid timestamps", () => {
    expect(() => bookingCalendarFile({ ...booking, endAt: booking.startAt }, "Desk", generatedAt)).toThrow();
    expect(() => bookingCalendarFile(booking, "Desk", new Date("invalid"))).toThrow("Invalid calendar date");
  });
});
