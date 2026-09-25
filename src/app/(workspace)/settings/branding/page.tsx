import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations, tenantDomains } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { ProBrandingForm, ProDomainCreator, ProDomainVerifier } from "@/components/pro-settings-forms";

export const dynamic = "force-dynamic";
export default async function BrandingPage() {
  const { organization } = await requirePermission("organization:update");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "WHITE_LABEL")) return <div className="foundation-page">
    <Link href="/settings">← Settings</Link><h1>Booking page branding</h1><p>Available on Pro.</p>
    <Link className="button button-primary" href="/settings/plans">Compare plans</Link></div>;
  const [[venue], domains] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select().from(tenantDomains).where(eq(tenantDomains.organizationId, organizationId))
      .orderBy(tenantDomains.createdAt).limit(20),
  ]);
  return <div className="foundation-page pro-settings-page"><Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">PRO / BOOKING PAGE</p><h1>Branding & domain</h1>
    <p className="foundation-lead">Make the booking page feel like your venue while keeping it fast and readable.</p>
    <section className="foundation-card"><h2>Public branding</h2><ProBrandingForm initialValues={{
      displayName: venue.displayName || venue.name, description: venue.publicDescription || "",
      color: venue.primaryColor || "#176b5b", logoUrl: venue.logoUrl || "",
      coverImageUrl: venue.coverImageUrl || "", hidePoweredBy: venue.hidePoweredBy,
    }} /></section>
    <section className="foundation-card"><h2>Custom domain</h2><p>Add a hostname you own, then prove ownership with a DNS TXT record.</p>
      <p className="form-alert">DNS verification is available, but automatic platform activation is not configured. Your Slotra booking URL stays active.</p>
      <ProDomainCreator />{domains.length > 0 && <div className="data-list">{domains.map(domain =>
        <div className="data-row" key={domain.id}><span><strong>{domain.hostname}</strong><small>{domain.status}
          {domain.isActive ? " · Live" : " · Not active"}</small></span>
          {domain.status !== "VERIFIED" && domain.status !== "DISABLED" && <ProDomainVerifier id={domain.id} />}</div>)}</div>}</section>
  </div>;
}
