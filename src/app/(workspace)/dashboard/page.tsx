import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { requireOrganizationMember } from "@/lib/authorization";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { bookingSetup } from "@/lib/booking-management";
import { basicReport, starterPlanUsage } from "@/lib/starter-reporting";
import { bookingMoney } from "@/lib/booking-format";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { professionalReport } from "@/lib/professional-reporting";
import { ProfessionalDashboard } from "@/components/professional-dashboard";
import { authorizedMembership } from "@/lib/organization-service";
import { branchContext } from "@/lib/branch-context";
import { proExecutiveReport } from "@/lib/pro-reporting";
import { ProDashboard } from "@/components/pro-dashboard";
import { dashboardOperations } from "@/lib/dashboard-operations";
import { DashboardOperations } from "@/components/dashboard-operations";

export const metadata: Metadata = { title: "Home" };
export default async function DashboardPage() {
  const { organization, session } = await requireOrganizationMember();
  const db = getDb();
  if (!await venueSchemaReady(db)) return <VenueMigrationNotice />;
  const organizationId = organization.organizationId;
  const selectedBranch = await branchContext(db, organizationId, session.user.id);
  const branchId = selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined;
  const canViewReports = !!await authorizedMembership(db, session.user.id, organizationId, "report:view_financial", branchId);
  const [venueRows, hasAdvancedAnalytics] = await Promise.all([
    db.select({ completed: organizations.onboardingCompletedAt, currency: organizations.currency }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
    canViewReports ? hasOrganizationFeature(db, organizationId, "ADVANCED_ANALYTICS") : Promise.resolve(false),
  ]);
  const [venue] = venueRows;
  if (!venue?.completed) return <div className="foundation-page"><p className="eyebrow">WELCOME</p><h1>Let’s set up your venue</h1><p className="foundation-lead">Tell us about your venue and we’ll prepare the essentials. It takes about five minutes.</p><Link className="button button-primary" href="/onboarding">Set up venue</Link></div>;
  const [operationsData, createAccess, branchManageAccess] = await Promise.all([
    dashboardOperations(db, session.user.id, organizationId, branchId),
    authorizedMembership(db, session.user.id, organizationId, "booking:create", branchId),
    authorizedMembership(db, session.user.id, organizationId, "branch:manage"),
  ]);
  const operations = operationsData ? <DashboardOperations data={operationsData} /> : null;
  const name = session.user.name.split(" ")[0];
  if (hasAdvancedAnalytics && canViewReports && selectedBranch.canSwitch && selectedBranch.selected === "all") {
    const [report, usage] = await Promise.all([
      proExecutiveReport(db, session.user.id, organizationId, { range: "today" }),
      starterPlanUsage(db, organizationId),
    ]);
    return <ProDashboard name={name} report={report} currency={venue.currency}
      bookingLimit={usage.booking.included} bookingUsed={usage.booking.used} operations={operations}
      canManageBranches={!!branchManageAccess?.effectivePermissions.includes("branch:view")} />;
  }
  if (hasAdvancedAnalytics && canViewReports) {
    const [report, usage] = await Promise.all([
      professionalReport(db, organizationId, { range: "this_month", branchId }),
      starterPlanUsage(db, organizationId),
    ]);
    return <ProfessionalDashboard name={name} report={report}
      currency={venue.currency} bookingLimit={usage.booking.included} bookingUsed={usage.booking.used}
      operations={operations} canCreateBooking={!!createAccess} />;
  }
  const heading = <header className="starter-page-head"><div><p className="eyebrow">OVERVIEW</p><h1>Good to see you, {name}</h1><p>Here’s what’s happening at {organization.name} today.</p></div>
    <div className="starter-head-actions">{operationsData && <Link className="button button-secondary" href="/calendar">Calendar</Link>}{createAccess && <Link className="button button-primary booking-page-create" href="/bookings/new">New booking</Link>}</div></header>;
  // Basic reporting aggregates the organization, including branches retained after
  // downgrade. Branch-restricted staff still receive their operational dashboard.
  if (!canViewReports || !await authorizedMembership(db, session.user.id, organizationId, "report:view_financial"))
    return <div className="foundation-page starter-dashboard">{heading}{operations ?? <div className="foundation-card"><h2>Your workspace is ready</h2><p>Use the navigation to open the areas available to your role.</p></div>}</div>;
  const setup = await bookingSetup(db, session.user.id, organizationId, "report:view_financial");
  const timezone = setup.branches[0]?.timezone ?? "Asia/Kuala_Lumpur";
  const [today, month, usage] = await Promise.all([
    basicReport(db, organizationId, timezone, { range: "today" }),
    basicReport(db, organizationId, timezone, { range: "month" }),
    starterPlanUsage(db, organizationId),
  ]);
  const showUsage = usage.booking.stage !== "NORMAL";
  return <div className="foundation-page starter-dashboard">{heading}
    {showUsage && <div className={`starter-usage-banner ${usage.booking.stage === "LIMIT_REACHED" ? "critical" : ""}`}><div><strong>{usage.booking.stage === "LIMIT_REACHED" ? "Monthly booking limit reached" : usage.booking.stage === "GRACE" ? "You’re using your booking grace period" : `You’ve used ${usage.booking.used} of ${usage.booking.included} monthly bookings`}</strong><span>{usage.booking.stage === "LIMIT_REACHED" ? "New bookings are paused. Review your plan and contact support about an upgrade." : "Keep an eye on your usage as your venue gets busier."}</span></div><Link href="/settings/plan">View usage →</Link></div>}
    {operations}
    <h2>Business overview</h2><p className="starter-muted">Organization-wide totals · {timezone}</p>
    <section aria-label="Financial overview" className="starter-metric-grid"><div className="starter-metric"><span>Booking value today</span><strong>{bookingMoney(today.totals.bookingValue, setup.currency)}</strong><small>Excludes cancelled and expired</small></div><div className="starter-metric"><span>Collected for today</span><strong>{bookingMoney(today.totals.collected, setup.currency)}</strong><small>Payments applied to today’s bookings</small></div><div className="starter-metric"><span>Outstanding today</span><strong>{bookingMoney(today.totals.outstanding, setup.currency)}</strong><small>Balance on today’s bookings</small></div><div className="starter-metric"><span>Booking value this month</span><strong>{bookingMoney(month.totals.bookingValue, setup.currency)}</strong><small>Scheduled in this calendar month</small></div></section>
    <div className="starter-dashboard-columns"><section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">THIS MONTH</p><h2>At a glance</h2></div><Link href="/reports">Reports →</Link></div><div className="starter-month-grid"><div><span>Bookings scheduled</span><strong>{month.totals.bookings}</strong></div><div><span>Collected</span><strong>{bookingMoney(month.totals.collected, setup.currency)}</strong></div><div><span>Outstanding</span><strong>{bookingMoney(month.totals.outstanding, setup.currency)}</strong></div></div><p className="starter-muted">Payments are attributed to booking date. This is not a cash-flow statement.</p></section>
      <section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">YOUR PLAN</p><h2>Monthly booking usage</h2></div><Link href="/settings/plan">View usage →</Link></div><div className="starter-progress-label"><span>First confirmations</span><strong>{usage.booking.used} / {usage.booking.included}</strong></div><progress value={usage.booking.used} max={usage.booking.included} aria-label="Monthly booking usage" /><p className="starter-muted">Counts first confirmations in your monthly usage window, including bookings later cancelled. Your saved bookings remain available.</p></section></div>
  </div>;
}
