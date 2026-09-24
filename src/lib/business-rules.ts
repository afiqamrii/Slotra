import { eq } from "drizzle-orm";
import { z } from "zod";
import { businessBookingPolicies } from "@/db/schema";
import { BookingError, type BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";

const policyInput = z.object({
  minimumNoticeMinutes: z.number().int().min(0).max(10080).nullable(),
  maximumAdvanceDays: z.number().int().min(1).max(365).nullable(),
  maximumDurationMinutes: z.number().int().min(30).max(1440).nullable(),
  bookingBufferMinutes: z.number().int().min(0).max(180),
  cancellationCutoffMinutes: z.number().int().min(0).max(10080).nullable(),
  rescheduleCutoffMinutes: z.number().int().min(0).max(10080).nullable(),
});
export async function updateBusinessPolicy(database: BookingDatabase, actorId: string,
  organizationId: string, raw: unknown) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:update"))
    throw new BookingError("PERMISSION_DENIED", "Booking settings access denied");
  await requireOrganizationFeature(database, organizationId, "ADVANCED_BOOKING_RULES");
  const input = policyInput.parse(raw);
  const [saved] = await database.insert(businessBookingPolicies).values({ organizationId, ...input })
    .onConflictDoUpdate({ target: businessBookingPolicies.organizationId,
      set: { ...input, updatedAt: new Date() } }).returning();
  return saved;
}
export async function getBusinessPolicy(database: BookingDatabase, organizationId: string) {
  if (!await hasOrganizationFeature(database, organizationId, "ADVANCED_BOOKING_RULES")) return null;
  const [policy] = await database.select().from(businessBookingPolicies)
    .where(eq(businessBookingPolicies.organizationId, organizationId)).limit(1);
  return policy ?? null;
}
