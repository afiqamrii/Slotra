import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { bookings } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

const codePattern = /^([A-Z0-9-]{4,40})\.([a-f0-9]{64})$/;
export function qrSigningSecret() { return process.env.BOOKING_QR_SECRET || process.env.BETTER_AUTH_SECRET || null; }
export function signBookingQr(organizationId: string, bookingId: string, reference: string, secret: string) {
  const signature = createHmac("sha256", secret).update(`slotra:check-in:v1:${organizationId}:${bookingId}:${reference}`).digest("hex");
  return `${reference}.${signature}`;
}
export async function resolveBookingQr(database: BookingDatabase, actorId: string,
  organizationId: string, raw: string, secret = qrSigningSecret()) {
  if (!await authorizedMembership(database, actorId, organizationId, "booking:view"))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  await requireOrganizationFeature(database, organizationId, "QR_CHECK_IN");
  if (!secret) throw new BookingError("QR_NOT_CONFIGURED", "QR check-in is not configured");
  const match = z.string().max(110).regex(codePattern).safeParse(raw);
  if (!match.success) throw new BookingError("INVALID_QR", "This check-in code is invalid");
  const [, reference, signature] = codePattern.exec(raw)!;
  const [booking] = await database.select().from(bookings).where(and(
    eq(bookings.organizationId, organizationId), eq(bookings.bookingReference, reference))).limit(1);
  if (!booking) throw new BookingError("INVALID_QR", "This check-in code is invalid");
  const expected = signBookingQr(organizationId, booking.id, booking.bookingReference, secret).split(".")[1];
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")))
    throw new BookingError("INVALID_QR", "This check-in code is invalid");
  return booking;
}
