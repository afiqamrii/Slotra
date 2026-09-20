import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { bookings, branches, customers, notificationRecords, organizations, resources } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { bookingDate, bookingMoney, bookingTime } from "@/lib/booking-format";
import { deliverEmail, escapeEmailHtml } from "@/lib/email-delivery";

type NotificationType = "BOOKING_CONFIRMED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED";

export async function queueBookingNotification(db: BookingDatabase, organizationId: string, bookingId: string,
  eventKey: string, type: NotificationType) {
  const [customer] = await db.select({ email: customers.email }).from(bookings)
    .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(customers.organizationId, organizationId)))
    .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
  await db.insert(notificationRecords).values({ organizationId, bookingId, eventKey, type,
    recipient: customer?.email ?? null, status: customer?.email ? "PENDING" : "SKIPPED",
    failureReason: customer?.email ? null : "No customer email supplied" }).onConflictDoNothing();
}

export async function dispatchBookingNotifications(db: BookingDatabase, organizationId: string, bookingId: string) {
  const pending = await db.select().from(notificationRecords).where(and(eq(notificationRecords.organizationId, organizationId),
    eq(notificationRecords.bookingId, bookingId), inArray(notificationRecords.status, ["PENDING", "FAILED"]))).limit(10);
  for (const notice of pending) {
    if (!notice.recipient) continue;
    try {
      const [detail] = await db.select({ booking: bookings, venue: organizations, timezone: branches.timezone,
        resource: resources.name, customer: customers.name }).from(bookings)
        .innerJoin(organizations, eq(bookings.organizationId, organizations.id))
        .innerJoin(branches, and(eq(bookings.branchId, branches.id), eq(branches.organizationId, organizationId)))
        .innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(resources.organizationId, organizationId)))
        .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
      if (!detail) continue;
      const booking = detail.booking;
      const venueName = detail.venue.displayName || detail.venue.name;
      const title = notice.type === "BOOKING_CANCELLED" ? "Booking cancelled" :
        notice.type === "BOOKING_RESCHEDULED" ? "Booking updated" : "Booking confirmed";
      const lines = [title, `${venueName} · ${booking.bookingReference}`, `${detail.resource}`,
        `${bookingDate(booking.startAt, detail.timezone)} · ${bookingTime(booking.startAt, detail.timezone)}–${bookingTime(booking.endAt, detail.timezone)}`,
        `Total: ${bookingMoney(booking.totalAmount, booking.currency)}`,
        `Paid: ${bookingMoney(booking.amountPaid, booking.currency)}`,
        `Outstanding: ${bookingMoney(Math.max(0, booking.totalAmount - booking.amountPaid), booking.currency)}`,
        booking.paymentRequirement === "NO_UPFRONT" ? `Payment due at venue: ${bookingMoney(Math.max(0, booking.totalAmount - booking.amountPaid), booking.currency)}` : "Payment is recorded separately.",
        detail.venue.contactPhone ? `Contact venue: ${detail.venue.contactPhone}` : ""].filter(Boolean);
      const text = lines.join("\n");
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1b2d29"><h1 style="color:#176b5b">${escapeEmailHtml(title)}</h1><p>Hello ${escapeEmailHtml(detail.customer || "there")},</p>${lines.slice(1).map(line => `<p>${escapeEmailHtml(line)}</p>`).join("")}<p>— ${escapeEmailHtml(venueName)}</p></div>`;
      const sent = await deliverEmail({ to: notice.recipient, subject: `${title} · ${venueName}`,
        html, text, idempotencyKey: notice.id });
      await db.update(notificationRecords).set({ status: sent.status, providerMessageId: sent.providerMessageId,
        sentAt: sent.status === "SENT" ? new Date() : null, failureReason: sent.reason, updatedAt: new Date() })
        .where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id)));
    } catch {
      await db.update(notificationRecords).set({ status: "FAILED", failureReason: "Email delivery failed; retry is needed",
        updatedAt: new Date() }).where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id)));
    }
  }
}

export async function dispatchWithoutBlocking(db: BookingDatabase, organizationId: string, bookingId: string) {
  try { await dispatchBookingNotifications(db, organizationId, bookingId); }
  catch { /* Booking transaction has committed; notification retry remains available. */ }
}
