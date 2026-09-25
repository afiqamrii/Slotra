import type { ReactNode } from "react";
import { and, eq, isNotNull } from "drizzle-orm";
import { branches, organizations } from "@/db/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { getDb } from "@/db/client";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { TopBar } from "@/components/top-bar";
import { requireOrganizationMember } from "@/lib/authorization";
import { organizationPlan } from "@/lib/organization-entitlements";
import { branchContext } from "@/lib/branch-context";
import { authorizedMembership } from "@/lib/organization-service";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, organization, memberships } = await requireOrganizationMember();
  const db = getDb();
  const ready = await venueSchemaReady(db);
  const [plan, publicVenues, branchSelection] = await Promise.all([
    organizationPlan(db, organization.organizationId),
    ready ? db.select({ slug: organizations.slug }).from(organizations)
      .innerJoin(branches, and(eq(branches.organizationId, organizations.id), eq(branches.isActive, true)))
      .where(and(eq(organizations.id, organization.organizationId), eq(organizations.isActive, true),
        isNotNull(organizations.onboardingCompletedAt))).limit(1) : Promise.resolve([]),
    ready ? branchContext(db, organization.organizationId, session.user.id) : Promise.resolve({ branches: [], selected: null, canSwitch: false }),
  ]);
  const canCreateBooking = ready && !!await authorizedMembership(db, session.user.id, organization.organizationId,
    "booking:create", branchSelection.selected !== "all" ? branchSelection.selected ?? undefined : undefined);
  const [publicVenue] = publicVenues;
  return <div className="workspace-shell">
    <AppSidebar publicBookingHref={publicVenue ? `/book/${publicVenue.slug}` : undefined} plan={plan} />
    <div className="workspace-main">
      <TopBar organization={organization} memberships={memberships} userName={session.user.name} plan={plan}
        canCreateBooking={canCreateBooking}
        publicBookingHref={publicVenue ? `/book/${publicVenue.slug}` : undefined}
        branchSelection={branchSelection} />
      <main className="workspace-content" id="main-content">{ready ? children : <VenueMigrationNotice /> }</main>
    </div>
  </div>;
}





