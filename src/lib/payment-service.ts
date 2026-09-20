import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import {
  bookingStatusHistory, bookings, organizationPaymentAccounts, organizationPaymentSettings,
  paymentAuditLogs, paymentWebhookEvents, payments, refunds, resources, organizations,
} from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { BookingError } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { defaultPaymentPolicy, paymentSettingsInput, testPaymentsEnabled, type PaymentPolicy } from "@/lib/payment-policy";
import { manualProvider, testProvider, type ProviderEvent } from "@/lib/payment-providers";
import { toyyibSandboxConfig, verifyToyyibSandboxCategory } from "@/lib/toyyibpay-sandbox";
import type { Permission } from "@/lib/permissions";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordConfirmedBookingUsage } from "@/lib/booking-usage";
import { dispatchWithoutBlocking, queueBookingNotification } from "@/lib/booking-notifications";

async function permit(db: BookingDatabase, actorId: string, orgId: string, permission: Permission) {
  if (!await authorizedMembership(db, actorId, orgId, permission))
    throw new BookingError("PERMISSION_DENIED", "Payment access denied");
}
async function bookingForUpdate(db: BookingDatabase, orgId: string, bookingId: string) {
  const [pre] = await db.select({ resourceId: bookings.resourceId, branchId: bookings.branchId })
    .from(bookings).where(and(eq(bookings.organizationId, orgId), eq(bookings.id, bookingId))).limit(1);
  if (!pre) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  const [space] = await db.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.organizationId, orgId), eq(resources.branchId, pre.branchId), eq(resources.id, pre.resourceId)))
    .for("update").limit(1);
  if (!space) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  const [row] = await db.select().from(bookings)
    .where(and(eq(bookings.organizationId, orgId), eq(bookings.id, bookingId))).for("update").limit(1);
  if (!row) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  return row;
}
async function audit(db: BookingDatabase, organizationId: string, action: string, data: {
  bookingId?: string; paymentId?: string; actorUserId?: string; detail?: string;
}) {
  await db.insert(paymentAuditLogs).values({ organizationId, action, ...data });
}

export async function getPaymentPolicy(db: BookingDatabase, organizationId: string): Promise<PaymentPolicy> {
  const [[row], onlineEnabled] = await Promise.all([
    db.select().from(organizationPaymentSettings)
      .where(eq(organizationPaymentSettings.organizationId, organizationId)).limit(1),
    hasOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS"),
  ]);
  if (!onlineEnabled) return { ...defaultPaymentPolicy, holdMinutes: row?.holdMinutes ?? defaultPaymentPolicy.holdMinutes };
  return row ? { requirement: row.requirement as PaymentPolicy["requirement"],
    fixedDepositMinor: row.fixedDepositMinor, depositPercentage: row.depositPercentage,
    manualEnabled: row.manualEnabled, holdMinutes: row.holdMinutes } : defaultPaymentPolicy;
}
export async function connectedCheckoutAccount(db: BookingDatabase, organizationId: string) {
  if (!await hasOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS")) return null;
  const [row] = await db.select().from(organizationPaymentAccounts).where(and(
    eq(organizationPaymentAccounts.organizationId, organizationId),
    eq(organizationPaymentAccounts.isDefault, true),
    eq(organizationPaymentAccounts.status, "CONNECTED"),
  )).limit(1);
  if (row?.provider === "TEST" && testPaymentsEnabled() && !!process.env.TEST_PAYMENT_WEBHOOK_SECRET) return row;
  if (row?.provider === "TOYYIBPAY_SANDBOX" && toyyibSandboxConfig(organizationId)?.categoryCode === row.providerAccountId) return row;
  return null;
}
export async function savePaymentPolicy(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await permit(db, actorId, organizationId, "payment:manage_settings");
  const input = paymentSettingsInput.parse(raw);
  if (input.requirement !== "NO_UPFRONT") await requireOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS");
  if (input.requirement === "FIXED_DEPOSIT" || input.requirement === "PERCENT_DEPOSIT")
    await requireOrganizationFeature(db, organizationId, "DEPOSITS");
  const currentAccount = await connectedCheckoutAccount(db, organizationId);
  if (currentAccount?.provider === "TOYYIBPAY_SANDBOX" && input.requirement === "FIXED_DEPOSIT" &&
    (input.fixedDepositMinor ?? 0) < 100)
    throw new BookingError("PAYMENT_AMOUNT", "ToyyibPay sandbox deposits must be at least RM1");
  if (input.requirement !== "NO_UPFRONT" && !await connectedCheckoutAccount(db, organizationId))
    throw new BookingError("PROVIDER_UNAVAILABLE", "Connect a supported payment provider before requiring online payment");
  const now = new Date();
  return db.transaction(async tx => {
    const [row] = await tx.insert(organizationPaymentSettings).values({
      organizationId, requirement: input.requirement,
      fixedDepositMinor: input.requirement === "FIXED_DEPOSIT" ? input.fixedDepositMinor : null,
      depositPercentage: input.requirement === "PERCENT_DEPOSIT" ? input.depositPercentage : null,
      manualEnabled: input.manualEnabled, holdMinutes: input.holdMinutes,
    }).onConflictDoUpdate({ target: organizationPaymentSettings.organizationId, set: {
      requirement: input.requirement,
      fixedDepositMinor: input.requirement === "FIXED_DEPOSIT" ? input.fixedDepositMinor : null,
      depositPercentage: input.requirement === "PERCENT_DEPOSIT" ? input.depositPercentage : null,
      manualEnabled: input.manualEnabled, holdMinutes: input.holdMinutes, updatedAt: now,
    } }).returning();
    await audit(tx, organizationId, "PAYMENT_SETTINGS_CHANGED", { actorUserId: actorId, detail: input.requirement });
    return row;
  });
}
export async function connectTestAccount(db: BookingDatabase, actorId: string, organizationId: string) {
  await permit(db, actorId, organizationId, "payment:manage_settings");
  await requireOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS");
  if (!testPaymentsEnabled() || !process.env.TEST_PAYMENT_WEBHOOK_SECRET)
    throw new BookingError("PROVIDER_UNAVAILABLE", "Test payments require explicit development configuration");
  return db.transaction(async tx => {
    await tx.update(organizationPaymentAccounts).set({ isDefault: false, updatedAt: new Date() })
      .where(eq(organizationPaymentAccounts.organizationId, organizationId));
    const [row] = await tx.insert(organizationPaymentAccounts).values({
      organizationId, provider: "TEST", providerAccountId: "test:" + organizationId,
      status: "CONNECTED", isDefault: true,
    }).onConflictDoUpdate({ target: [
      organizationPaymentAccounts.organizationId, organizationPaymentAccounts.provider,
      organizationPaymentAccounts.providerAccountId,
    ], set: { status: "CONNECTED", isDefault: true, updatedAt: new Date() } }).returning();
    await audit(tx, organizationId, "PROVIDER_CONNECTED", { actorUserId: actorId, detail: "TEST" });
    return row;
  });
}
export async function disconnectTestAccount(db: BookingDatabase, actorId: string, organizationId: string) {
  await permit(db, actorId, organizationId, "payment:manage_settings");
  await requireOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS");
  if (!testPaymentsEnabled()) throw new BookingError("PROVIDER_UNAVAILABLE", "Test payments are development only");
  return db.transaction(async tx => {
    const [active] = await tx.select({ id: bookings.id }).from(bookings)
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.status, "AWAITING_PAYMENT"))).limit(1);
    if (active) throw new BookingError("ACTIVE_CHECKOUTS", "Wait for active checkouts to finish or expire");
    await tx.update(organizationPaymentSettings).set({ requirement: "NO_UPFRONT", fixedDepositMinor: null,
      depositPercentage: null, updatedAt: new Date() }).where(eq(organizationPaymentSettings.organizationId, organizationId));
    await tx.update(organizationPaymentAccounts).set({ status: "DISCONNECTED", isDefault: false, updatedAt: new Date() })
      .where(and(eq(organizationPaymentAccounts.organizationId, organizationId), eq(organizationPaymentAccounts.provider, "TEST")));
    await audit(tx, organizationId, "PROVIDER_DISCONNECTED", { actorUserId: actorId, detail: "TEST" });
  });
}

export async function connectToyyibSandboxAccount(db: BookingDatabase, actorId: string, organizationId: string) {
  await permit(db, actorId, organizationId, "payment:manage_settings");
  await requireOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS");
  const [org] = await db.select({ currency: organizations.currency }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (org?.currency !== "MYR") throw new BookingError("PROVIDER_UNAVAILABLE", "ToyyibPay sandbox supports MYR venues only");
  let categoryCode: string;
  try { categoryCode = await verifyToyyibSandboxCategory(organizationId); }
  catch { throw new BookingError("PROVIDER_UNAVAILABLE", "Could not verify the ToyyibPay sandbox merchant category"); }
  return db.transaction(async tx => {
    await tx.update(organizationPaymentAccounts).set({ isDefault: false, updatedAt: new Date() })
      .where(eq(organizationPaymentAccounts.organizationId, organizationId));
    const [row] = await tx.insert(organizationPaymentAccounts).values({ organizationId,
      provider: "TOYYIBPAY_SANDBOX", providerAccountId: categoryCode, status: "CONNECTED", isDefault: true,
    }).onConflictDoUpdate({ target: [organizationPaymentAccounts.organizationId,
      organizationPaymentAccounts.provider, organizationPaymentAccounts.providerAccountId],
      set: { status: "CONNECTED", isDefault: true, updatedAt: new Date() } }).returning();
    await audit(tx, organizationId, "PROVIDER_CONNECTED", { actorUserId: actorId, detail: "TOYYIBPAY_SANDBOX" });
    return row;
  });
}
export async function disconnectToyyibSandboxAccount(db: BookingDatabase, actorId: string, organizationId: string) {
  await permit(db, actorId, organizationId, "payment:manage_settings");
  if (!toyyibSandboxConfig(organizationId))
    throw new BookingError("PROVIDER_UNAVAILABLE", "ToyyibPay sandbox is not configured for this venue");
  return db.transaction(async tx => {
    const [active] = await tx.select({ id: bookings.id }).from(bookings)
      .innerJoin(payments, and(eq(payments.organizationId, bookings.organizationId), eq(payments.bookingId, bookings.id)))
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.status, "AWAITING_PAYMENT"),
        eq(payments.provider, "TOYYIBPAY_SANDBOX"))).limit(1);
    if (active) throw new BookingError("ACTIVE_CHECKOUTS", "Wait for active checkouts to finish or expire");
    const [current] = await tx.select({ isDefault: organizationPaymentAccounts.isDefault }).from(organizationPaymentAccounts)
      .where(and(eq(organizationPaymentAccounts.organizationId, organizationId),
        eq(organizationPaymentAccounts.provider, "TOYYIBPAY_SANDBOX"), eq(organizationPaymentAccounts.status, "CONNECTED"))).limit(1);
    if (current?.isDefault) await tx.update(organizationPaymentSettings).set({ requirement: "NO_UPFRONT",
      fixedDepositMinor: null, depositPercentage: null, updatedAt: new Date() })
      .where(eq(organizationPaymentSettings.organizationId, organizationId));
    await tx.update(organizationPaymentAccounts).set({ status: "DISCONNECTED", isDefault: false, updatedAt: new Date() })
      .where(and(eq(organizationPaymentAccounts.organizationId, organizationId),
        eq(organizationPaymentAccounts.provider, "TOYYIBPAY_SANDBOX")));
    await audit(tx, organizationId, "PROVIDER_DISCONNECTED", { actorUserId: actorId, detail: "TOYYIBPAY_SANDBOX" });
  });
}
export async function paymentHistory(db: BookingDatabase, actorId: string, organizationId: string, bookingId: string) {
  await permit(db, actorId, organizationId, "payment:view");
  const [booking] = await db.select().from(bookings)
    .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, z.uuid().parse(bookingId)))).limit(1);
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  const items = await db.select().from(payments).where(and(eq(payments.organizationId, organizationId),
    eq(payments.bookingId, bookingId))).orderBy(payments.createdAt);
  const returned = items.length ? await db.select().from(refunds).where(and(
    eq(refunds.organizationId, organizationId), inArray(refunds.paymentId, items.map(item => item.id)),
  )).orderBy(refunds.createdAt) : [];
  return { booking, payments: items, refunds: returned };
}
async function reconcilePaid(db: BookingDatabase, organizationId: string, bookingId: string, totalAmount: number, now: Date) {
  const items = await db.select({ id: payments.id, amount: payments.amountMinor, status: payments.status })
    .from(payments).where(and(eq(payments.organizationId, organizationId), eq(payments.bookingId, bookingId)));
  const returned = items.length ? await db.select({ paymentId: refunds.paymentId, amount: refunds.amountMinor })
    .from(refunds).where(and(eq(refunds.organizationId, organizationId), eq(refunds.status, "SUCCEEDED"),
      inArray(refunds.paymentId, items.map(item => item.id)))) : [];
  const gross = items.filter(item => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(item.status))
    .reduce((sum, item) => sum + item.amount, 0);
  const net = gross - returned.reduce((sum, item) => sum + item.amount, 0);
  if (net < 0 || net > totalAmount) throw new BookingError("PAYMENT_AMOUNT", "Payment exceeds booking total");
  await db.update(bookings).set({ amountPaid: net, updatedAt: now })
    .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId)));
  return net;
}
export async function recordManualPayment(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  await permit(db, actorId, organizationId, "payment:record_manual");
  const input = z.object({ bookingId: z.uuid(), amountMinor: z.number().int().positive().max(2_147_483_647),
    method: z.enum(["CASH", "BANK_TRANSFER", "OTHER_MANUAL"]), idempotencyKey: z.uuid() }).parse(raw);
  return db.transaction(async tx => {
    const booking = await bookingForUpdate(tx, organizationId, input.bookingId);
    const [existing] = await tx.select().from(payments).where(and(eq(payments.organizationId, organizationId),
      eq(payments.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.bookingId === input.bookingId && existing.amountMinor === input.amountMinor &&
        existing.paymentMethod === input.method) return existing;
      throw new BookingError("IDEMPOTENCY_CONFLICT", "This payment request was already used for different details");
    }    if (!["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(booking.status))
      throw new BookingError("INVALID_TRANSITION", "Payment cannot be recorded for this booking");
    const policy = await getPaymentPolicy(tx, organizationId);
    if (!policy.manualEnabled) throw new BookingError("MANUAL_DISABLED", "Manual payments are disabled");
    if (input.amountMinor > booking.totalAmount - booking.amountPaid)
      throw new BookingError("PAYMENT_AMOUNT", "Amount exceeds the outstanding balance");
    const [payment] = await tx.insert(payments).values({
      organizationId, bookingId: booking.id, provider: manualProvider.id,
      amountMinor: input.amountMinor, currency: booking.currency, status: "PAID",
      type: "MANUAL_PAYMENT", paymentMethod: input.method,
      paidAt: now, recordedByUserId: actorId, idempotencyKey: input.idempotencyKey,
    }).returning();
    await reconcilePaid(tx, organizationId, booking.id, booking.totalAmount, now);
    await audit(tx, organizationId, "MANUAL_PAYMENT_RECORDED", { bookingId: booking.id, paymentId: payment.id, actorUserId: actorId,
      detail: input.method + ":" + input.amountMinor });
    return payment;
  });
}
export async function requestRefund(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  await permit(db, actorId, organizationId, "payment:refund");
  const input = z.object({ paymentId: z.uuid(), amountMinor: z.number().int().positive().max(2_147_483_647),
    reason: z.string().trim().max(500).optional(), idempotencyKey: z.uuid() }).parse(raw);
  const [pre] = await db.select({ bookingId: payments.bookingId }).from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.id, input.paymentId))).limit(1);
  if (!pre) throw new BookingError("PAYMENT_NOT_FOUND", "Payment not found");
  const pending = await db.transaction(async tx => {
    const booking = await bookingForUpdate(tx, organizationId, pre.bookingId);
    const [replayedRefund] = await tx.select().from(refunds).where(and(eq(refunds.organizationId, organizationId),
      eq(refunds.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replayedRefund) {
      if (replayedRefund.paymentId === input.paymentId && replayedRefund.amountMinor === input.amountMinor &&
        (replayedRefund.reason ?? "") === (input.reason ?? "")) return { row: replayedRefund, provider: "MANUAL", reused: true };
      throw new BookingError("IDEMPOTENCY_CONFLICT", "This refund request was already used for different details");
    }    const [payment] = await tx.select().from(payments)
      .where(and(eq(payments.organizationId, organizationId), eq(payments.id, input.paymentId))).for("update").limit(1);
    if (!payment || payment.bookingId !== booking.id || !["PAID", "PARTIALLY_REFUNDED"].includes(payment.status))
      throw new BookingError("PAYMENT_NOT_FOUND", "Payment cannot be refunded");
    if (payment.provider !== "MANUAL") await requireOrganizationFeature(tx, organizationId, "ONLINE_REFUNDS");
    if (payment.provider === "TEST" && !testPaymentsEnabled())
      throw new BookingError("PROVIDER_UNAVAILABLE", "Test refunds are development only");
    if (!["TEST", "MANUAL"].includes(payment.provider))
      throw new BookingError("PROVIDER_UNAVAILABLE", "This provider does not support refunds yet");
    const existing = await tx.select().from(refunds).where(and(eq(refunds.organizationId, organizationId),
      eq(refunds.paymentId, payment.id), inArray(refunds.status, ["PENDING", "PROCESSING", "SUCCEEDED"])));
    if (input.amountMinor > payment.amountMinor - existing.reduce((sum, item) => sum + item.amountMinor, 0))
      throw new BookingError("REFUND_AMOUNT", "Refund exceeds the refundable amount");
    const [row] = await tx.insert(refunds).values({
      organizationId, paymentId: payment.id, bookingId: booking.id, amountMinor: input.amountMinor,
      reason: input.reason || null, createdByUserId: actorId, idempotencyKey: input.idempotencyKey,
    }).returning();
    await audit(tx, organizationId, "REFUND_REQUESTED", { bookingId: booking.id, paymentId: payment.id, actorUserId: actorId,
      detail: String(input.amountMinor) });
    return { row, provider: payment.provider, reused: false };
  });
  if (pending.reused) return pending.row;
  // External adapters are called outside database locks. A real provider must use the refund ID as its idempotency key.
  let result: { providerRefundId: string; status: "SUCCEEDED" | "FAILED" };
  try {
    result = await (pending.provider === "MANUAL" ? manualProvider : testProvider)
      .refundPayment({ paymentId: input.paymentId, refundId: pending.row.id, amountMinor: input.amountMinor });
  } catch {
    result = { providerRefundId: "failed:" + pending.row.id, status: "FAILED" };
  }
  return db.transaction(async tx => {
    const booking = await bookingForUpdate(tx, organizationId, pre.bookingId);
    const [payment] = await tx.select().from(payments).where(and(eq(payments.organizationId, organizationId),
      eq(payments.id, input.paymentId))).for("update").limit(1);
    const [row] = await tx.select().from(refunds).where(and(eq(refunds.organizationId, organizationId),
      eq(refunds.id, pending.row.id))).for("update").limit(1);
    if (!row || !payment) throw new BookingError("REFUND_NOT_FOUND", "Refund not found");
    if (row.status !== "PENDING") return row;
    const [updated] = await tx.update(refunds).set({ status: result.status, providerRefundId: result.providerRefundId,
      updatedAt: now }).where(eq(refunds.id, row.id)).returning();
    if (result.status === "SUCCEEDED") {
      const succeeded = await tx.select({ amount: refunds.amountMinor }).from(refunds)
        .where(and(eq(refunds.organizationId, organizationId), eq(refunds.paymentId, payment.id), eq(refunds.status, "SUCCEEDED")));
      const refunded = succeeded.reduce((sum, item) => sum + item.amount, 0);
      await tx.update(payments).set({ status: refunded === payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        updatedAt: now }).where(and(eq(payments.organizationId, organizationId), eq(payments.id, payment.id)));
      await reconcilePaid(tx, organizationId, booking.id, booking.totalAmount, now);
    }
    await audit(tx, organizationId, result.status === "SUCCEEDED" ? "REFUND_COMPLETED" : "REFUND_FAILED",
      { bookingId: booking.id, paymentId: payment.id, actorUserId: actorId, detail: String(input.amountMinor) });
    return updated;
  });
}

export async function expireHoldsForResource(db: BookingDatabase, organizationId: string, resourceId: string, now: Date) {
  // Caller owns the resource row lock. Never expire a hold without this lock.
  const expired = await db.select().from(bookings).where(and(eq(bookings.organizationId, organizationId),
    eq(bookings.resourceId, resourceId), eq(bookings.status, "AWAITING_PAYMENT"),
    lte(bookings.holdExpiresAt, now))).for("update");
  for (const row of expired) {
    await db.update(bookings).set({ status: "EXPIRED", updatedAt: now })
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, row.id)));
    await db.update(payments).set({ status: "CANCELLED", updatedAt: now })
      .where(and(eq(payments.organizationId, organizationId), eq(payments.bookingId, row.id),
        inArray(payments.status, ["PENDING", "PROCESSING"])));
    await db.insert(bookingStatusHistory).values({ organizationId, bookingId: row.id,
      previousStatus: "AWAITING_PAYMENT", newStatus: "EXPIRED", reason: "Payment hold expired" });
  }
  return expired.length;
}
export async function sweepExpiredHolds(db: BookingDatabase, now = new Date(), limit = 100) {
  const candidates = await db.select({ organizationId: bookings.organizationId, bookingId: bookings.id,
    resourceId: bookings.resourceId, branchId: bookings.branchId }).from(bookings)
    .where(and(eq(bookings.status, "AWAITING_PAYMENT"), lte(bookings.holdExpiresAt, now)))
    .limit(limit);
  let count = 0;
  for (const candidate of candidates) {
    count += await db.transaction(async tx => {
      const [space] = await tx.select({ id: resources.id }).from(resources).where(and(
        eq(resources.organizationId, candidate.organizationId), eq(resources.branchId, candidate.branchId),
        eq(resources.id, candidate.resourceId))).for("update").limit(1);
      return space ? expireHoldsForResource(tx, candidate.organizationId, candidate.resourceId, now) : 0;
    });
  }
  return count;
}

export async function processPaymentEvent(db: BookingDatabase, provider: "TEST" | "TOYYIBPAY_SANDBOX", event: ProviderEvent, now = new Date()) {
  if (provider === "TEST" && !testPaymentsEnabled()) throw new BookingError("PROVIDER_UNAVAILABLE", "Provider unavailable");
  const [pre] = await db.select({ organizationId: payments.organizationId, bookingId: payments.bookingId })
    .from(payments).where(and(eq(payments.id, event.paymentId), eq(payments.provider, provider))).limit(1);
  if (!pre) throw new BookingError("PAYMENT_NOT_FOUND", "Payment not found");
  if (provider === "TOYYIBPAY_SANDBOX" && !toyyibSandboxConfig(pre.organizationId))
    throw new BookingError("PROVIDER_UNAVAILABLE", "ToyyibPay sandbox unavailable");
  const processed = await db.transaction(async tx => {
    const booking = await bookingForUpdate(tx, pre.organizationId, pre.bookingId);
    const [payment] = await tx.select().from(payments).where(and(eq(payments.organizationId, pre.organizationId),
      eq(payments.id, event.paymentId), eq(payments.provider, provider))).for("update").limit(1);
    if (!payment || payment.bookingId !== booking.id) throw new BookingError("PAYMENT_NOT_FOUND", "Payment not found");
    const [claimed] = await tx.insert(paymentWebhookEvents).values({
      provider, providerEventId: event.eventId, organizationId: pre.organizationId, paymentId: payment.id,
    }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
    if (!claimed) return { duplicate: true, bookingStatus: booking.status, paymentStatus: payment.status };
    if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status))
      return { duplicate: false, bookingStatus: booking.status, paymentStatus: payment.status };
    if (event.status === "PROCESSING") {
      if (booking.status !== "AWAITING_PAYMENT" || !booking.holdExpiresAt || booking.holdExpiresAt <= now ||
        !["PENDING", "PROCESSING"].includes(payment.status))
        return { duplicate: false, bookingStatus: booking.status, paymentStatus: payment.status };
      await tx.update(payments).set({ status: "PROCESSING", updatedAt: now })
        .where(eq(payments.id, payment.id));
      return { duplicate: false, bookingStatus: booking.status, paymentStatus: "PROCESSING" };
    }
    const status = event.status === "PAID" ? "PAID" : "FAILED";
    await tx.update(payments).set({ status, paidAt: status === "PAID" ? now : null,
      failedAt: status === "FAILED" ? now : null, updatedAt: now })
      .where(and(eq(payments.organizationId, pre.organizationId), eq(payments.id, payment.id)));
    let bookingStatus = booking.status;
    if (booking.status === "AWAITING_PAYMENT") {
      const valid = booking.holdExpiresAt && booking.holdExpiresAt > now;
      let canConfirm = status === "PAID" && !!valid;
      if (canConfirm) {
        try { await recordConfirmedBookingUsage(tx, pre.organizationId, booking.id, now); }
        catch (error) {
          if (error instanceof BookingError && error.code === "BOOKING_LIMIT_REACHED") canConfirm = false;
          else throw error;
        }
      }
      bookingStatus = canConfirm ? "CONFIRMED" : "EXPIRED";
      await tx.update(bookings).set({ status: bookingStatus, updatedAt: now })
        .where(and(eq(bookings.organizationId, pre.organizationId), eq(bookings.id, booking.id)));
      const [history] = await tx.insert(bookingStatusHistory).values({ organizationId: pre.organizationId, bookingId: booking.id,
        previousStatus: "AWAITING_PAYMENT", newStatus: bookingStatus,
        reason: status === "PAID" && !canConfirm ? "Payment verified after hold expiry or booking limit; refund review required" : null }).returning({ id: bookingStatusHistory.id });
      if (bookingStatus === "CONFIRMED") await queueBookingNotification(tx, pre.organizationId, booking.id, history.id, "BOOKING_CONFIRMED");
    }
    if (status === "PAID") {
      await reconcilePaid(tx, pre.organizationId, booking.id, booking.totalAmount, now);
      if (bookingStatus !== "CONFIRMED") await audit(tx, pre.organizationId, "LATE_PAYMENT_REQUIRES_REFUND",
        { bookingId: booking.id, paymentId: payment.id });
    }
    return { duplicate: false, bookingStatus, paymentStatus: status };
  });
  if (!processed.duplicate && processed.bookingStatus === "CONFIRMED" && processed.paymentStatus === "PAID")
    await dispatchWithoutBlocking(db, pre.organizationId, pre.bookingId);
  return processed;
}
export async function handleTestWebhook(db: BookingDatabase, raw: string, signature: string, now = new Date()) {
  const event = testProvider.verifyWebhook(raw, signature, process.env.TEST_PAYMENT_WEBHOOK_SECRET ?? "");
  return processPaymentEvent(db, "TEST", event, now);
}
export function testEvent(paymentId: string, status: ProviderEvent["status"]) {
  return JSON.stringify({ eventId: randomUUID(), paymentId, status });
}


