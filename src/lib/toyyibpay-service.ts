import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { bookings, customers, organizationPaymentAccounts, payments } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { BookingError } from "@/lib/booking-availability";
import { processPaymentEvent } from "@/lib/payment-service";
import { sandboxCheckoutUrl, toyyibSandboxConfig, toyyibSandboxProvider,
  verifiedToyyibTransaction, verifyToyyibCallback } from "@/lib/toyyibpay-sandbox";

const provider = "TOYYIBPAY_SANDBOX";
export async function startToyyibSandboxCheckout(db: BookingDatabase, organizationId: string,
  bookingId: string, venueSlug: string, now = new Date()) {
  if (!toyyibSandboxConfig(organizationId)) throw new BookingError("PAYMENT_UNAVAILABLE", "Sandbox checkout is not configured");
  const [row] = await db.select({ paymentId: payments.id, paymentStatus: payments.status,
    providerPaymentId: payments.providerPaymentId, amountMinor: payments.amountMinor, currency: payments.currency,
    reference: bookings.bookingReference, holdExpiresAt: bookings.holdExpiresAt, bookingStatus: bookings.status,
    customerName: customers.name, customerEmail: customers.email, customerPhone: customers.phone,
    accountStatus: organizationPaymentAccounts.status,
  }).from(payments).innerJoin(bookings, and(eq(bookings.organizationId, payments.organizationId),
    eq(bookings.id, payments.bookingId))).innerJoin(customers, and(eq(customers.organizationId, bookings.organizationId),
    eq(customers.id, bookings.customerId))).innerJoin(organizationPaymentAccounts,
    and(eq(organizationPaymentAccounts.organizationId, payments.organizationId),
      eq(organizationPaymentAccounts.id, payments.providerAccountId)))
    .where(and(eq(payments.organizationId, organizationId), eq(payments.bookingId, bookingId),
      eq(payments.provider, provider))).limit(1);
  if (!row || row.accountStatus !== "CONNECTED" || row.bookingStatus !== "AWAITING_PAYMENT" ||
    !row.holdExpiresAt || row.holdExpiresAt <= now || !row.customerEmail)
    throw new BookingError("PAYMENT_UNAVAILABLE", "Checkout is no longer available");
  if (row.providerPaymentId) return { paymentId: row.paymentId,
    checkoutUrl: sandboxCheckoutUrl(row.providerPaymentId) };
  const [claimed] = await db.update(payments).set({ status: "PROCESSING", updatedAt: now })
    .where(and(eq(payments.organizationId, organizationId), eq(payments.id, row.paymentId),
      eq(payments.status, "PENDING"), isNull(payments.providerPaymentId))).returning({ id: payments.id });
  if (!claimed) throw new BookingError("PAYMENT_UNAVAILABLE", "Checkout is already starting");
  try {
    const created = await toyyibSandboxProvider.createPayment({ paymentId: row.paymentId,
      amountMinor: row.amountMinor, currency: row.currency, checkout: { organizationId, venueSlug,
        bookingReference: row.reference, customerName: row.customerName, customerEmail: row.customerEmail,
        customerPhone: row.customerPhone, holdExpiresAt: row.holdExpiresAt } });
    if (!created.checkoutUrl) throw new Error("ToyyibPay checkout URL missing");
    const [saved] = await db.update(payments).set({ providerPaymentId: created.providerPaymentId, updatedAt: new Date() })
      .where(and(eq(payments.organizationId, organizationId), eq(payments.id, row.paymentId),
        eq(payments.status, "PROCESSING"))).returning({ id: payments.id });
    if (!saved) throw new Error("Checkout hold ended before bill was linked");
    return { paymentId: row.paymentId, checkoutUrl: created.checkoutUrl };
  } catch {
    await processPaymentEvent(db, provider, { paymentId: row.paymentId,
      eventId: `checkout-setup-failed:${row.paymentId}`, status: "FAILED" }, new Date());
    throw new BookingError("PAYMENT_UNAVAILABLE", "Could not start ToyyibPay sandbox checkout");
  }
}
export async function reconcileToyyibSandboxPayment(db: BookingDatabase, paymentId: string, now = new Date()) {
  z.uuid().parse(paymentId);
  const [payment] = await db.select({ id: payments.id, organizationId: payments.organizationId,
    amountMinor: payments.amountMinor, currency: payments.currency, billCode: payments.providerPaymentId,
    providerAccountId: organizationPaymentAccounts.providerAccountId,
    accountStatus: organizationPaymentAccounts.status,
  }).from(payments).innerJoin(organizationPaymentAccounts, and(
    eq(organizationPaymentAccounts.organizationId, payments.organizationId),
    eq(organizationPaymentAccounts.id, payments.providerAccountId)))
    .where(and(eq(payments.id, paymentId), eq(payments.provider, provider))).limit(1);
  if (!payment || !payment.billCode || payment.currency !== "MYR" ||
    toyyibSandboxConfig(payment.organizationId)?.categoryCode !== payment.providerAccountId)
    throw new BookingError("PAYMENT_NOT_FOUND", "Sandbox payment unavailable");
  const verified = await verifiedToyyibTransaction({ billCode: payment.billCode,
    paymentId: payment.id, amountMinor: payment.amountMinor });
  if (!verified) return { pending: true, duplicate: false };
  const outcome = await processPaymentEvent(db, provider, { paymentId: payment.id,
    eventId: verified.eventId, status: verified.status }, now);
  if (verified.providerReference) await db.update(payments).set({ providerReference: verified.providerReference })
    .where(and(eq(payments.organizationId, payment.organizationId), eq(payments.id, payment.id)));
  return { pending: verified.status === "PROCESSING", duplicate: outcome.duplicate };
}
export async function handleToyyibSandboxCallback(db: BookingDatabase, raw: string, now = new Date()) {
  if (raw.length > 4096) throw new Error("Invalid ToyyibPay callback");
  const form = new URLSearchParams(raw);
  const paymentId = z.uuid().safeParse(form.get("order_id"));
  if (!paymentId.success) throw new Error("Invalid ToyyibPay callback");
  const [payment] = await db.select({ organizationId: payments.organizationId,
    billCode: payments.providerPaymentId }).from(payments)
    .where(and(eq(payments.id, paymentId.data), eq(payments.provider, provider))).limit(1);
  if (!payment) throw new Error("Invalid ToyyibPay callback");
  const callback = verifyToyyibCallback(raw, payment.organizationId);
  if (callback.billcode !== payment.billCode) throw new Error("Invalid ToyyibPay callback");
  return reconcileToyyibSandboxPayment(db, paymentId.data, now);
}