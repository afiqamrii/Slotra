import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches, organizationSports, resources, sportTypes } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { SpaceManager } from "@/components/venue-management";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
export const dynamic = "force-dynamic";
export default async function CourtsPage() {
  const { organization, member } = await requirePermission("resource:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await venueSchemaReady(db)) return <VenueMigrationNotice />;
  const [branch] = await db.select().from(branches).where(eq(branches.organizationId, organizationId)).limit(1);
  const sports = await db.select({ id: sportTypes.id, name: sportTypes.name }).from(organizationSports).innerJoin(sportTypes, eq(organizationSports.sportTypeId, sportTypes.id)).where(eq(organizationSports.organizationId, organizationId)).orderBy(sportTypes.name);
  const spaces = await db.select().from(resources).where(eq(resources.organizationId, organizationId)).orderBy(resources.name);
  return <div className="foundation-page"><p className="eyebrow">VENUE</p><h1>Courts & Spaces</h1><p className="foundation-lead">Manage your bookable spaces and maintenance status. No booking availability is calculated here yet.</p>
    {branch ? <SpaceManager initial={spaces} sports={sports} branch={branch} canEdit={["OWNER", "ADMIN", "MANAGER"].includes(member.role)} /> : <p>Set up your first branch to add spaces.</p>}</div>;
}


