import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { billingDetails } from "@/lib/subscription-service";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { changeBillingAction } from "../actions";
export default async function BillingSimulator() {
  if (!developmentBillingEnabled()) notFound();
  const { session, organization } = await requireOrganizationMember();
  const data = await billingDetails(getDb(), session.user.id, organization.organizationId);
  if (organization.role !== "OWNER") notFound();
  return <div className="foundation-page billing-page"><Link className="text-link" href="/settings/billing">← Billing</Link><p className="eyebrow">DEVELOPMENT ONLY</p><h1>Development Subscription Simulator</h1><p className="foundation-lead">Use this with a test venue. No money moves. State changes are saved.</p>
    <section className="foundation-card"><h2>Current state: {data.status}</h2><p>Subscribe or upgrade using <Link className="text-link" href="/settings/plans">plan selection</Link>. Schedule a downgrade and cancellation from Billing. Trial extension, suspension, and reactivation require a Super Admin.</p>
      <p>Clock controls move the test subscription’s dates and write an audit record. Use “Make renewal due” before testing renewal, downgrade or scheduled cancellation.</p>
      <div className="billing-inline-actions">{[{ action: "START_TRIAL", label: "Start a test trial" }, { action: "EXPIRE_TRIAL", label: "Expire trial" }, { action: "RENEWAL_DUE", label: "Make renewal due" }, { action: "RENEWAL", label: "Simulate verified renewal" }, { action: "FAILED_RENEWAL", label: "Simulate failed renewal" }, { action: "EXPIRE_GRACE", label: "Expire grace & suspend" }].map(item => <form key={item.action} action={changeBillingAction}><input type="hidden" name="action" value={item.action} /><button className="button button-secondary">{item.label}</button></form>)}</div></section></div>;
}
