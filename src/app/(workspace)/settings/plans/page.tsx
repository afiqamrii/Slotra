import Link from "next/link";
import { Check, Zap } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { organizationPlan } from "@/lib/organization-entitlements";
import { planCatalog, planPreviews } from "@/lib/plan-catalog";
import { toyyibSandboxConfig } from "@/lib/toyyibpay-sandbox";
import { startProfessionalUpgradeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { organization, member } = await requirePermission("organization:view");
  const currentPlan = await organizationPlan(getDb(), organization.organizationId);
  const sandboxUpgradeAvailable = currentPlan === "STARTER" && member.role === "OWNER" &&
    !!toyyibSandboxConfig(organization.organizationId);
  const params = await searchParams;

  return <div className="foundation-page plan-compare-page">
    <Link className="text-link" href="/settings/payments">← Booking payments</Link>
    <p className="eyebrow">SETTINGS / PLANS</p>
    <h1>Find the right fit for your venue</h1>
    <p className="foundation-lead">Compare what each plan is designed to offer. Professional is the first plan with online payments and deposits.</p>
    <div className="plan-compare-notice"><span>Your venue is on <strong>{planCatalog[currentPlan].name}</strong>.</span><span>{sandboxUpgradeAvailable ? "You can test a Professional upgrade with ToyyibPay sandbox. No real money moves." : "Live plan billing and self-service upgrades are not available."}</span></div>
    {params.error && <p className="pro-error">{params.error === "owner" ? "Only the venue owner can test a plan upgrade." : "We couldn’t start the sandbox checkout. Check the contact number and sandbox configuration, then try again. No plan change was made."}</p>}
    <div className="plan-compare-grid">
      {planPreviews.map(plan => <article key={plan.code} className={`foundation-card plan-compare-card${plan.featured ? " plan-compare-featured" : ""}`}>
        <div className="plan-compare-labels">{plan.code === currentPlan && <span className="payment-plan-badge">CURRENT PLAN</span>}{plan.featured && <span className="payment-plan-badge plan-compare-popular"><Zap size={13} aria-hidden="true" /> MOST POPULAR</span>}</div>
        <h2>{plan.name}</h2><p className="plan-compare-description">{plan.description}</p>
        <p className="plan-compare-price">RM{plan.price}<span> / month</span></p>
        <p className="plan-compare-includes">{plan.includes}</p>
        <ul className="plan-compare-features">{plan.features.map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
        {plan.code === "PROFESSIONAL" && sandboxUpgradeAvailable && <form action={startProfessionalUpgradeAction} className="plan-upgrade-form">
          <label>Contact number for test bill<input name="phone" type="tel" required placeholder="0123456789" autoComplete="tel" /></label>
          <button className="button button-primary" type="submit">Test upgrade · RM129 sandbox</button>
          <small>One-time test bill. Professional activates only after ToyyibPay confirms payment. No automatic renewal.</small>
        </form>}
      </article>)}
    </div>
    <p className="plan-compare-disclaimer">Business and Pro are previews; their extra features are not ready to purchase. The Professional test uses the shared ToyyibPay sandbox only. Live gateway connections, real subscriptions, and renewals are not available yet.</p>
  </div>;
}
