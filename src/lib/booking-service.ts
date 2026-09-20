import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { basePrices, bookingStatusHistory, bookings, customers, organizations, payments, resourceBlocks, resources, type BookingStatus } from "@/db/schema";
import { authorizedMembership } from "@/lib/organization-service";
import { availabilityInput, BookingError, evaluateAvailability, loadAvailabilitySnapshot, rangeInput, type BookingDatabase } from "@/lib/booking-availability";
import { minuteDuration } from "@/lib/booking-time";
import type { Permission } from "@/lib/permissions";
import { connectedCheckoutAccount, expireHoldsForResource, getPaymentPolicy } from "@/lib/payment-service";
import { paymentDue } from "@/lib/payment-policy";
import { testProvider } from "@/lib/payment-providers";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { getBookingUsage, recordConfirmedBookingUsage } from "@/lib/booking-usage";
import { dispatchWithoutBlocking, queueBookingNotification } from "@/lib/booking-notifications";

const createInput = availabilityInput.extend({
  customerId: z.uuid().nullable().optional(),
  newCustomer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(30).regex(/^[+0-9()\s-]+$/),
    email: z.union([z.email(), z.literal("")]).optional(),
  }).optional(),
  source: z.enum(["ONLINE", "STAFF", "WALK_IN", "IMPORT", "API"]),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(value => !(value.customerId && value.newCustomer), "Choose an existing or new customer, not both");
const rescheduleInput = rangeInput.extend({ resourceId: z.uuid().optional() });
const reasonInput = z.string().trim().max(500).nullable().optional();
const idInput = z.uuid();
const transitions: Partial<Record<BookingStatus, readonly BookingStatus[]>> = {
  PENDING: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  AWAITING_PAYMENT: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
};
export { transitions as allowedBookingTransitions };

function errorCode(error: unknown) {
  let current: unknown = error;
  for (let index = 0; index < 6 && current && typeof current === "object"; index++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}
function constraintName(error: unknown) {
  let current: unknown = error;
  for (let index = 0; index < 6 && current && typeof current === "object"; index++) {
    if ("constraint" in current && typeof current.constraint === "string") return current.constraint;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}
function translateConflict(error: unknown): never {
  if (errorCode(error) === "23P01") throw new BookingError("CONFLICT", "This space was just booked for that time");
  throw error;
}
async function requireBookingPermission(database: BookingDatabase, actorId: string, organizationId: string, permission: Permission) {
  if (!await authorizedMembership(database, actorId, organizationId, permission)) throw new BookingError("PERMISSION_DENIED", "Booking access denied");
}
async function lockSpace(database: BookingDatabase, organizationId: string, branchId: string, resourceId: string) {
  const [space] = await database.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.organizationId, organizationId), eq(resources.branchId, branchId), eq(resources.id, resourceId)))
    .for("update").limit(1);
  if (!space) throw new BookingError("RESOURCE_NOT_FOUND", "Space does not belong to this branch");
}
async function assertAvailable(database: BookingDatabase, organizationId: string, branchId: string, resourceId: string,
  startAt: Date, endAt: Date, now: Date, excludingBookingId?: string) {
  const snapshot = await loadAvailabilitySnapshot(database, organizationId, branchId, [resourceId],
    new Date(startAt.getTime() - 2 * 86_400_000), new Date(endAt.getTime() + 2 * 86_400_000));
  const result = evaluateAvailability(snapshot, resourceId, startAt, endAt, now, excludingBookingId);
  if (!result.available) {
    const messages: Record<string, string> = {
      RESOURCE_NOT_FOUND: "Space not found", RESOURCE_INACTIVE: "Space is not active",
      INVALID_DURATION: "Booking duration is not supported", ADVANCE_WINDOW: "Time is outside the booking window",
      CLOSED: "Venue is closed for that time", INTERVAL: "Start time does not match the booking interval",
      BLOCKED: "Space is blocked for that time", CONFLICT: "Space is already booked for that time",
    };
    throw new BookingError(result.reason, messages[result.reason] ?? "Time is unavailable");
  }
  return snapshot.spaces[0];
}
export async function baseQuote(database: BookingDatabase, organizationId: string, branchId: string, sportTypeId: string, duration: number) {
  const [[price], [organization]] = await Promise.all([
    database.select().from(basePrices).where(and(eq(basePrices.organizationId, organizationId),
      eq(basePrices.branchId, branchId), eq(basePrices.sportTypeId, sportTypeId))).limit(1),
    database.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
  ]);
  if (!price) throw new BookingError("PRICE_NOT_CONFIGURED", "Set a base price for this sport first");
  if (!organization) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found");
  const subtotal = Math.round(price.amountMinor * duration / price.durationMinutes);
  if (!Number.isSafeInteger(subtotal) || subtotal > 2_147_483_647)
    throw new BookingError("PRICE_TOO_HIGH", "Base price exceeds the supported booking amount");
  return { subtotal, currency: organization.currency };
}
function reference() { return `BK-${randomBytes(6).toString("hex").toUpperCase()}`; }

async function createBookingCore(database: BookingDatabase, actorId: string | null, organizationId: string, raw: unknown, now: Date, publicAccessTokenHash?: string, expectedPriceMinor?: number, publicPaymentChoice?: "PAY_AT_VENUE" | "ONLINE") {
  if (actorId) await requireBookingPermission(database, actorId, organizationId, "booking:create");
  const input = createInput.parse(raw);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await database.transaction(async tx => {
        await lockSpace(tx, organizationId, input.branchId, input.resourceId);
        await expireHoldsForResource(tx, organizationId, input.resourceId, now);
        const space = await assertAvailable(tx, organizationId, input.branchId, input.resourceId, input.startAt, input.endAt, now);
        if (!(await getBookingUsage(tx, organizationId, now)).canBook)
          throw new BookingError("BOOKING_LIMIT_REACHED", "Your venue has reached its monthly booking limit. View Plan & Usage for next steps.");
        if (input.customerId) {
          const [customer] = await tx.select({ id: customers.id }).from(customers)
            .where(and(eq(customers.organizationId, organizationId), eq(customers.id, input.customerId))).limit(1);
          if (!customer) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer does not belong to this venue");
        }
        const duration = minuteDuration(input.startAt, input.endAt)!;
        const { subtotal, currency } = await baseQuote(tx, organizationId, input.branchId, space.sportTypeId, duration);
        if (expectedPriceMinor !== undefined && subtotal !== expectedPriceMinor) throw new BookingError("PRICE_CHANGED", "The price changed. Please review the current price.");
        let customerId = input.customerId ?? null;
        if (input.newCustomer) {
          if (publicAccessTokenHash && input.newCustomer.email) {
            const [existing] = await tx.select({ id: customers.id }).from(customers).where(and(
              eq(customers.organizationId, organizationId), eq(customers.phone, input.newCustomer.phone),
              sql`lower(${customers.email}) = ${input.newCustomer.email.toLowerCase()}`,
              sql`lower(${customers.name}) = ${input.newCustomer.name.toLowerCase()}`,
            )).limit(1);
            customerId = existing?.id ?? null;
          }
          if (!customerId) {
            const [created] = await tx.insert(customers).values({ organizationId, name: input.newCustomer.name,
              phone: input.newCustomer.phone, email: input.newCustomer.email || null }).returning({ id: customers.id });
            customerId = created.id;
          }
        }
        const policy = publicAccessTokenHash ? await getPaymentPolicy(tx, organizationId) : null;
        if (policy && !policy.manualEnabled && (publicPaymentChoice === "PAY_AT_VENUE" || policy.requirement === "NO_UPFRONT"))
          throw new BookingError("PAYMENT_UNAVAILABLE", "This venue is not accepting pay-at-venue bookings");
        if (policy && publicPaymentChoice === "ONLINE" && policy.requirement === "NO_UPFRONT")
          throw new BookingError("PAYMENT_UNAVAILABLE", "Online payment is not offered for this booking");
        const payAtVenue = publicPaymentChoice === "PAY_AT_VENUE" || policy?.requirement === "NO_UPFRONT";
        const requiredNowMinor = policy && !payAtVenue ? paymentDue(subtotal, policy).requiredNowMinor : 0;
        if (policy && !payAtVenue && requiredNowMinor <= 0)
          throw new BookingError("PAYMENT_UNAVAILABLE", "A positive online amount is required for this booking");
        if (requiredNowMinor) {
          await requireOrganizationFeature(tx, organizationId, "ONLINE_PAYMENTS");
          if (policy?.requirement === "FIXED_DEPOSIT" || policy?.requirement === "PERCENT_DEPOSIT")
            await requireOrganizationFeature(tx, organizationId, "DEPOSITS");
        }
        const account = requiredNowMinor ? await connectedCheckoutAccount(tx, organizationId) : null;
        if (requiredNowMinor && (!account || !["TEST", "TOYYIBPAY_SANDBOX"].includes(account.provider)))
          throw new BookingError("PAYMENT_UNAVAILABLE", "Online payment is not available for this venue");
        if (account?.provider === "TOYYIBPAY_SANDBOX" && (currency !== "MYR" || requiredNowMinor < 100))
          throw new BookingError("PAYMENT_UNAVAILABLE", "ToyyibPay sandbox requires at least RM1 due now");
        const status = requiredNowMinor ? "AWAITING_PAYMENT" : "CONFIRMED";
        const holdExpiresAt = requiredNowMinor ? new Date(now.getTime() + policy!.holdMinutes * 60_000) : null;
        const [booking] = await tx.insert(bookings).values({
          organizationId, branchId: input.branchId, resourceId: input.resourceId, customerId,
          bookingReference: reference(), publicAccessTokenHash: publicAccessTokenHash ?? null,
          startAt: input.startAt, endAt: input.endAt, status,
          source: input.source, notes: input.notes ?? null, subtotal, totalAmount: subtotal,
          currency, paymentRequirement: payAtVenue ? "NO_UPFRONT" : policy?.requirement ?? "NO_UPFRONT", requiredNowMinor, holdExpiresAt,
          createdByUserId: actorId,
        }).returning();
        if (account) {
          const [payment] = await tx.insert(payments).values({
            organizationId, bookingId: booking.id, providerAccountId: account.id, provider: account.provider,
            amountMinor: requiredNowMinor, currency, status: "PENDING",
            type: policy?.requirement === "FULL" ? "FULL_PAYMENT" : "DEPOSIT",
          }).returning();
          // TestProvider is local-only; ToyyibPay network checkout starts after this transaction commits.
          if (account.provider === "TEST") {
            const checkout = await testProvider.createPayment({ paymentId: payment.id, amountMinor: requiredNowMinor, currency });
            await tx.update(payments).set({ providerPaymentId: checkout.providerPaymentId })
              .where(eq(payments.id, payment.id));
          }
        }
        const [history] = await tx.insert(bookingStatusHistory).values({
          organizationId, bookingId: booking.id, previousStatus: null, newStatus: status,
          changedByUserId: actorId, newStartAt: booking.startAt, newEndAt: booking.endAt,
        }).returning({ id: bookingStatusHistory.id });
        if (status === "CONFIRMED") {
          await recordConfirmedBookingUsage(tx, organizationId, booking.id, now);
          await queueBookingNotification(tx, organizationId, booking.id, history.id, "BOOKING_CONFIRMED");
        }
        return booking;
      });
      if (created.status === "CONFIRMED") await dispatchWithoutBlocking(database, organizationId, created.id);
      return created;
    } catch (error) {
      if (errorCode(error) === "23505" && constraintName(error) === "bookings_org_reference_uq" && attempt < 2) continue;
      translateConflict(error);
    }
  }
  throw new BookingError("REFERENCE_COLLISION", "Could not generate a booking reference");
}

export async function createBooking(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown, now = new Date()) {
  return createBookingCore(database, actorId, organizationId, raw, now);
}

// The public caller must resolve an active organization from its slug before using this.
export async function createGuestBooking(database: BookingDatabase, organizationId: string, raw: unknown, tokenHash: string, expectedPriceMinor: number, now = new Date(), paymentChoice?: "PAY_AT_VENUE" | "ONLINE") {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new BookingError("INVALID_TOKEN", "Invalid confirmation token");
  return createBookingCore(database, null, organizationId, raw, now, tokenHash, expectedPriceMinor, paymentChoice);
}
async function loadBookingForMutation(database: BookingDatabase, organizationId: string, bookingId: string) {
  const [booking] = await database.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND", "Booking not found");
  return booking;
}
export async function quoteReschedule(database: BookingDatabase, actorId: string, organizationId: string,
  bookingId: string, raw: unknown, now = new Date()) {
  await requireBookingPermission(database, actorId, organizationId, "booking:update");
  idInput.parse(bookingId);
  const input = rescheduleInput.parse(raw);
  const current = await loadBookingForMutation(database, organizationId, bookingId);
  if (!["PENDING", "AWAITING_PAYMENT", "CONFIRMED"].includes(current.status))
    throw new BookingError("INVALID_TRANSITION", "This booking cannot be rescheduled");
  const resourceId = input.resourceId ?? current.resourceId;
  const space = await assertAvailable(database, organizationId, current.branchId, resourceId,
    input.startAt, input.endAt, now, current.id);
  const duration = minuteDuration(input.startAt, input.endAt)!;
  const changed = resourceId !== current.resourceId || duration !== minuteDuration(current.startAt, current.endAt);
  if (changed && (current.amountPaid || current.discountAmount || current.taxAmount))
    throw new BookingError("REPRICE_UNSUPPORTED", "This booking has financial adjustments and cannot be repriced yet");
  const quote = changed ? await baseQuote(database, organizationId, current.branchId, space.sportTypeId, duration)
    : { subtotal: current.subtotal, currency: current.currency };
  const newTotal = changed ? quote.subtotal : current.totalAmount;
  return { currentTotal: current.totalAmount, newTotal, currency: quote.currency,
    priceChanged: newTotal !== current.totalAmount };
}

export async function rescheduleBooking(database: BookingDatabase, actorId: string, organizationId: string, bookingId: string, raw: unknown, now = new Date()) {
  await requireBookingPermission(database, actorId, organizationId, "booking:update");
  idInput.parse(bookingId);
  const input = rescheduleInput.parse(raw);
  try {
    const updated = await database.transaction(async tx => {
      const original = await loadBookingForMutation(tx, organizationId, bookingId);
      const targetResourceId = input.resourceId ?? original.resourceId;
      for (const id of [...new Set([original.resourceId, targetResourceId])].sort())
        await lockSpace(tx, organizationId, original.branchId, id);
      const [current] = await tx.select().from(bookings).where(and(eq(bookings.organizationId, organizationId),
        eq(bookings.id, bookingId))).for("update").limit(1);
      if (!current || current.resourceId !== original.resourceId)
        throw new BookingError("STALE_BOOKING", "This booking changed. Refresh and try again");
      if (!["PENDING", "AWAITING_PAYMENT", "CONFIRMED"].includes(current.status))
        throw new BookingError("INVALID_TRANSITION", "This booking cannot be rescheduled");
      if (current.status === "AWAITING_PAYMENT" && current.requiredNowMinor > 0) throw new BookingError("PAYMENT_REQUIRED", "Cancel this checkout before changing its time");
      await expireHoldsForResource(tx, organizationId, targetResourceId, now);
      const space = await assertAvailable(tx, organizationId, current.branchId, targetResourceId,
        input.startAt, input.endAt, now, current.id);
      const duration = minuteDuration(input.startAt, input.endAt)!;
      const changed = targetResourceId !== current.resourceId || duration !== minuteDuration(current.startAt, current.endAt);
      if (changed && (current.amountPaid || current.discountAmount || current.taxAmount))
        throw new BookingError("REPRICE_UNSUPPORTED", "This booking has financial adjustments and cannot be repriced yet");
      const quote = changed ? await baseQuote(tx, organizationId, current.branchId, space.sportTypeId, duration)
        : { subtotal: current.subtotal, currency: current.currency };
      const [updated] = await tx.update(bookings).set({
        resourceId: targetResourceId, startAt: input.startAt, endAt: input.endAt,
        subtotal: quote.subtotal, totalAmount: changed ? quote.subtotal : current.totalAmount, updatedAt: now,
      }).where(and(eq(bookings.id, current.id), eq(bookings.organizationId, organizationId))).returning();
      const [history] = await tx.insert(bookingStatusHistory).values({
        organizationId, bookingId, eventType: "RESCHEDULED", previousStatus: current.status, newStatus: current.status,
        previousStartAt: current.startAt, previousEndAt: current.endAt,
        newStartAt: input.startAt, newEndAt: input.endAt,
        previousResourceId: current.resourceId, newResourceId: targetResourceId,
        previousTotalAmount: current.totalAmount, newTotalAmount: changed ? quote.subtotal : current.totalAmount,
        changedByUserId: actorId,
      }).returning({ id: bookingStatusHistory.id });
      if (updated.status === "CONFIRMED") await queueBookingNotification(tx, organizationId, bookingId, history.id, "BOOKING_RESCHEDULED");
      return updated;
    });
    if (updated.status === "CONFIRMED") await dispatchWithoutBlocking(database, organizationId, updated.id);
    return updated;
  } catch (error) { translateConflict(error); }
}
export async function transitionBooking(database: BookingDatabase, actorId: string, organizationId: string, bookingId: string,
  newStatus: BookingStatus, rawReason?: unknown, now = new Date()) {
  const permission: Permission = newStatus === "CANCELLED" ? "booking:cancel" : newStatus === "CHECKED_IN" ? "booking:check_in" : "booking:update";
  await requireBookingPermission(database, actorId, organizationId, permission);
  idInput.parse(bookingId);
  const status = z.enum(["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED"]).parse(newStatus);
  const reason = reasonInput.parse(rawReason);
  try {
    const updated = await database.transaction(async tx => {
      const original = await loadBookingForMutation(tx, organizationId, bookingId);
      await lockSpace(tx, organizationId, original.branchId, original.resourceId);
      const [current] = await tx.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).for("update").limit(1);
      if (!current || !transitions[current.status as BookingStatus]?.includes(status)) throw new BookingError("INVALID_TRANSITION", "That booking status change is not allowed");
      if (status === "CONFIRMED" && current.requiredNowMinor > current.amountPaid) throw new BookingError("PAYMENT_REQUIRED", "Verified payment is required to confirm this booking");
      if (status === "CONFIRMED") await assertAvailable(tx, organizationId, current.branchId, current.resourceId, current.startAt, current.endAt, now, current.id);
      const [updated] = await tx.update(bookings).set({
        status, updatedAt: now, ...(status === "CANCELLED" ? { cancelledAt: now, cancellationReason: reason ?? null } : {}),
      }).where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId))).returning();
      const [history] = await tx.insert(bookingStatusHistory).values({
        organizationId, bookingId, previousStatus: current.status, newStatus: status,
        changedByUserId: actorId, reason: reason ?? null,
      }).returning({ id: bookingStatusHistory.id });
      if (status === "CONFIRMED") {
        await recordConfirmedBookingUsage(tx, organizationId, bookingId, now);
        await queueBookingNotification(tx, organizationId, bookingId, history.id, "BOOKING_CONFIRMED");
      } else if (status === "CANCELLED") await queueBookingNotification(tx, organizationId, bookingId, history.id, "BOOKING_CANCELLED");
      return updated;
    });
    if (["CONFIRMED", "CANCELLED"].includes(updated.status)) await dispatchWithoutBlocking(database, organizationId, updated.id);
    return updated;
  } catch (error) { translateConflict(error); }
}
export const confirmBooking = (db: BookingDatabase, actorId: string, organizationId: string, bookingId: string, now?: Date) =>
  transitionBooking(db, actorId, organizationId, bookingId, "CONFIRMED", undefined, now);
export const checkInBooking = (db: BookingDatabase, actorId: string, organizationId: string, bookingId: string, now?: Date) =>
  transitionBooking(db, actorId, organizationId, bookingId, "CHECKED_IN", undefined, now);
export const completeBooking = (db: BookingDatabase, actorId: string, organizationId: string, bookingId: string, now?: Date) =>
  transitionBooking(db, actorId, organizationId, bookingId, "COMPLETED", undefined, now);
export const noShowBooking = (db: BookingDatabase, actorId: string, organizationId: string, bookingId: string, now?: Date) =>
  transitionBooking(db, actorId, organizationId, bookingId, "NO_SHOW", undefined, now);
export const cancelBooking = (db: BookingDatabase, actorId: string, organizationId: string, bookingId: string, reason?: string, now?: Date) =>
  transitionBooking(db, actorId, organizationId, bookingId, "CANCELLED", reason, now);

export async function createResourceBlock(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireBookingPermission(database, actorId, organizationId, "resource:manage");
  const input = availabilityInput.extend({
    type: z.enum(["MANUAL", "MAINTENANCE", "PRIVATE_EVENT", "OTHER"]), reason: z.string().trim().max(500).nullable().optional(),
  }).parse(raw);
  return database.transaction(async tx => {
    await lockSpace(tx, organizationId, input.branchId, input.resourceId);
    await expireHoldsForResource(tx, organizationId, input.resourceId, new Date());
    const [conflict] = await tx.select({ id: bookings.id }).from(bookings).where(and(
      eq(bookings.organizationId, organizationId), eq(bookings.resourceId, input.resourceId),
      sql`(${bookings.status} in ('CONFIRMED','CHECKED_IN','IN_PROGRESS') or (${bookings.status} = 'AWAITING_PAYMENT' and ${bookings.holdExpiresAt} is not null))`,
      sql`${bookings.startAt} < ${input.endAt} and ${bookings.endAt} > ${input.startAt}`,
    )).limit(1);
    if (conflict) throw new BookingError("CONFLICT", "An active booking overlaps this block");
    const [block] = await tx.insert(resourceBlocks).values({ organizationId, branchId: input.branchId,
      resourceId: input.resourceId, startAt: input.startAt, endAt: input.endAt,
      type: input.type, reason: input.reason ?? null, createdBy: actorId }).returning();
    return block;
  });
}







