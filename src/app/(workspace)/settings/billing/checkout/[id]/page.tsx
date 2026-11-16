import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { getSubscriptionCheckout } from "@/lib/subscription-service";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { planDefinitions } from "@/lib/plan-entitlements";
import { changeBillingAction } from "../../actions";
export default async function SubscriptionCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (!developmentBillingEnabled()) notFound();
  const { organization, session } = await requireOrganizationMember();
  const checkout = await getSubscriptionCheckout(getDb(), session.user.id, organization.organizationId, (await params).id);
  const pending = checkout.status === "PENDING" && checkout.expiresAt > new Date();
  return <div className="foundation-page billing-page"><Link className="text-link" href="/settings/plans">← Plans</Link><p className="eyebrow">DEVELOPMENT CHECKOUT</p><h1>Test your subscription</h1><p className="foundation-lead">No card, bank transfer, or real payment is collected here.</p>
    <section className="foundation-card billing-current"><span className="billing-status">{pending ? "AWAITING TEST RESULT" : checkout.status}</span><h2>{planDefinitions[checkout.targetPlanCode as keyof typeof planDefinitions].name}</h2>
      <p className="billing-price">RM{(checkout.amountMinor / 100).toLocaleString("en-MY")}<small> / {checkout.billingCycle === "ANNUAL" ? "year" : "month"}</small></p><p>Plan activation requires a verified simulated provider event. Visiting this page alone changes nothing.</p>
      {pending && <div className="billing-inline-actions">{[{ action: "SUCCESS", label: "Simulate successful payment" }, { action: "FAIL_CHECKOUT", label: "Simulate failed payment" }].map(item => <form key={item.action} action={changeBillingAction}><input name="action" type="hidden" value={item.action} /><input name="checkoutId" type="hidden" value={checkout.id} /><button className={item.action === "SUCCESS" ? "button button-primary" : "button button-secondary"}>{item.label}</button></form>)}</div>}
      {!pending && <Link className="button button-secondary" href="/settings/billing">Return to Billing</Link>}</section></div>;
}
