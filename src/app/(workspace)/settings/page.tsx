import Link from "next/link";
import { requirePermission } from "@/lib/authorization";
import { getDb } from "@/db/client";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
export default async function SettingsPage() {
  const { organization } = await requirePermission("organization:view");
  const pro = await hasOrganizationFeature(getDb(), organization.organizationId, "MULTI_BRANCH");
  return <div className="foundation-page"><p className="eyebrow">SETTINGS</p><h1>Venue settings</h1><p className="foundation-lead">Keep your locations and team running smoothly.</p>
    <div className="foundation-card"><h2>Plan & Usage</h2><p>See your monthly bookings and venue limits at a glance.</p><Link className="button button-secondary" href="/settings/plan">View plan & usage</Link></div>
    <div className="foundation-card"><h2>Branches</h2><p>{pro ? "Manage your locations, opening hours and base prices." : "Update your venue address, timezone and active status."}</p><Link className="button button-secondary" href="/settings/branch">Manage branches</Link></div>
    <div className="foundation-card"><h2>Payments</h2><p>Pay-at-venue, deposits, and payment provider status.</p><Link className="button button-secondary" href="/settings/payments">Manage booking payments</Link></div>
    {pro && <><div className="foundation-card"><h2>Roles & branch access</h2><p>Set up focused permissions and assign teammates to locations.</p><Link className="button button-secondary" href="/settings/access">Manage access</Link></div>
      <div className="foundation-card"><h2>Branding & custom domain</h2><p>Personalize your booking page and verify a domain you own.</p><Link className="button button-secondary" href="/settings/branding">Manage booking page</Link></div>
      <div className="foundation-card"><h2>API & webhooks</h2><p>Create scoped API keys and inspect queued webhook events.</p><Link className="button button-secondary" href="/settings/integrations">Manage integrations</Link></div>
      <div className="foundation-card"><h2>Audit log</h2><p>Review important changes across your venue.</p><Link className="button button-secondary" href="/settings/audit-log">View audit log</Link></div>
      <div className="foundation-card"><h2>Corporate accounts</h2><p>Manage approved customers and shared monthly booking allowances.</p><Link className="button button-secondary" href="/corporate">Open corporate accounts</Link></div></>}
  </div>;
}

