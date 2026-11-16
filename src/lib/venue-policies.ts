import { eq } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { recordAudit } from "@/lib/pro-access-service";
const policiesInput = z.object({ cancellationPolicy: z.string().trim().max(5000), refundPolicy: z.string().trim().max(5000), venueRules: z.string().trim().max(5000) });
export async function saveVenuePolicies(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  const member = await authorizedMembership(db, actorId, organizationId, "organization:update");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL") throw new Error("Permission denied");
  const values = policiesInput.parse(raw);
  await db.transaction(async tx => {
    await tx.update(organizations).set({ cancellationPolicy: values.cancellationPolicy || null,
      refundPolicy: values.refundPolicy || null, venueRules: values.venueRules || null, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "venue.policies_updated", entityType: "organization",
      entityId: organizationId, summary: "Updated public venue policies" });
  });
}
