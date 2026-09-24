import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bookings, customers, customerTags } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";

export const segmentNames = {
  all: "All customers",
  new: "New customers",
  returning: "Returning customers",
  frequent: "Frequent players",
  high_spend: "High spenders",
  inactive_30: "Inactive 30 days",
  inactive_60: "Inactive 60 days",
} as const;
export type SegmentKey = keyof typeof segmentNames;
const segmentKeys = Object.keys(segmentNames) as [SegmentKey, ...SegmentKey[]];
const filterSchema = z.object({
  segment: z.enum(segmentKeys).default("all"),
  search: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
const tagInput = z.object({
  customerId: z.uuid(),
  label: z.string().trim().min(2).max(40)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'/-]*$/u, "Use letters, numbers, spaces or - / ' &"),
});
const tagIdInput = z.uuid();
const day = 86_400_000;
const activeStatuses = ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"] as const;

async function authorize(database: BookingDatabase, actorId: string, organizationId: string,
  permission: "customer:view" | "customer:manage" | "report:view") {
  if (!await authorizedMembership(database, actorId, organizationId, permission))
    throw new BookingError("PERMISSION_DENIED", "Customer insights access denied");
  await requireOrganizationFeature(database, organizationId, "CUSTOMER_SEGMENTATION");
}

type CustomerSummary = {
  id: string; name: string; phone: string; email: string | null;
  createdAt: Date; bookingCount: number; recent90Count: number; bookedValueMinor: number;
  lastPastAt: Date | null; futureCount: number; tags: { id: string; label: string }[];
};

/** Deterministic, booking-based segments. Cancelled, expired and no-show slots do not count as visits. */
export function classifyCustomer(summary: CustomerSummary, now: Date, highSpenderIds: ReadonlySet<string>) {
  const inactivityDays = summary.lastPastAt ? Math.floor((now.getTime() - summary.lastPastAt.getTime()) / day) : null;
  return {
    new: summary.createdAt.getTime() >= now.getTime() - 30 * day,
    returning: summary.bookingCount >= 2,
    frequent: summary.recent90Count >= 4,
    high_spend: highSpenderIds.has(summary.id),
    inactive_30: inactivityDays !== null && inactivityDays >= 30 && inactivityDays < 60 && summary.futureCount === 0,
    inactive_60: inactivityDays !== null && inactivityDays >= 60 && summary.futureCount === 0,
  };
}

/** Top decile by historical booked value, among customers with at least two non-cancelled bookings. */
export function highSpenderSet(items: Pick<CustomerSummary, "id" | "bookingCount" | "bookedValueMinor">[]) {
  const eligible = items.filter(item => item.bookingCount >= 2 && item.bookedValueMinor > 0)
    .sort((a, b) => b.bookedValueMinor - a.bookedValueMinor || a.id.localeCompare(b.id));
  return new Set(eligible.slice(0, Math.ceil(eligible.length / 10)).map(item => item.id));
}

export async function customerSegments(database: BookingDatabase, actorId: string, organizationId: string,
  raw: unknown = {}, now = new Date()) {
  await authorize(database, actorId, organizationId, "customer:view");
  if (!await authorizedMembership(database, actorId, organizationId, "report:view"))
    throw new BookingError("PERMISSION_DENIED", "Customer insights access denied");
  const filter = filterSchema.parse(raw);
  const since90 = new Date(now.getTime() - 90 * day);
  const rows = await database.select({
    id: customers.id, name: customers.name, phone: customers.phone, email: customers.email,
    createdAt: customers.createdAt,
    bookingCount: sql<number>`count(${bookings.id}) filter (where ${bookings.startAt} < ${now})::int`,
    recent90Count: sql<number>`count(${bookings.id}) filter (where ${bookings.startAt} >= ${since90} and ${bookings.startAt} < ${now})::int`,
    bookedValueMinor: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${bookings.startAt} < ${now}), 0)::int`,
    lastPastAt: sql<Date | null>`max(${bookings.startAt}) filter (where ${bookings.startAt} < ${now})`,
    futureCount: sql<number>`count(${bookings.id}) filter (where ${bookings.startAt} >= ${now})::int`,
  }).from(customers)
    .leftJoin(bookings, and(eq(bookings.organizationId, organizationId),
      eq(bookings.customerId, customers.id), inArray(bookings.status, activeStatuses)))
    .where(eq(customers.organizationId, organizationId))
    .groupBy(customers.id).orderBy(customers.name).limit(20_001);
  if (rows.length > 20_000)
    throw new BookingError("INSIGHTS_LIMIT", "This customer list is too large to display. Contact support for a data export.");
  const summaries: CustomerSummary[] = rows.map(row => ({
    ...row, bookingCount: Number(row.bookingCount), recent90Count: Number(row.recent90Count),
    bookedValueMinor: Number(row.bookedValueMinor), lastPastAt: row.lastPastAt ? new Date(row.lastPastAt) : null,
    futureCount: Number(row.futureCount), tags: [],
  }));
  const highSpenders = highSpenderSet(summaries);
  const counts: Record<SegmentKey, number> = {
    all: summaries.length, new: 0, returning: 0, frequent: 0, high_spend: 0, inactive_30: 0, inactive_60: 0,
  };
  for (const item of summaries) {
    const classification = classifyCustomer(item, now, highSpenders);
    for (const key of Object.keys(classification) as Exclude<SegmentKey, "all">[])
      if (classification[key]) counts[key] += 1;
  }
  const query = filter.search.toLocaleLowerCase();
  const matches = summaries.filter(item =>
    (filter.segment === "all" || classifyCustomer(item, now, highSpenders)[filter.segment]) &&
    (!query || [item.name, item.phone, item.email ?? ""].some(text => text.toLocaleLowerCase().includes(query))));
  const pageSize = 30;
  const selected = matches.slice((filter.page - 1) * pageSize, filter.page * pageSize);
  if (selected.length) {
    const tags = await database.select({ id: customerTags.id, customerId: customerTags.customerId, label: customerTags.label })
      .from(customerTags).where(and(eq(customerTags.organizationId, organizationId),
        inArray(customerTags.customerId, selected.map(item => item.id)))).orderBy(customerTags.label);
    const byCustomer = new Map<string, { id: string; label: string }[]>();
    for (const tag of tags) byCustomer.set(tag.customerId, [...(byCustomer.get(tag.customerId) ?? []),
      { id: tag.id, label: tag.label }]);
    for (const item of selected) item.tags = byCustomer.get(item.id) ?? [];
  }
  return { filter, counts, customers: selected, matched: matches.length, pageSize,
    regularInactive30: summaries.filter(item => item.bookingCount >= 3 && item.futureCount === 0 &&
      item.lastPastAt && now.getTime() - item.lastPastAt.getTime() >= 30 * day).length };
}

export async function addCustomerTag(database: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await authorize(database, actorId, organizationId, "customer:manage");
  const input = tagInput.parse(raw);
  const [customer] = await database.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, input.customerId))).limit(1);
  if (!customer) throw new BookingError("CUSTOMER_NOT_FOUND", "Customer not found at this venue");
  const [created] = await database.insert(customerTags).values({
    organizationId, customerId: input.customerId, label: input.label, createdByUserId: actorId,
  }).onConflictDoNothing().returning();
  return created ?? null;
}

export async function removeCustomerTag(database: BookingDatabase, actorId: string, organizationId: string, tagId: string) {
  await authorize(database, actorId, organizationId, "customer:manage");
  const id = tagIdInput.parse(tagId);
  const [deleted] = await database.delete(customerTags).where(and(
    eq(customerTags.organizationId, organizationId), eq(customerTags.id, id))).returning({ id: customerTags.id });
  if (!deleted) throw new BookingError("CUSTOMER_TAG_NOT_FOUND", "Tag not found at this venue");
  return deleted;
}
