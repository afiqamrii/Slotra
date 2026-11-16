import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches, organizationSports, resources, sportTypes } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { SpaceManager } from "@/components/venue-management";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { branchContext } from "@/lib/branch-context";
export const dynamic = "force-dynamic";
export default async function CourtsPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  const { organization, member, session } = await requirePermission("resource:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await venueSchemaReady(db)) return <VenueMigrationNotice />;
  const params = await searchParams;
  const selectedBranch = await branchContext(db, organizationId, session.user.id);
  const branchRows = await db.select().from(branches).where(eq(branches.organizationId, organizationId)).orderBy(branches.createdAt);
  const visibleBranches = branchRows.filter(item => selectedBranch.branches.some(allowed => allowed.id === item.id));
  const requestedBranch = params.branchId ?? (selectedBranch.selected !== "all" ? selectedBranch.selected : null);
  const branch = requestedBranch ? visibleBranches.find(item => item.id === requestedBranch) : visibleBranches[0];
  const sports = await db.select({ id: sportTypes.id, name: sportTypes.name }).from(organizationSports).innerJoin(sportTypes, eq(organizationSports.sportTypeId, sportTypes.id)).where(eq(organizationSports.organizationId, organizationId)).orderBy(sportTypes.name);
  const spaces = branch ? await db.select().from(resources).where(and(eq(resources.organizationId, organizationId), eq(resources.branchId, branch.id))).orderBy(resources.name) : [];
  return <div className="foundation-page"><p className="eyebrow">VENUE</p><h1>Courts & Spaces</h1><p className="foundation-lead">Manage your bookable spaces and maintenance status. No booking availability is calculated here yet.</p>
    {visibleBranches.length > 1 && <nav className="booking-tabs" aria-label="Branch">{visibleBranches.map(item => <Link key={item.id}
      className={item.id === branch?.id ? "booking-tab active" : "booking-tab"} href={`/courts-and-spaces?branchId=${item.id}`}>{item.name}</Link>)}</nav>}
    {branch ? <SpaceManager initial={spaces} sports={sports} branch={branch} canEdit={["OWNER", "ADMIN", "MANAGER"].includes(member.role)} /> : <p>Set up your first branch to add spaces.</p>}</div>;
}


