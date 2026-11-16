import type { ReactNode } from "react";
import type { Metadata } from "next";
import { and, eq, isNotNull } from "drizzle-orm";
import { branches, organizations } from "@/db/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { getDb } from "@/db/client";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { TopBar } from "@/components/top-bar";
import { requireOrganizationMember } from "@/lib/authorization";
import { organizationBillingAccess } from "@/lib/subscription-access";
import Link from "next/link";
import { branchContext } from "@/lib/branch-context";
import { authorizedMembership } from "@/lib/organization-service";
import { publicBookingUrl } from "@/lib/product-urls";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { session, organization, memberships } = await requireOrganizationMember();
  const db = getDb();
  if (!await venueSchemaReady(db)) return <main className="workspace-content" id="main-content"><VenueMigrationNotice /></main>;
  const [billing, publicVenues, branchSelection] = await Promise.all([
    organizationBillingAccess(db, organization.organizationId),
    db.select({ slug: organizations.slug }).from(organizations)
      .innerJoin(branches, and(eq(branches.organizationId, organizations.id), eq(branches.isActive, true)))
      .where(and(eq(organizations.id, organization.organizationId), eq(organizations.isActive, true),
        isNotNull(organizations.onboardingCompletedAt))).limit(1),
    branchContext(db, organization.organizationId, session.user.id),
  ]);
  const plan = billing.plan;
  const selectedBranchId = branchSelection.selected !== "all" ? branchSelection.selected ?? undefined : undefined;
  // Match page guards: customers and teammates are tenant-wide; operations use the selected branch.
  // Basic reports remain tenant-wide, while advanced reports explicitly support a selected branch.
  const [venueAccess, bookingAccess, bookingCreateAccess, customerAccess, resourceAccess, paymentAccess,
    reportAccess, teamAccess, billingAccess] = await Promise.all([
    authorizedMembership(db, session.user.id, organization.organizationId, "organization:view"),
    authorizedMembership(db, session.user.id, organization.organizationId, "booking:view", selectedBranchId),
    authorizedMembership(db, session.user.id, organization.organizationId, "booking:create", selectedBranchId),
    authorizedMembership(db, session.user.id, organization.organizationId, "customer:view"),
    authorizedMembership(db, session.user.id, organization.organizationId, "resource:view", selectedBranchId),
    authorizedMembership(db, session.user.id, organization.organizationId, "payment:view", selectedBranchId),
    authorizedMembership(db, session.user.id, organization.organizationId, "report:view_financial",
      billing.features.ADVANCED_REPORTS ? selectedBranchId : undefined),
    authorizedMembership(db, session.user.id, organization.organizationId, "member:view"),
    authorizedMembership(db, session.user.id, organization.organizationId, "billing:view"),
  ]);
  const allowedHrefs = ["/dashboard",
    ...(bookingAccess ? ["/bookings", "/calendar"] : []),
    ...(customerAccess ? ["/customers"] : []),
    ...(resourceAccess ? ["/courts-and-spaces"] : []),
    ...(paymentAccess ? ["/payments"] : []),
    ...(reportAccess ? ["/reports"] : []),
    ...(venueAccess ? ["/grow", "/settings"] : []),
  ];
  const teamVisible = Boolean(teamAccess);
  const planHref = venueAccess ? "/settings/plan" : undefined;
  const workspaceBranches = { ...branchSelection, canViewAll: venueAccess?.branchScope === "ALL" && billing.features.MULTI_BRANCH };
  const [publicVenue] = publicVenues;
  return <div className="workspace-shell">
    <AppSidebar publicBookingHref={publicVenue ? publicBookingUrl(publicVenue.slug) : undefined} plan={plan}
      allowedHrefs={allowedHrefs} teamVisible={teamVisible} planHref={planHref} />
    <div className="workspace-main">
      <TopBar organization={organization} memberships={memberships} userName={session.user.name} plan={plan}
        canCreateBooking={Boolean(bookingCreateAccess)} allowedHrefs={allowedHrefs} teamVisible={teamVisible} planHref={planHref}
        publicBookingHref={publicVenue ? publicBookingUrl(publicVenue.slug) : undefined}
        branchSelection={workspaceBranches} />
      <main className="workspace-content" id="main-content">
        {billingAccess && ["OWNER", "ADMIN"].includes(billingAccess.role) && (billing.status === "TRIALING" || !billing.writable || ["PAST_DUE", "GRACE"].includes(billing.status)) && <div className={billing.writable && billing.status === "TRIALING" ? "billing-trial" : "billing-alert"}>
          <strong>{!billing.writable ? "Venue operations are paused" : billing.status === "TRIALING" ? `${billing.trialDaysRemaining} days left in your Professional trial` : "Your subscription renewal needs attention"}</strong>
          <Link className="text-link" href="/settings/billing">Review Billing →</Link></div>}
        {children}</main>
    </div>
  </div>;
}





