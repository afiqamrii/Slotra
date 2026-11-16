import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { bookings, branches, customers, notificationRecords, organizations, resources } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { bookingDate, bookingMoney, bookingTime } from "@/lib/booking-format";
import { deliverEmail } from "@/lib/email-delivery";
import { bookingEmailTemplate } from "@/lib/email-templates";

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

export async function dispatchBookingNotifications(db: BookingDatabase, organizationId: string, bookingId: string,
  deadlineAt = Number.POSITIVE_INFINITY) {
  const pending = await db.select().from(notificationRecords).where(and(eq(notificationRecords.organizationId, organizationId),
    eq(notificationRecords.bookingId, bookingId), eq(notificationRecords.status, "PENDING")))
    .orderBy(notificationRecords.createdAt).limit(10);
  for (const notice of pending) {
    if (Date.now() >= deadlineAt) break;
    if (!notice.recipient) continue;
    // Commit the claim before contacting Resend; concurrent requests/cron cannot both send.
    // Failed or interrupted sends need reconciliation, not blind replay after provider idempotency expires.
    const [claim] = await db.update(notificationRecords).set({ status: "PROCESSING", updatedAt: new Date() })
      .where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id),
        eq(notificationRecords.status, "PENDING"))).returning({ id: notificationRecords.id });
    if (!claim) continue;
    try {
      const [detail] = await db.select({ booking: bookings, venue: organizations, timezone: branches.timezone,
        resource: resources.name, customer: customers.name }).from(bookings)
        .innerJoin(organizations, eq(bookings.organizationId, organizations.id))
        .innerJoin(branches, and(eq(bookings.branchId, branches.id), eq(branches.organizationId, organizationId)))
        .innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(resources.organizationId, organizationId)))
        .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
      if (!detail) throw new Error("Booking no longer available");
      if (notice.type !== "BOOKING_CANCELLED" && ["CANCELLED", "EXPIRED"].includes(detail.booking.status)) {
        await db.update(notificationRecords).set({ status: "SKIPPED", failureReason: "Booking is no longer active", updatedAt: new Date() })
          .where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id)));
        continue;
      }
      const booking = detail.booking;
      const venueName = detail.venue.displayName || detail.venue.name;
      const template = bookingEmailTemplate({ event: notice.type === "BOOKING_CANCELLED" ? "CANCELLED" :
        notice.type === "BOOKING_RESCHEDULED" ? "RESCHEDULED" : "CONFIRMED",
        branding: { name: venueName, accent: detail.venue.primaryColor, logoUrl: detail.venue.logoUrl,
          contactPhone: detail.venue.contactPhone, contactEmail: detail.venue.contactEmail },
        customerName: detail.customer || "there", bookingReference: booking.bookingReference,
        resourceName: detail.resource, date: bookingDate(booking.startAt, detail.timezone),
        time: `${bookingTime(booking.startAt, detail.timezone)}–${bookingTime(booking.endAt, detail.timezone)}`,
        total: bookingMoney(booking.totalAmount, booking.currency), paid: bookingMoney(booking.amountPaid, booking.currency),
        outstanding: bookingMoney(Math.max(0, booking.totalAmount - booking.amountPaid), booking.currency),
        paymentRequirement: booking.paymentRequirement });
      const sent = await deliverEmail({ to: notice.recipient, ...template, idempotencyKey: notice.id });
      await db.update(notificationRecords).set({ status: sent.status, providerMessageId: sent.providerMessageId,
        sentAt: sent.status === "SENT" ? new Date() : null, failureReason: sent.reason, updatedAt: new Date() })
        .where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id)));
    } catch {
      await db.update(notificationRecords).set({ status: "FAILED", failureReason: "Email delivery needs provider reconciliation",
        updatedAt: new Date() }).where(and(eq(notificationRecords.organizationId, organizationId), eq(notificationRecords.id, notice.id)));
    }
  }
}

/** Recover committed outbox rows missed when a request ends before its post-commit send. */
export async function drainBookingNotifications(db: BookingDatabase, deadlineAt = Number.POSITIVE_INFINITY) {
  const pending = await db.select({ organizationId: notificationRecords.organizationId, bookingId: notificationRecords.bookingId })
    .from(notificationRecords).where(eq(notificationRecords.status, "PENDING"))
    .orderBy(notificationRecords.createdAt).limit(25);
  let processed = 0;
  const seen = new Set<string>();
  for (const notice of pending) {
    if (Date.now() >= deadlineAt) break;
    const key = `${notice.organizationId}:${notice.bookingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await dispatchBookingNotifications(db, notice.organizationId, notice.bookingId, deadlineAt);
    processed++;
  }
  return { processed };
}

export async function reconcileInterruptedBookingNotifications(db: BookingDatabase, now = new Date()) {
  const rows = await db.select({ id: notificationRecords.id }).from(notificationRecords)
    .where(and(eq(notificationRecords.status, "PROCESSING"), lt(notificationRecords.updatedAt, new Date(now.getTime() - 15 * 60_000))))
    .orderBy(notificationRecords.updatedAt).limit(100);
  if (!rows.length) return 0;
  const changed = await db.update(notificationRecords).set({ status: "FAILED", updatedAt: now,
    failureReason: "Delivery was interrupted; reconcile with the provider before retrying" })
    .where(and(inArray(notificationRecords.id, rows.map(row => row.id)), eq(notificationRecords.status, "PROCESSING"),
      lt(notificationRecords.updatedAt, new Date(now.getTime() - 15 * 60_000)))).returning({ id: notificationRecords.id });
  return changed.length;
}

export async function dispatchWithoutBlocking(db: BookingDatabase, organizationId: string, bookingId: string) {
  try { await dispatchBookingNotifications(db, organizationId, bookingId); }
  catch { /* Booking transaction has committed; notification retry remains available. */ }
}
