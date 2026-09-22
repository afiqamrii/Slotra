import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { requireOrganizationMember } from "@/lib/authorization";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";
import { venueSchemaReady } from "@/lib/venue-schema";
import { bookingSetup, listStaffBookings, staffAvailableNow } from "@/lib/booking-management";
import { basicReport, starterPlanUsage } from "@/lib/starter-reporting";
import { bookingMoney, bookingTime } from "@/lib/booking-format";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { professionalReport } from "@/lib/professional-reporting";
import { ProfessionalDashboard } from "@/components/professional-dashboard";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Home" };
export default async function DashboardPage() {
  const { organization, session } = await requireOrganizationMember();
  const db = getDb();
  if (!await venueSchemaReady(db)) return <VenueMigrationNotice />;
  const organizationId = organization.organizationId;
  const canViewReports = hasPermission(organization.role, "report:view");
  const [venueRows, hasAdvancedAnalytics] = await Promise.all([
    db.select({ completed: organizations.onboardingCompletedAt, currency: organizations.currency }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
    canViewReports ? hasOrganizationFeature(db, organizationId, "ADVANCED_ANALYTICS") : Promise.resolve(false),
  ]);
  const [venue] = venueRows;
  if (!venue?.completed) return <div className="foundation-page"><p className="eyebrow">WELCOME</p><h1>Let’s set up your venue</h1><p className="foundation-lead">Tell us about your venue and we’ll prepare the essentials. It takes about five minutes.</p><Link className="button button-primary" href="/onboarding">Set up venue</Link></div>;
  if (hasAdvancedAnalytics) {
    const [report, usage] = await Promise.all([
      professionalReport(db, organizationId, { range: "this_month" }),
      starterPlanUsage(db, organizationId),
    ]);
    return <ProfessionalDashboard name={session.user.name.split(" ")[0]} report={report}
      currency={venue.currency} bookingLimit={usage.booking.included} bookingUsed={usage.booking.used} />;
  }
  const setup = await bookingSetup(db, session.user.id, organizationId);
  const timezone = setup.branches[0]?.timezone ?? "Asia/Kuala_Lumpur";
  const [today, month, schedule, courtStatus, usage] = await Promise.all([
    basicReport(db, organizationId, timezone, { range: "today" }),
    basicReport(db, organizationId, timezone, { range: "month" }),
    listStaffBookings(db, session.user.id, organizationId, { view: "today" }),
    staffAvailableNow(db, session.user.id, organizationId),
    starterPlanUsage(db, organizationId),
  ]);
  const currency = setup.currency;
  const inUse = courtStatus.spaces.filter(space => space.state === "IN_USE").length;
  const outstandingCount = schedule.rows.filter(row => row.totalAmount > row.amountPaid && row.status !== "CANCELLED").length;
  const maintenanceCount = courtStatus.spaces.filter(space => space.state === "MAINTENANCE" || space.state === "BLOCKED").length;
  const showUsage = usage.booking.stage !== "NORMAL";
  return <div className="foundation-page starter-dashboard">
    <header className="starter-page-head"><div><p className="eyebrow">OVERVIEW</p><h1>Good to see you, {session.user.name.split(" ")[0]}</h1><p>Here’s what’s happening at {organization.name} today.</p></div><div className="starter-head-actions"><Link className="button button-secondary" href="/calendar">Calendar</Link><Link className="button button-primary" href="/bookings/new">New booking</Link></div></header>
    {showUsage && <div className={`starter-usage-banner ${usage.booking.stage === "LIMIT_REACHED" ? "critical" : ""}`}><div><strong>{usage.booking.stage === "LIMIT_REACHED" ? "Monthly booking limit reached" : usage.booking.stage === "GRACE" ? "You’re using your booking grace period" : `You’ve used ${usage.booking.used} of ${usage.booking.included} monthly bookings`}</strong><span>{usage.booking.stage === "LIMIT_REACHED" ? "New bookings are paused. Review your plan and contact support about an upgrade." : "Keep an eye on your usage as your venue gets busier."}</span></div><Link href="/settings/plan">View usage →</Link></div>}
    <section aria-label="Today" className="starter-metric-grid"><div className="starter-metric"><span>Today’s bookings</span><strong>{today.totals.bookings}</strong><small>Bookings scheduled today</small></div><div className="starter-metric"><span>Booking value today</span><strong>{bookingMoney(today.totals.bookingValue, currency)}</strong><small>Excludes cancelled and expired</small></div><div className="starter-metric"><span>Collected today’s bookings</span><strong>{bookingMoney(today.totals.collected, currency)}</strong><small>Payments applied to these bookings</small></div><div className="starter-metric"><span>Courts in use</span><strong>{inUse} <small>/ {courtStatus.spaces.length}</small></strong><small>Live status right now</small></div></section>
    <div className="starter-dashboard-columns"><section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">TODAY</p><h2>Booking schedule</h2></div><Link href="/bookings">View all →</Link></div>{schedule.rows.length ? <div className="starter-schedule">{schedule.rows.slice(0, 6).map(row => <Link key={row.id} href={`/bookings/${row.id}`}><span className="starter-schedule-time">{bookingTime(row.startAt, timezone)}</span><span><strong>{row.customerName ?? "Walk-in guest"}</strong><small>{row.resourceName} · {row.reference}</small></span><span className="starter-schedule-status">{row.status.replaceAll("_", " ")}</span></Link>)}</div> : <p className="starter-empty">No bookings today. Online and walk-in bookings will appear here.</p>}</section>
      <section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">RIGHT NOW</p><h2>Courts & spaces</h2></div><Link href="/available-now">View all →</Link></div>{courtStatus.spaces.length ? <div className="starter-court-list">{courtStatus.spaces.slice(0, 8).map(space => <div key={space.id}><span>{space.name}</span><strong data-state={space.state}>{space.state.replaceAll("_", " ")}</strong></div>)}</div> : <p className="starter-empty">Your courts and spaces will appear here once added.</p>}</section></div>
    <div className="starter-dashboard-columns"><section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">THIS MONTH</p><h2>At a glance</h2></div><Link href="/reports">Reports →</Link></div><div className="starter-month-grid"><div><span>Bookings received</span><strong>{usage.booking.used}</strong></div><div><span>Booking value</span><strong>{bookingMoney(month.totals.bookingValue, currency)}</strong></div><div><span>Collected</span><strong>{bookingMoney(month.totals.collected, currency)}</strong></div></div><div className="starter-progress-label"><span>Plan usage</span><strong>{usage.booking.used} / {usage.booking.included}</strong></div><progress value={usage.booking.used} max={usage.booking.included} aria-label="Monthly booking usage" /><small className="starter-muted">Counts first confirmations this UTC month, including bookings later cancelled.</small></section>
      <section className="foundation-card starter-panel"><div className="starter-panel-heading"><div><p className="eyebrow">NEEDS ATTENTION</p><h2>Quick checks</h2></div></div><div className="starter-attention"><Link href="/bookings"><strong>{outstandingCount}</strong><span>Today’s bookings with a balance due</span>→</Link><Link href="/available-now"><strong>{maintenanceCount}</strong><span>Spaces in maintenance or blocked now</span>→</Link></div></section></div>
  </div>;
}
