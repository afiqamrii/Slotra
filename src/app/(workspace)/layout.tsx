import type { ReactNode } from "react";
import { and, eq, isNotNull } from "drizzle-orm";
import { branches, organizations } from "@/db/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { getDb } from "@/db/client";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { TopBar } from "@/components/top-bar";
import { requireOrganizationMember } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, organization, memberships } = await requireOrganizationMember();
  const ready = await venueSchemaReady(getDb());
  const [publicVenue] = ready ? await getDb().select({ slug: organizations.slug }).from(organizations)
    .innerJoin(branches, and(eq(branches.organizationId, organizations.id), eq(branches.isActive, true)))
    .where(and(eq(organizations.id, organization.organizationId), eq(organizations.isActive, true),
      isNotNull(organizations.onboardingCompletedAt))).limit(1) : [];
  return <div className="workspace-shell">
    <AppSidebar publicBookingHref={publicVenue ? `/book/${publicVenue.slug}` : undefined} />
    <div className="workspace-main">
      <TopBar organization={organization} memberships={memberships} userName={session.user.name} />
      <main className="workspace-content" id="main-content">{ready ? children : <VenueMigrationNotice /> }</main>
    </div>
  </div>;
}





