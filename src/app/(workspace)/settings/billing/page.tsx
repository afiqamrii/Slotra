import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CreditCard, ArrowUpRight } from "lucide-react";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { billingDetails } from "@/lib/subscription-service";
import { starterPlanUsage } from "@/lib/starter-reporting";
import { planDefinitions, subscriptionPrice, type BillingCycle } from "@/lib/plan-entitlements";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { changeBillingAction } from "./actions";

const date = (at: Date) => new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "UTC" }).format(at);
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const { session, organization } = await requireOrganizationMember();
  if (!["OWNER", "ADMIN"].includes(organization.role)) notFound();
  const db = getDb();
  const [data, usage, params] = await Promise.all([billingDetails(db, session.user.id, organization.organizationId),
    starterPlanUsage(db, organization.organizationId), searchParams]);
  const subscription = data.subscription, plan = planDefinitions[data.plan];
  const cycle = (subscription?.billingCycle ?? "MONTHLY") as BillingCycle;
  const owner = organization.role === "OWNER", simulator = developmentBillingEnabled();
  const meters = [{ label: "Confirmed bookings", used: usage.booking.used, limit: usage.booking.included },
    { label: "Courts & spaces", ...usage.resources }, { label: "Branches", ...usage.branches }, { label: "Staff", ...usage.staff }];
  return <div className="foundation-page billing-page">
    <Link className="text-link" href="/settings">← Settings</Link>
    <header className="billing-heading"><div><p className="eyebrow">SETTINGS / BILLING</p><h1>Your plan, clearly</h1><p className="foundation-lead">Manage your venue subscription and see what’s included.</p></div>
      {owner && <Link className="button button-primary" href="/settings/plans">Change plan <ArrowUpRight size={16} /></Link>}</header>
    {params.error && <p className="billing-alert" role="alert">We couldn’t update your subscription. Check that checkout is configured and try again. Your plan has not been changed by this request.</p>}
    {params.updated && <p className="billing-success" role="status">Your billing request has been saved.</p>}
    {!data.writable && <div className="billing-alert"><strong>Your records are safe.</strong> You can still review your records, export data, and choose a subscription. {data.organization.lifecycleSource === "ADMIN" && "Contact support to restore venue access."}</div>}
    {["PAST_DUE", "GRACE"].includes(data.status) && <div className="billing-alert"><strong>Your renewal needs attention.</strong> Bookings remain available during the grace period{subscription?.graceUntil ? ` until ${date(subscription.graceUntil)}` : ""}.</div>}
    <div className="billing-grid"><section className="foundation-card billing-current"><span className="billing-status">{data.status.replaceAll("_", " ")}</span>
      <CreditCard size={24} aria-hidden="true" /><h2>{plan.name}</h2><p className="billing-price">RM{(subscriptionPrice(data.plan, cycle) / 100).toLocaleString("en-MY")}<small> / {cycle === "ANNUAL" ? "year" : "month"}</small></p>
      {data.status === "TRIALING" && <p className="billing-note">Plan price after the trial, if you choose to subscribe. No card required and no automatic charge.</p>}
      <dl className="billing-facts"><div><dt>Billing cycle</dt><dd>{cycle === "ANNUAL" ? "Annual · 2 months free" : "Monthly"}</dd></div>
        <div><dt>Provider</dt><dd>{data.legacy ? "Legacy plan assignment" : subscription?.provider === "DEVELOPMENT" ? "Development simulation" : "No payment provider connected"}</dd></div>
        {!data.legacy && subscription && <div><dt>Current period (UTC)</dt><dd>{date(subscription.currentPeriodStart)} – {date(subscription.currentPeriodEnd)}</dd></div>}
        <div><dt>{data.status === "TRIALING" ? "Trial ends" : subscription?.cancelAtPeriodEnd ? "Active until" : "Next renewal"}</dt><dd>{subscription && !data.legacy ? date(subscription.currentPeriodEnd) : "Not scheduled"}</dd></div></dl>
      {data.legacy && <p className="billing-note">Your previous plan is preserved. It does not represent a paid subscription or recurring charge.</p>}
      {subscription?.provider === "DEVELOPMENT" && <p className="billing-note">Test subscription only. No real payment is collected.</p>}
      {subscription?.pendingPlanCode && <div className="billing-note">{planDefinitions[subscription.pendingPlanCode as keyof typeof planDefinitions].name} · {subscription.pendingBillingCycle?.toLowerCase()} starts at your next renewal. Existing venue data is retained.</div>}
      {owner && !data.legacy && subscription && ["ACTIVE", "PAST_DUE", "GRACE"].includes(data.status) && <details className="billing-cancel"><summary>{subscription.cancelAtPeriodEnd ? "Resume renewal" : "Cancel subscription"}</summary>
        <p>{subscription.cancelAtPeriodEnd ? "Keep your subscription renewing." : `Keep access until ${date(subscription.currentPeriodEnd)}. Your venue records will be retained.`}</p>
        <form action={changeBillingAction}><input type="hidden" name="action" value={subscription.cancelAtPeriodEnd ? "RESUME" : "CANCEL"} />
          <label className="billing-checkbox"><input type="checkbox" name="confirm" value="yes" required /> I confirm this change</label><button className="button button-secondary">{subscription.cancelAtPeriodEnd ? "Resume subscription" : "Cancel at period end"}</button></form></details>}
    </section><section className="foundation-card billing-usage"><div className="billing-section-title"><CalendarDays size={20} /><h2>Your monthly allowance</h2></div>
      <p className="billing-note">{date(usage.booking.period.start)} – {date(usage.booking.period.end)} (UTC). Annual plans receive the same allowance each month.</p>
      <div className="starter-meter-list">{meters.map(meter => <div key={meter.label}><div className="starter-progress-label"><span>{meter.label}</span><strong>{meter.used.toLocaleString()} / {meter.limit?.toLocaleString() ?? "—"}</strong></div><progress aria-label={meter.label} value={Math.min(meter.used, meter.limit ?? meter.used)} max={meter.limit ?? 1} /></div>)}</div>
      <p className="billing-note">A booking counts once when first confirmed. Later cancellation does not restore the allowance. Pending invitations reserve staff seats.</p>
      <Link className="text-link" href="/settings/plan">See plan features →</Link></section></div>
    <section className="foundation-card billing-history"><h2>Subscription history</h2>{data.history.length ? <ul>{data.history.map(item => <li key={item.id}><span>{item.action.replaceAll(".", " ").replaceAll("_", " ")}</span><time>{date(item.createdAt)}</time></li>)}</ul> : <p>No subscription changes yet.</p>}</section>
    {owner && simulator && <Link className="text-link" href="/settings/billing/simulator">Development Subscription Simulator →</Link>}
  </div>;
}
