import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { savePoliciesAction } from "./actions";
export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { organization } = await requirePermission("organization:update");
  const [venue] = await getDb().select({ cancellationPolicy: organizations.cancellationPolicy,
    refundPolicy: organizations.refundPolicy, venueRules: organizations.venueRules }).from(organizations)
    .where(eq(organizations.id, organization.organizationId)).limit(1);
  const query = await searchParams;
  return <div className="foundation-page"><Link href="/settings">← Settings</Link><p className="eyebrow">PUBLIC BOOKING</p>
    <h1>Venue policies</h1><p className="foundation-lead">Tell customers what to expect before they book. Use your own reviewed policy wording.</p>
    <section className="foundation-card">{query.result && <p role="status" className={query.result === "saved" ? "form-success" : "form-alert"}>{query.result === "saved" ? "Policies updated." : "Could not save. Check each policy is under 5,000 characters."}</p>}
      <form action={savePoliciesAction} className="billing-admin-form">{([ ["cancellationPolicy", "Cancellation policy"], ["refundPolicy", "Refund policy"], ["venueRules", "Venue rules"] ] as const).map(([key, label]) =>
        <label key={key}>{label}<textarea name={key} rows={5} maxLength={5000} defaultValue={venue?.[key] ?? ""} /></label>)}
        <p className="small-note">Plain text only. Empty policies are hidden. These details do not change booking cancellation rules or automatically issue refunds.</p>
        <button className="button button-primary">Save policies</button></form></section></div>;
}
