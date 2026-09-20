import Link from "next/link";
import { Check, Zap } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { organizationPlan } from "@/lib/organization-entitlements";
import { planCatalog, planPreviews } from "@/lib/plan-catalog";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const { organization } = await requirePermission("organization:view");
  const currentPlan = await organizationPlan(getDb(), organization.organizationId);

  return <div className="foundation-page plan-compare-page">
    <Link className="text-link" href="/settings/payments">← Booking payments</Link>
    <p className="eyebrow">SETTINGS / PLANS</p>
    <h1>Find the right fit for your venue</h1>
    <p className="foundation-lead">Compare what each plan is designed to offer. Professional is the first plan with online payments and deposits.</p>
    <div className="plan-compare-notice"><span>Your venue is on <strong>{planCatalog[currentPlan].name}</strong>.</span><span>Plan upgrades are not available in this preview, so no charge or plan change happens here.</span></div>
    <div className="plan-compare-grid">
      {planPreviews.map(plan => <article key={plan.code} className={`foundation-card plan-compare-card${plan.featured ? " plan-compare-featured" : ""}`}>
        <div className="plan-compare-labels">{plan.code === currentPlan && <span className="payment-plan-badge">CURRENT PLAN</span>}{plan.featured && <span className="payment-plan-badge plan-compare-popular"><Zap size={13} aria-hidden="true" /> MOST POPULAR</span>}</div>
        <h2>{plan.name}</h2><p className="plan-compare-description">{plan.description}</p>
        <p className="plan-compare-price">RM{plan.price}<span> / month</span></p>
        <p className="plan-compare-includes">{plan.includes}</p>
        <ul className="plan-compare-features">{plan.features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
      </article>)}
    </div>
    <p className="plan-compare-disclaimer">This is a plan preview. Live gateway connections, self-service upgrades, and several higher-plan features are not available yet.</p>
  </div>;
}
