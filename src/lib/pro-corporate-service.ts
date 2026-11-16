import { and, count, eq, sql } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { bookings, corporateAccounts, corporateCharges, corporateMembers, customers, organizations } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { createBooking } from "@/lib/booking-service";
import { localDateAt, localDayBounds } from "@/lib/booking-time";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { dispatchWithoutBlocking } from "@/lib/booking-notifications";
import { recordAudit } from "@/lib/pro-access-service";

const accountInput = z.object({ name: z.string().trim().min(2).max(160), billingEmail: z.email(),
  contactPerson: z.string().trim().max(120).optional(), billingTerms: z.string().trim().max(200).optional(),
  monthlyLimitMinor: z.number().int().min(0).max(2_000_000_000), allowOverage: z.boolean().default(false) });
const bookingInput = z.object({ accountId: z.uuid(), customerId: z.uuid(), branchId: z.uuid(),
  resourceId: z.uuid(), startAt: z.date(), endAt: z.date(), notes: z.string().trim().max(2000).optional() });

async function manageCorporate(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "CORPORATE_ACCOUNTS");
  const member = await authorizedMembership(db, actorId, organizationId, "customer:manage");
  if (!member || !["OWNER", "ADMIN", "MANAGER"].includes(member.role) || member.branchScope !== "ALL")
    throw new Error("Permission denied");
}

export async function createCorporateAccount(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await manageCorporate(db, actorId, organizationId);
  const input = accountInput.parse(raw);
  const [account] = await db.insert(corporateAccounts).values({ organizationId, ...input }).returning();
  await recordAudit(db, { organizationId, actorUserId: actorId, action: "corporate.created",
    entityType: "corporate_account", entityId: account.id, summary: `Created ${account.name} corporate account` });
  return account;
}

export async function addCorporateCustomer(db: BookingDatabase, actorId: string, organizationId: string,
  accountId: string, customerId: string) {
  await manageCorporate(db, actorId, organizationId);
  if (!z.uuid().safeParse(accountId).success || !z.uuid().safeParse(customerId).success) throw new Error("Invalid account or customer");
  const [[account], [customer]] = await Promise.all([
    db.select({ id: corporateAccounts.id }).from(corporateAccounts).where(and(eq(corporateAccounts.organizationId, organizationId),
      eq(corporateAccounts.id, accountId), eq(corporateAccounts.isActive, true))).limit(1),
    db.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, organizationId),
      eq(customers.id, customerId))).limit(1),
  ]);
  if (!account || !customer) throw new Error("Account or customer not found");
  await db.insert(corporateMembers).values({ organizationId, accountId, customerId }).onConflictDoNothing();
  await recordAudit(db, { organizationId, actorUserId: actorId, action: "corporate.customer_added",
    entityType: "corporate_account", entityId: accountId, summary: "Added an approved customer" });
}

export async function createCorporateBooking(db: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown, now = new Date()) {
  await requireOrganizationFeature(db, organizationId, "CORPORATE_ACCOUNTS");
  const input = bookingInput.parse(raw);
  if (!await authorizedMembership(db, actorId, organizationId, "booking:create", input.branchId))
    throw new BookingError("PERMISSION_DENIED", "Booking access denied");
  const [venue] = await db.select({ timezone: organizations.timezone }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!venue) throw new Error("Venue not found");
  const local = localDateAt(input.startAt, venue.timezone);
  const period = localDayBounds(Temporal.PlainDate.from({ year: local.year, month: local.month, day: 1 }), venue.timezone).from;
  const created = await db.transaction(async tx => {
    // The account row lock serializes credit checks across simultaneous branch bookings.
    const [account] = await tx.select().from(corporateAccounts).where(and(eq(corporateAccounts.organizationId, organizationId),
      eq(corporateAccounts.id, input.accountId), eq(corporateAccounts.isActive, true))).for("update").limit(1);
    if (!account) throw new Error("Corporate account not found");
    const [approved] = await tx.select({ id: corporateMembers.id }).from(corporateMembers).where(and(
      eq(corporateMembers.organizationId, organizationId), eq(corporateMembers.accountId, account.id),
      eq(corporateMembers.customerId, input.customerId))).limit(1);
    if (!approved) throw new Error("Customer is not approved for this corporate account");
    const booking = await createBooking(tx, actorId, organizationId, { branchId: input.branchId,
      resourceId: input.resourceId, customerId: input.customerId, startAt: input.startAt,
      endAt: input.endAt, source: "STAFF", notes: input.notes }, now, { deferDispatch: true });
    const [used] = await tx.select({ amount: sql<number>`coalesce(sum(${corporateCharges.amountMinor}), 0)::integer` })
      .from(corporateCharges).where(and(eq(corporateCharges.organizationId, organizationId),
        eq(corporateCharges.accountId, account.id), eq(corporateCharges.periodStartAt, period),
        eq(corporateCharges.status, "APPLIED")));
    if (!account.allowOverage && (used?.amount ?? 0) + booking.totalAmount > account.monthlyLimitMinor)
      throw new BookingError("CORPORATE_LIMIT", "This corporate account has reached its monthly allowance");
    await tx.insert(corporateCharges).values({ organizationId, accountId: account.id, bookingId: booking.id,
      customerId: input.customerId, periodStartAt: period, amountMinor: booking.totalAmount });
    await recordAudit(tx, { organizationId, branchId: input.branchId, actorUserId: actorId,
      action: "corporate.booking_charged", entityType: "booking", entityId: booking.id,
      summary: `Charged ${account.name} corporate allowance`, details: { amountMinor: booking.totalAmount } });
    return booking;
  });
  if (created.status === "CONFIRMED") await dispatchWithoutBlocking(db, organizationId, created.id);
  return created;
}

export async function listCorporateAccounts(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "CORPORATE_ACCOUNTS");
  if (!await authorizedMembership(db, actorId, organizationId, "report:view_financial")) throw new Error("Permission denied");
  const [venue] = await db.select({ timezone: organizations.timezone }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!venue) throw new Error("Venue not found");
  const local = localDateAt(new Date(), venue.timezone);
  const period = localDayBounds(Temporal.PlainDate.from({ year: local.year, month: local.month, day: 1 }), venue.timezone).from;
  const [accounts, usage, currentUsage] = await Promise.all([
    db.select().from(corporateAccounts).where(eq(corporateAccounts.organizationId, organizationId))
      .orderBy(corporateAccounts.name).limit(100),
    db.select({ accountId: corporateCharges.accountId,
      amountMinor: sql<number>`coalesce(sum(${corporateCharges.amountMinor}), 0)::integer`,
      bookings: count() }).from(corporateCharges).where(and(eq(corporateCharges.organizationId, organizationId),
      eq(corporateCharges.status, "APPLIED"))).groupBy(corporateCharges.accountId),
    db.select({ accountId: corporateCharges.accountId,
      amountMinor: sql<number>`coalesce(sum(${corporateCharges.amountMinor}), 0)::integer` })
      .from(corporateCharges).where(and(eq(corporateCharges.organizationId, organizationId),
        eq(corporateCharges.periodStartAt, period), eq(corporateCharges.status, "APPLIED")))
      .groupBy(corporateCharges.accountId),
  ]);
  const byId = new Map(usage.map(row => [row.accountId, row]));
  const currentById = new Map(currentUsage.map(row => [row.accountId, row.amountMinor]));
  return accounts.map(account => ({ ...account, totalValueMinor: byId.get(account.id)?.amountMinor ?? 0,
    bookingCount: byId.get(account.id)?.bookings ?? 0,
    currentUsageMinor: currentById.get(account.id) ?? 0 }));
}

export async function corporateChargeForBooking(db: BookingDatabase, actorId: string, organizationId: string,
  bookingId: string) {
  if (!await authorizedMembership(db, actorId, organizationId, "booking:view")) throw new Error("Permission denied");
  const [charge] = await db.select({ accountId: corporateCharges.accountId, name: corporateAccounts.name,
    amountMinor: corporateCharges.amountMinor, status: corporateCharges.status })
    .from(corporateCharges).innerJoin(corporateAccounts, and(eq(corporateCharges.organizationId, corporateAccounts.organizationId),
      eq(corporateCharges.accountId, corporateAccounts.id)))
    .innerJoin(bookings, and(eq(corporateCharges.organizationId, bookings.organizationId),
      eq(corporateCharges.bookingId, bookings.id)))
    .where(and(eq(corporateCharges.organizationId, organizationId), eq(corporateCharges.bookingId, bookingId))).limit(1);
  return charge ?? null;
}
