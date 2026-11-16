import Link from "next/link";
import { requirePermission } from "@/lib/authorization";
import { getDb } from "@/db/client";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { authorizedMembership } from "@/lib/organization-service";
import { branchContext } from "@/lib/branch-context";
import type { Permission } from "@/lib/permissions";
export default async function SettingsPage() {
  const { organization, session } = await requirePermission("organization:view");
  const pro = await hasOrganizationFeature(getDb(), organization.organizationId, "MULTI_BRANCH");
  const branch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const selected = branch.selected && branch.selected !== "all" ? branch.selected : undefined;
  const check = (permission: Permission, branchId?: string) => authorizedMembership(getDb(), session.user.id, organization.organizationId, permission, branchId);
  const [billing, locations, payments, integrations, settings, access, audit, financial] = await Promise.all([
    check("billing:view"), check("branch:view", selected), check("payment:view", selected), check("integration:manage"),
    check("organization:update"), check("member:update"), check("audit:view"), check("report:view_financial"),
  ]);
  const administrator = ["OWNER", "ADMIN"].includes(organization.role);
  return <div className="foundation-page"><p className="eyebrow">SETTINGS</p><h1>Venue settings</h1><p className="foundation-lead">Keep your locations and team running smoothly.</p>
    {billing && administrator && <div className="foundation-card"><h2>Billing</h2><p>Manage your subscription, trial, renewal and monthly allowance.</p><Link className="button button-secondary" href="/settings/billing">Manage subscription</Link></div>}
    <div className="foundation-card"><h2>Plan & Usage</h2><p>See your monthly bookings and venue limits at a glance.</p><Link className="button button-secondary" href="/settings/plan">View plan & usage</Link></div>
    {locations && <div className="foundation-card"><h2>{pro ? "Branches, hours & pricing" : "Hours & pricing"}</h2><p>Manage opening hours, base prices, venue details and timezone.</p><Link className="button button-secondary" href="/settings/branch">{pro ? "Manage branches" : "View hours & pricing"}</Link></div>}
    {payments && <div className="foundation-card"><h2>Payments</h2><p>Pay-at-venue, deposits, and payment provider status.</p><Link className="button button-secondary" href="/settings/payments">Manage booking payments</Link></div>}
    {integrations && <div className="foundation-card"><h2>Integrations</h2><p>Review venue connections, service readiness, API access and queued webhook events.</p><Link className="button button-secondary" href="/settings/integrations">View integrations</Link></div>}
    {settings && <><div className="foundation-card"><h2>Venue policies</h2><p>Display your cancellation policy, refund policy and venue rules.</p><Link className="button button-secondary" href="/settings/policies">Edit policies</Link></div>
      <div className="foundation-card"><h2>Venue images</h2><p>Review upload availability and manage your logo and cover image.</p><Link className="button button-secondary" href="/settings/storage">Manage venue images</Link></div></>}
    {settings && administrator && <div className="foundation-card"><h2>Email delivery</h2><p>Check the transactional sender and send a safe test to your account email.</p><Link className="button button-secondary" href="/settings/notifications">Check email delivery</Link></div>}
    {pro && access && administrator && <div className="foundation-card"><h2>Roles & branch access</h2><p>Set up focused permissions and assign teammates to locations.</p><Link className="button button-secondary" href="/settings/access">Manage access</Link></div>}
    {pro && settings && <div className="foundation-card"><h2>Branding & custom domain</h2><p>Personalize your booking page and verify a domain you own.</p><Link className="button button-secondary" href="/settings/branding">Manage booking page</Link></div>}
    {pro && audit && <div className="foundation-card"><h2>Audit log</h2><p>Review important changes across your venue.</p><Link className="button button-secondary" href="/settings/audit-log">View audit log</Link></div>}
    {pro && financial && <div className="foundation-card"><h2>Corporate accounts</h2><p>Manage approved customers and shared monthly booking allowances.</p><Link className="button button-secondary" href="/corporate">Open corporate accounts</Link></div>}
  </div>;
}

