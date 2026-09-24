import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { bookings, branches, customers, organizationMembers, payments, resources } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { localDateAt, localDayBounds } from "@/lib/booking-time";
import { getBookingUsage } from "@/lib/booking-usage";
import { planLimit } from "@/lib/plan-entitlements";

const dateInput = z.object({ range: z.enum(["today", "week", "month", "custom"]).default("month"),
  from: z.iso.date().optional(), to: z.iso.date().optional() });

export function reportWindow(raw: unknown, timezone: string, now = new Date()) {
  const input = dateInput.parse(raw);
  const today = localDateAt(now, timezone);
  let from = today;
  let to = today;
  if (input.range === "week") from = today.subtract({ days: today.dayOfWeek - 1 });
  if (input.range === "month") from = today.with({ day: 1 });
  if (input.range === "custom") {
    if (!input.from || !input.to) throw new Error("Choose both dates for a custom report.");
    from = Temporal.PlainDate.from(input.from); to = Temporal.PlainDate.from(input.to);
    if (Temporal.PlainDate.compare(from, to) > 0 || to.since(from).days > 366) throw new Error("Choose a date range of up to one year.");
  }
  const endDate = input.range === "week" ? from.add({ days: 7 }) :
    input.range === "month" ? from.add({ months: 1 }) : to.add({ days: 1 });
  return { range: input.range, fromDate: from.toString(), toDate: endDate.subtract({ days: 1 }).toString(),
    from: localDayBounds(from, timezone).from, to: localDayBounds(endDate, timezone).from };
}

export async function basicReport(db: BookingDatabase, organizationId: string, timezone: string, raw: unknown, now = new Date()) {
  const window = reportWindow(raw, timezone, now);
  const [totals] = await db.select({
    bookings: count(),
    completed: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED')`.mapWith(Number),
    cancelled: sql<number>`count(*) filter (where ${bookings.status} = 'CANCELLED')`.mapWith(Number),
    bookingValue: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} not in ('CANCELLED','EXPIRED')), 0)`.mapWith(Number),
    collected: sql<number>`coalesce(sum(${bookings.amountPaid}), 0)`.mapWith(Number),
    outstanding: sql<number>`coalesce(sum(greatest(${bookings.totalAmount} - ${bookings.amountPaid}, 0)) filter (where ${bookings.status} not in ('CANCELLED','EXPIRED')), 0)`.mapWith(Number),
  }).from(bookings).where(and(eq(bookings.organizationId, organizationId), gte(bookings.startAt, window.from), lt(bookings.startAt, window.to)));
  return { ...window, totals: totals ?? { bookings: 0, completed: 0, cancelled: 0, bookingValue: 0, collected: 0, outstanding: 0 } };
}

export async function basicReportSeries(db: BookingDatabase, organizationId: string, timezone: string,
  window: ReturnType<typeof reportWindow>) {
  const first = Temporal.PlainDate.from(window.fromDate);
  const last = Temporal.PlainDate.from(window.toDate);
  const monthly = last.since(first).days > 31;
  const format = monthly ? "YYYY-MM" : "YYYY-MM-DD";
  const bookingKey = sql<string>`to_char(${bookings.startAt} AT TIME ZONE ${timezone}, ${format})`;
  const customerKey = sql<string>`to_char(${customers.createdAt} AT TIME ZONE ${timezone}, ${format})`;
  const [bookingRows, customerRows] = await Promise.all([
    db.select({ key: bookingKey, bookings: count(),
      value: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} not in ('CANCELLED','EXPIRED')), 0)`.mapWith(Number) })
      .from(bookings).where(and(eq(bookings.organizationId, organizationId), gte(bookings.startAt, window.from), lt(bookings.startAt, window.to)))
      .groupBy(sql`1`).orderBy(sql`1`),
    db.select({ key: customerKey, customers: count() }).from(customers)
      .where(and(eq(customers.organizationId, organizationId), gte(customers.createdAt, window.from), lt(customers.createdAt, window.to)))
      .groupBy(sql`1`).orderBy(sql`1`),
  ]);
  const byBooking = new Map(bookingRows.map(row => [row.key, row]));
  const byCustomer = new Map(customerRows.map(row => [row.key, row.customers]));
  const result: { key: string; label: string; bookings: number; bookingValue: number; newCustomers: number }[] = [];
  let day = monthly ? first.with({ day: 1 }) : first;
  while (Temporal.PlainDate.compare(day, last) <= 0) {
    const key = monthly ? day.toString().slice(0, 7) : day.toString();
    const label = monthly ? new Intl.DateTimeFormat("en-MY", { month: "short", year: "2-digit" })
      .format(new Date(`${key}-01T00:00:00Z`)) : `${day.day} ${new Intl.DateTimeFormat("en-MY", { month: "short" }).format(new Date(`${key}T00:00:00Z`))}`;
    result.push({ key, label, bookings: byBooking.get(key)?.bookings ?? 0,
      bookingValue: byBooking.get(key)?.value ?? 0, newCustomers: byCustomer.get(key) ?? 0 });
    day = monthly ? day.add({ months: 1 }) : day.add({ days: 1 });
  }
  return result;
}

export async function starterPlanUsage(db: BookingDatabase, organizationId: string, now = new Date()) {
  const [booking, branchRows, resourceRows, seatRows, ownerRows] = await Promise.all([
    getBookingUsage(db, organizationId, now),
    db.select({ total: count() }).from(branches).where(and(eq(branches.organizationId, organizationId), eq(branches.isActive, true))),
    db.select({ total: count() }).from(resources).where(and(eq(resources.organizationId, organizationId), sql`${resources.status} <> 'DISABLED'`)),
    db.select({ total: count() }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE"), sql`${organizationMembers.role} <> 'OWNER'`)),
    db.select({ total: count() }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE"), eq(organizationMembers.role, "OWNER"))),
  ]);
  return { booking, branches: { used: branchRows[0]?.total ?? 0, limit: planLimit(booking.plan, "BRANCHES") },
    resources: { used: resourceRows[0]?.total ?? 0, limit: planLimit(booking.plan, "RESOURCES") },
    staff: { used: seatRows[0]?.total ?? 0, limit: planLimit(booking.plan, "STAFF_SEATS") },
    owners: { used: ownerRows[0]?.total ?? 0, limit: planLimit(booking.plan, "OWNER_SEATS") } };
}

export async function exportBookings(db: BookingDatabase, organizationId: string, from: Date, to: Date) {
  return db.select({ reference: bookings.bookingReference, startAt: bookings.startAt, endAt: bookings.endAt,
    resource: resources.name, customer: customers.name, phone: customers.phone, status: bookings.status,
    source: bookings.source, total: bookings.totalAmount, paid: bookings.amountPaid, currency: bookings.currency,
  }).from(bookings).innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(resources.organizationId, organizationId)))
    .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(customers.organizationId, organizationId)))
    .where(and(eq(bookings.organizationId, organizationId), gte(bookings.startAt, from), lt(bookings.startAt, to))).limit(10000);
}

export async function exportCustomers(db: BookingDatabase, organizationId: string) {
  return db.select({ name: customers.name, phone: customers.phone, email: customers.email,
    bookings: sql<number>`count(${bookings.id})`.mapWith(Number),
    bookingValue: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.status} not in ('CANCELLED','EXPIRED')), 0)`.mapWith(Number),
  }).from(customers).leftJoin(bookings, and(eq(customers.id, bookings.customerId), eq(bookings.organizationId, organizationId)))
    .where(eq(customers.organizationId, organizationId)).groupBy(customers.id).limit(10000);
}

export async function exportPayments(db: BookingDatabase, organizationId: string, from: Date, to: Date) {
  return db.select({ reference: bookings.bookingReference, method: payments.paymentMethod, amount: payments.amountMinor,
    status: payments.status, at: payments.createdAt, currency: payments.currency })
    .from(payments).innerJoin(bookings, and(eq(payments.bookingId, bookings.id), eq(bookings.organizationId, organizationId)))
    .where(and(eq(payments.organizationId, organizationId), gte(payments.createdAt, from), lt(payments.createdAt, to))).limit(10000);
}

export function csvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function csvDocument(headers: string[], rows: unknown[][]) {
  return "\uFEFF" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
