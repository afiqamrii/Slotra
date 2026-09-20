import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { connectedCheckoutAccount, getPaymentPolicy } from "@/lib/payment-service";
import { testPaymentsEnabled } from "@/lib/payment-policy";
import { toyyibSandboxConfig } from "@/lib/toyyibpay-sandbox";
import { hasPermission } from "@/lib/permissions";
import { PaymentSettingsForm } from "@/components/payment-settings-form";
import { planHasFeature, type StandardPlan } from "@/lib/plan-entitlements";
import { planCatalog } from "@/lib/plan-catalog";
import { ArrowUpRight, Check, WalletCards, Zap } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function PaymentSettingsPage() {
  const { organization, member } = await requirePermission("payment:view");
  const orgId = organization.organizationId;
  const [policy, account, [venue]] = await Promise.all([
    getPaymentPolicy(getDb(), orgId), connectedCheckoutAccount(getDb(), orgId),
    getDb().select({ currency: organizations.currency, planCode: organizations.planCode }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
  ]);
  const onlineAllowed = planHasFeature(venue.planCode as StandardPlan, "ONLINE_PAYMENTS");
  return <div className="foundation-page payment-settings-page">
    <Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">SETTINGS / PAYMENTS</p><h1>Booking payments</h1>
    <p className="foundation-lead">Set what guests pay when they book, and keep a clear record of payments received.</p>
    {onlineAllowed ? <PaymentSettingsForm key={String(account?.id) + ":" + policy.requirement + ":" + policy.fixedDepositMinor + ":" + policy.depositPercentage + ":" + policy.manualEnabled}
      initial={policy} connectedProvider={account?.provider ?? null} currency={venue.currency}
      sandboxAvailable={venue.currency === "MYR" && !!toyyibSandboxConfig(orgId)}
      canEdit={hasPermission(member.role, "payment:manage_settings")}
      testAvailable={testPaymentsEnabled() && !!process.env.TEST_PAYMENT_WEBHOOK_SECRET} /> :
      <div className="payment-plan-grid">
        <section className="foundation-card payment-plan-card" aria-label="Your current Starter plan">
          <div className="payment-plan-topline"><span className="payment-plan-icon" aria-hidden="true"><WalletCards size={20} strokeWidth={1.8} /></span><span className="payment-plan-badge">CURRENT PLAN</span></div>
          <div className="payment-plan-heading"><div><p className="eyebrow">STARTER</p><h2>Pay at venue</h2></div><p className="payment-plan-price">RM{planCatalog.STARTER.price} <span>/ month</span></p></div>
          <p className="payment-plan-description">Guests can book online and pay when they arrive. Your team records payments after receiving them.</p>
          <ul className="payment-plan-features">
            <li><Check size={17} aria-hidden="true" />Cash, bank transfer, and other manual payments</li>
            <li><Check size={17} aria-hidden="true" />Booking totals and payment history</li>
            <li><Check size={17} aria-hidden="true" />Paid and outstanding balances</li>
          </ul>
          <div className="payment-plan-footer"><span className="payment-plan-active"><Check size={16} aria-hidden="true" />Ready for your venue</span></div>
        </section>
        <aside className="foundation-card payment-plan-card payment-plan-featured" aria-label="Professional plan preview">
          <div className="payment-plan-topline"><span className="payment-plan-icon" aria-hidden="true"><Zap size={20} strokeWidth={1.8} /></span><span className="payment-plan-badge">MOST POPULAR</span></div>
          <div className="payment-plan-heading"><div><p className="eyebrow">PROFESSIONAL</p><h2>Take payments online</h2></div><p className="payment-plan-price">RM{planCatalog.PROFESSIONAL.price} <span>/ month</span></p></div>
          <p className="payment-plan-description">Give guests more ways to pay, with funds going directly to your venue merchant account.</p>
          <ul className="payment-plan-features">
            <li><Check size={17} aria-hidden="true" />Everything in Starter</li>
            <li><Check size={17} aria-hidden="true" />Online full payments and deposits</li>
            <li><Check size={17} aria-hidden="true" />Automatic payment confirmation</li>
          </ul>
          <div className="payment-plan-footer"><p className="payment-plan-caveat">Plan upgrades and live gateway connections are not available in this preview.</p><Link className="button button-secondary payment-plan-cta" href="/settings/plans">Compare plans <ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </aside>
      </div>}
  </div>;
}
