import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { organizationMembers, organizations, users } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { deliverEmail, emailReady } from "@/lib/email-delivery";
import { testEmailTemplate } from "@/lib/email-templates";
import { checkPublicRateLimit } from "@/lib/public-booking";

export async function sendAuthorizedTestEmail(db: BookingDatabase, actorId: string, organizationId: string) {
  if (!emailReady()) throw new Error("Email provider is not configured.");
  const [actor] = await db.select({ email: users.email, name: users.name, role: organizationMembers.role,
    venueName: organizations.name, displayName: organizations.displayName }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, actorId),
      eq(organizationMembers.status, "ACTIVE"))).limit(1);
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role)) throw new Error("Email test access denied.");
  await checkPublicRateLimit(db, `email-test:${organizationId}:${actorId}`, 3, 3_600_000);
  const template = testEmailTemplate({ venueName: actor.displayName || actor.venueName, recipientName: actor.name });
  const result = await deliverEmail({ to: actor.email, ...template, idempotencyKey: `test:${organizationId}:${randomUUID()}` });
  if (result.status !== "SENT") throw new Error(result.reason ?? "Email could not be delivered.");
  return { providerMessageId: result.providerMessageId };
}
