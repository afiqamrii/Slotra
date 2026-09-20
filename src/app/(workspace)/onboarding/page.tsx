import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations, sportTypes } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { VenueWizard } from "@/components/venue-wizard";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const { organization } = await requirePermission("organization:update");
  const db = getDb();
  if (!await venueSchemaReady(db)) return <VenueMigrationNotice />;
  const [venue] = await db.select().from(organizations).where(eq(organizations.id, organization.organizationId)).limit(1);
  if (venue.onboardingCompletedAt) redirect("/dashboard");
  const catalog = await db.select({ id: sportTypes.id, name: sportTypes.name, code: sportTypes.code }).from(sportTypes).where(eq(sportTypes.isActive, true)).orderBy(sportTypes.name);
  return <div className="venue-page"><VenueWizard organizationId={venue.id} name={venue.name} slug={venue.slug} catalog={catalog} /></div>;
}

