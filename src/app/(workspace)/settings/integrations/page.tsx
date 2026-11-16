import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { listApiKeys } from "@/lib/pro-api-service";
import { listWebhookDeliveries, listWebhookEndpoints } from "@/lib/pro-webhooks";
import { ProApiKeyCreator, ProApiKeyRevoke, ProWebhookControls, ProWebhookCreator } from "@/components/pro-settings-forms";
import { integrationHealth } from "@/lib/integration-health";
import { IntegrationOverview } from "@/components/integration-overview";

export const dynamic = "force-dynamic";
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ endpointId?: string }> }) {
  const { organization, session } = await requirePermission("integration:manage");
  const db = getDb(), organizationId = organization.organizationId;
  const health = await integrationHealth(db, session.user.id, organizationId);
  if (!await hasOrganizationFeature(db, organizationId, "API_ACCESS")) return <div className="foundation-page">
    <Link href="/settings">← Settings</Link><p className="eyebrow">SETTINGS</p><h1>Integrations</h1>
    <IntegrationOverview items={health} /><p>API keys and webhooks are available on Pro.</p>
    <Link className="button button-primary" href="/settings/plans">Compare plans</Link></div>;
  const [keys, endpoints, locations] = await Promise.all([
    listApiKeys(db, session.user.id, organizationId), listWebhookEndpoints(db, session.user.id, organizationId),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.organizationId, organizationId)),
  ]);
  const query = await searchParams;
  const selected = endpoints.find(item => item.id === query.endpointId);
  const deliveries = selected ? await listWebhookDeliveries(db, session.user.id, organizationId, selected.id) : [];
  return <div className="foundation-page pro-settings-page"><Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">SETTINGS</p><h1>Integrations</h1>
    <p className="foundation-lead">Check your connections and manage how your venue works with external services.</p>
    <IntegrationOverview items={health} />
    <section className="foundation-card"><h2>API keys</h2><p>Use dedicated keys for external systems. A key is shown once when created.</p>
      <ProApiKeyCreator branches={locations} />{keys.length > 0 && <div className="data-list">{keys.map(key =>
        <div className="data-row" key={key.id}><span><strong>{key.name}</strong><small>{key.keyPrefix}… · {key.scopes.join(", ")}
          {key.branchId ? ` · ${locations.find(branch => branch.id === key.branchId)?.name ?? "Branch"}` : " · All branches"}</small></span>
          {key.revokedAt ? <span className="role-badge">Revoked</span> : <ProApiKeyRevoke id={key.id} />}</div>)}</div>}
      <Link className="text-link" href="/docs/api">Read API guide →</Link></section>
    <section className="foundation-card"><h2>Outbound webhooks</h2>
      <p className="form-alert">Event queueing and signatures are available. Live external delivery is not enabled yet, and test events are not sent.</p>
      {process.env.SLOTRA_WEBHOOK_SIGNING_KEY ? <ProWebhookCreator /> :
        <p className="small-note">A server-side webhook signing key must be configured before endpoints can be created.</p>}
      {endpoints.length > 0 && <div className="data-list">{endpoints.map(endpoint =>
        <div className="data-row" key={endpoint.id}><span><strong>{endpoint.name}</strong><small>{endpoint.url} · {endpoint.eventTypes.join(", ")}</small>
          <Link href={`/settings/integrations?endpointId=${endpoint.id}`}>View deliveries</Link></span>
          <ProWebhookControls id={endpoint.id} active={endpoint.isActive} /></div>)}</div>}
      {selected && <div className="pro-delivery-history"><h3>{selected.name} · recent events</h3>
        {deliveries.length ? <div className="data-list">{deliveries.map(delivery => <div key={delivery.id} className="data-row">
          <span><strong>{delivery.eventType}</strong><small>{delivery.status} · {delivery.attemptCount} attempts</small></span>
          <span>{delivery.responseStatus ?? "Not sent"}</span></div>)}</div> : <p>No events queued for this endpoint.</p>}</div>}
    </section>
  </div>;
}
