import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { branches, organizations, resources, waitlistEntries } from "@/db/schema";
import { BookingError, evaluateAvailability, loadAvailabilitySnapshot, type BookingDatabase } from "@/lib/booking-availability";
import { deliverEmail, escapeEmailHtml, emailReady } from "@/lib/email-delivery";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";

const joinInput = z.object({
  branchId: z.uuid(), resourceId: z.uuid(), startAt: z.coerce.date(), endAt: z.coerce.date(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[0-9()\s-]{6,30}$/),
  email: z.email().optional().or(z.literal("")),
}).refine(value => value.endAt > value.startAt, "Choose a valid time");

export async function joinWaitlist(database: BookingDatabase, organizationId: string, raw: unknown, now = new Date()) {
  await requireOrganizationFeature(database, organizationId, "WAITLIST");
  const input = joinInput.parse(raw);
  const snapshot = await loadAvailabilitySnapshot(database, organizationId, input.branchId, [input.resourceId],
    new Date(input.startAt.getTime() - 86_400_000), new Date(input.endAt.getTime() + 86_400_000));
  const state = evaluateAvailability(snapshot, input.resourceId, input.startAt, input.endAt, now);
  if (state.reason !== "CONFLICT") throw new BookingError("WAITLIST_UNAVAILABLE", "Waitlist is available only for a full time");
  const [existing] = await database.select({ id: waitlistEntries.id }).from(waitlistEntries).where(and(
    eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.resourceId, input.resourceId),
    eq(waitlistEntries.startAt, input.startAt), eq(waitlistEntries.phone, input.phone),
    eq(waitlistEntries.status, "WAITING"))).limit(1);
  if (existing) return existing;
  const [entry] = await database.insert(waitlistEntries).values({
    organizationId, ...input, email: input.email || null,
  }).returning({ id: waitlistEntries.id });
  return entry;
}

/** Post-commit best effort. No hold is promised; booking engine remains the arbiter. */
export async function notifyNextWaitlisted(database: BookingDatabase, organizationId: string,
  resourceId: string, startAt: Date, endAt: Date, now = new Date()) {
  if (!await hasOrganizationFeature(database, organizationId, "WAITLIST") || !emailReady()) return { status: "NOT_CONFIGURED" as const };
  const candidate = await database.transaction(async tx => {
    const [entry] = await tx.select().from(waitlistEntries).where(and(
      eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.resourceId, resourceId),
      isNotNull(waitlistEntries.email),
      or(eq(waitlistEntries.status, "WAITING"), and(eq(waitlistEntries.status, "NOTIFIED"),
        isNull(waitlistEntries.notifiedAt),
        lt(waitlistEntries.updatedAt, new Date(now.getTime() - 5 * 60_000)))),
      lt(waitlistEntries.startAt, endAt),
      gt(waitlistEntries.endAt, startAt))).orderBy(waitlistEntries.createdAt)
      .for("update", { skipLocked: true }).limit(1);
    if (!entry?.email) return null;
    const snapshot = await loadAvailabilitySnapshot(tx, organizationId, entry.branchId, [entry.resourceId],
      new Date(entry.startAt.getTime() - 86_400_000), new Date(entry.endAt.getTime() + 86_400_000));
    if (!evaluateAvailability(snapshot, entry.resourceId, entry.startAt, entry.endAt, now).available) return null;
    const [venue] = await tx.select({ name: organizations.name, slug: organizations.slug })
      .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [space] = await tx.select({ name: resources.name }).from(resources).where(and(
      eq(resources.organizationId, organizationId), eq(resources.id, resourceId))).limit(1);
    const [branch] = await tx.select({ timezone: branches.timezone }).from(branches).where(and(
      eq(branches.organizationId, organizationId), eq(branches.id, entry.branchId))).limit(1);
    if (!venue?.slug || !space || !branch) return null;
    // PENDING is an internal claim, not a customer-facing promise. Failed delivery returns to WAITING.
    await tx.update(waitlistEntries).set({ status: "NOTIFIED", updatedAt: now })
      .where(and(eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.id, entry.id)));
    return { entry, venue, space, timezone: branch.timezone };
  });
  if (!candidate) return { status: "NO_ELIGIBLE_ENTRY" as const };
  const { entry, venue, space, timezone } = candidate;
  const date = new Intl.DateTimeFormat("en-MY", { timeZone: timezone, dateStyle: "medium",
    timeStyle: "short" }).format(entry.startAt);
  const url = `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/book/${venue.slug}`;
  const text = `A time you requested at ${venue.name} may be open: ${space.name}, ${date}. Book now at ${url}. The time is not reserved and may be taken by another customer.`;
  try {
    const sent = await deliverEmail({ to: entry.email!, subject: `A time may be open · ${venue.name}`,
      text, html: `<p>${escapeEmailHtml(text)}</p>`, idempotencyKey: entry.id });
    if (sent.status !== "SENT") throw new Error("Delivery not confirmed");
    await database.update(waitlistEntries).set({ status: "NOTIFIED", notifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.id, entry.id)));
    return { status: "SENT" as const };
  } catch {
    await database.update(waitlistEntries).set({ status: "WAITING", updatedAt: new Date() })
      .where(and(eq(waitlistEntries.organizationId, organizationId), eq(waitlistEntries.id, entry.id)));
    return { status: "FAILED" as const };
  }
}
