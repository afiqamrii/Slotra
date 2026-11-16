import { createHash } from "node:crypto";

type CalendarBooking = {
  id: string; status: string; startAt: Date; endAt: Date; resourceName: string; sportName: string;
  venue: { id: string; name: string; branchName: string; address: string | null; city: string | null; state: string | null };
};

export function canDownloadBookingCalendar(status: string) {
  return ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(status);
}

// RFC 5545 sections 3.1 and 3.3.11: escape TEXT before folding content lines.
// https://www.rfc-editor.org/rfc/rfc5545
export function escapeCalendarText(value: string) {
  const cleaned = Array.from(value).filter(character => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  return cleaned.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}

export function foldCalendarLine(line: string) {
  let output = "", bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 75) { output += "\r\n "; bytes = 1; }
    output += character;
    bytes += size;
  }
  return output;
}

function utcTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999)
    throw new Error("Invalid calendar date");
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Explicit field allowlist: never include guest contacts, bearer links, payment data or booking references. */
export function bookingCalendarFile(booking: CalendarBooking, productName: string, generatedAt = new Date()) {
  if (!canDownloadBookingCalendar(booking.status)) throw new Error("Booking is not confirmed");
  if (!(booking.endAt > booking.startAt)) throw new Error("Invalid calendar range");
  const uid = createHash("sha256").update(`venue-booking-calendar:${booking.venue.id}:${booking.id}`).digest("hex");
  const location = [booking.venue.branchName, booking.venue.address, booking.venue.city, booking.venue.state].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${escapeCalendarText(`-//${productName}//Venue bookings//EN`)}`, "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${uid}@venue-booking-calendar`, `DTSTAMP:${utcTimestamp(generatedAt)}`,
    `DTSTART:${utcTimestamp(booking.startAt)}`, `DTEND:${utcTimestamp(booking.endAt)}`,
    `SUMMARY:${escapeCalendarText(`${booking.sportName} at ${booking.venue.name}`)}`,
    `LOCATION:${escapeCalendarText(location)}`,
    `DESCRIPTION:${escapeCalendarText(`${booking.resourceName} · ${booking.sportName}\nThis calendar copy does not update automatically. Check your private booking confirmation for changes.`)}`,
    "STATUS:CONFIRMED", "CLASS:PRIVATE", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(foldCalendarLine).join("\r\n") + "\r\n";
}
