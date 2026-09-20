import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { starterPlanUsage } from "@/lib/starter-reporting";
import { planCatalog } from "@/lib/plan-catalog";

export default async function PlanUsagePage() {
  const { organization } = await requirePermission("organization:view");
  const usage = await starterPlanUsage(getDb(), organization.organizationId);
  const plan = planCatalog[usage.booking.plan];
  const meters = [{ label: "Bookings this month", used: usage.booking.used, limit: usage.booking.included },
    { label: "Active courts & spaces", ...usage.resources }, { label: "Active branches", ...usage.branches },
    { label: "Staff seats", ...usage.staff }];
  return <div className="foundation-page starter-plan-page"><Link className="text-link" href="/settings">← Settings</Link><p className="eyebrow">SETTINGS / PLAN & USAGE</p><h1>Plan & Usage</h1><p className="foundation-lead">See what your venue uses today and what’s included in your plan.</p>
    <section className="foundation-card starter-plan-card"><div><p className="eyebrow">CURRENT PLAN</p><h2>{plan.name}</h2><p>{plan.description}</p></div><strong>RM{plan.price}<small> / month</small></strong></section>
    <section className="foundation-card starter-panel"><h2>Current usage</h2><div className="starter-meter-list">{meters.map(item => <div key={item.label}><div className="starter-progress-label"><span>{item.label}</span><strong>{item.used} / {item.limit ?? "—"}</strong></div>{item.limit != null && <progress value={item.used} max={item.limit} aria-label={item.label} />}</div>)}</div><p className="starter-muted">Booking usage counts first confirmations in the current UTC calendar month, including bookings later cancelled. A small temporary grace allowance keeps bookings working after the included 200; it is not part of the advertised plan. Pending staff invitations reserve a seat even though this meter shows active staff.</p>{usage.booking.stage === "LIMIT_REACHED" && <p className="starter-limit-note">New bookings are paused until the next usage period or a plan change. Existing bookings remain available to manage.</p>}</section>
    {usage.booking.plan === "STARTER" && <section className="starter-premium-preview"><span>NEXT STEP</span><h2>Professional · RM129/month</h2><p>1,000 bookings per month, online payments and deposits, professional analytics, court utilisation, and richer reports.</p><Link className="button button-primary" href="/settings/plans">View Professional</Link><small>Plan upgrades and subscription checkout are not available yet. No charge will be made.</small></section>}
  </div>;
}
