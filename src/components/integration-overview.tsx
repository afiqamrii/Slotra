import Link from "next/link";
import { ArrowUpRight, Building2, Server, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { integrationStatusLabels, type IntegrationHealth } from "@/lib/integration-health";
export function IntegrationOverview({ items }: { items: IntegrationHealth[] }) {
  return <section aria-label="Integration status" className="integration-overview">
    <div className="integration-intro"><p>Services connected to your venue and the platform. A configured key alone does not prove delivery or payment readiness.</p></div>
    <div className="integration-grid">{items.map(item => <article key={item.id} className="integration-card">
      <div className="integration-card-top"><span className="integration-scope">{item.scope === "PLATFORM" ? <Server size={14} aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}
        {item.scope === "PLATFORM" ? "Managed by platform" : "Your venue"}</span>
        <span className={`integration-status integration-status-${item.status.toLowerCase()}`}>
          {item.status === "CONNECTED" ? <CheckCircle2 size={14} aria-hidden="true" /> : item.status === "MISCONFIGURED" ? <TriangleAlert size={14} aria-hidden="true" /> : <CircleDashed size={14} aria-hidden="true" />}
          {integrationStatusLabels[item.status]}</span></div>
      <h2>{item.name}</h2><span className="integration-provider">{item.provider}</span><p>{item.message}</p>
      {item.href && <Link className="text-link integration-action" href={item.href}>{item.action}<ArrowUpRight size={15} aria-hidden="true" /></Link>}
    </article>)}</div>
  </section>;
}
