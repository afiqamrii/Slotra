import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Zap } from "lucide-react";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { billingDetails } from "@/lib/subscription-service";
import { starterPlanUsage } from "@/lib/starter-reporting";
import { planPreviews } from "@/lib/plan-catalog";
import { planDefinitions, subscriptionPrice } from "@/lib/plan-entitlements";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { changeBillingAction } from "../billing/actions";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const { organization, session } = await requireOrganizationMember();
  if (!["OWNER", "ADMIN"].includes(organization.role)) notFound();
  const [data, usage, params] = await Promise.all([billingDetails(getDb(), session.user.id, organization.organizationId),
    starterPlanUsage(getDb(), organization.organizationId), searchParams]);
  const cycle = params.cycle === "annual" ? "ANNUAL" as const : "MONTHLY" as const;
  const owner = organization.role === "OWNER", available = developmentBillingEnabled();
  return <div className="foundation-page plan-compare-page billing-page">
    <Link className="text-link" href="/settings/billing">← Billing</Link>
    <header className="billing-heading"><div><p className="eyebrow">CHOOSE YOUR PLAN</p><h1>Room for your next chapter</h1>
      <p className="foundation-lead">Start with bookings. Add payments, insights, growth and more locations as you need them.</p></div>
      <nav className="billing-cycle" aria-label="Billing cycle"><Link aria-current={cycle === "MONTHLY" ? "page" : undefined} href="?cycle=monthly">Monthly</Link><Link aria-current={cycle === "ANNUAL" ? "page" : undefined} href="?cycle=annual">Annual <span>2 months free</span></Link></nav></header>
    <p className="billing-note">Current plan: {planDefinitions[data.plan].name}{data.status === "TRIALING" ? " trial" : ""}. {available ? "Development checkout is available. No real payment is collected." : "Live subscription checkout is not connected yet."}</p>
    <div className="plan-compare-grid">{planPreviews.map(plan => {
      const definition = planDefinitions[plan.code];
      const downgrade = data.status === "ACTIVE" && !data.legacy && definition.order < planDefinitions[data.plan].order;
      const cycleChange = data.status === "ACTIVE" && !data.legacy && cycle !== data.subscription?.billingCycle;
      const current = data.status === "ACTIVE" && !data.legacy && plan.code === data.plan && cycle === data.subscription?.billingCycle;
      const exceeded = [{ name: "courts & spaces", used: usage.resources.used, limit: definition.limits.RESOURCES },
        { name: "branches", used: usage.branches.used, limit: definition.limits.BRANCHES },
        { name: "staff", used: usage.staff.used, limit: definition.limits.STAFF_SEATS }].filter(item => item.limit !== null && item.used > item.limit);
      return <article key={plan.code} className={"foundation-card plan-compare-card" + (definition.recommended ? " plan-compare-featured" : "")}>
        <div className="plan-compare-labels">{plan.code === data.plan && <span className="payment-plan-badge">{data.status === "TRIALING" ? "TRIAL PLAN" : "CURRENT PLAN"}</span>}
          {definition.recommended && <span className="payment-plan-badge plan-compare-popular"><Zap size={13} aria-hidden="true" /> MOST POPULAR</span>}</div>
        <h2>{plan.name}</h2><p className="plan-compare-description">{plan.description}</p>
        <p className="plan-compare-price">RM{(subscriptionPrice(plan.code, cycle) / 100).toLocaleString("en-MY")}<span> / {cycle === "ANNUAL" ? "year" : "month"}</span></p>
        <p className="plan-compare-includes">{plan.includes}</p><ul className="plan-compare-features">{plan.features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
        {downgrade && exceeded.length > 0 && <p className="billing-alert billing-small">You have {exceeded.map(item => item.used + " " + item.name + " (plan limit " + item.limit + ")").join(", ")}. Existing records stay visible; new additions stop until usage is within the limit.</p>}
        {owner && available && (!current || data.subscription?.pendingPlanCode) && <form action={changeBillingAction} className="billing-plan-action">
          <input type="hidden" name="plan" value={plan.code} /><input type="hidden" name="cycle" value={cycle} />
          <input type="hidden" name="action" value={downgrade || cycleChange || current ? "SCHEDULE" : "SUBSCRIBE"} />
          <button className={definition.recommended ? "button button-primary" : "button button-secondary"}>{current ? "Keep this plan at renewal" : downgrade ? "Schedule downgrade" : cycleChange ? "Switch at renewal" : "Choose " + plan.name}</button>
          <small>{downgrade || cycleChange || current ? "Takes effect at your next renewal." : "Activates after the verified test checkout."}</small></form>}
        {current && !data.subscription?.pendingPlanCode && <span className="billing-note">Your current subscription</span>}
      </article>;
    })}</div>
    <section className="foundation-card billing-feature-groups"><h2>Find what matters to your venue</h2><div>{[
      ["Bookings", "Every plan", "Guest bookings, walk-ins, calendar, customers and manual payment tracking."],
      ["Payments", "Professional and up", "Venue-owned online payments, deposits and supported refunds."],
      ["Reports", "Professional and up", "Business dashboard, utilisation and scheduled reports."],
      ["Growth", "Business and up", "Memberships, packages, peak pricing, promotions and automations."],
      ["Scale", "Pro", "Five branches, custom roles, corporate accounts, API and executive reports."],
    ].map(([name, tier, description]) => <article key={name}><h3>{name}</h3><strong>{tier}</strong><p>{description}</p></article>)}</div></section>
    <p className="billing-note">Enterprise: custom terms. A venue payment provider and message delivery must be configured separately. Test billing moves no money; live subscriptions require a production billing provider.</p>
  </div>;
}
