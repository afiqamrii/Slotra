import Link from "next/link";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { monitoringConfiguration } from "@/lib/monitoring";
import { runtimeConfigurationIssues } from "@/lib/runtime-config";
import { sendMonitoringTest } from "./actions";

export const dynamic = "force-dynamic";
export default async function PlatformIntegrations({ searchParams }: { searchParams: Promise<{ monitoring?: string }> }) {
  await requirePlatformAdministrator();
  const issues = runtimeConfigurationIssues(), monitoring = monitoringConfiguration(), query = await searchParams;
  return <div className="foundation-page"><Link href="/admin">← Platform overview</Link><p className="eyebrow">SUPER ADMIN</p>
    <h1>Platform integrations</h1><p className="foundation-lead">Configuration is only the first check. Verify each result in its provider dashboard.</p>
    <section className="foundation-card"><h2>Core environment</h2>{issues.length ? <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Core environment values pass local validation. External services still need separate verification.</p>}</section>
    <section className="foundation-card"><h2>Error monitoring</h2><p>{monitoring.valid ? "Sentry is configured. Send a safe event, then verify ingestion and alerting in Sentry." : "Needs configuration: add a valid hosted SENTRY_DSN."}</p>
      {query.monitoring && <p role="status" className={query.monitoring === "accepted" ? "form-success" : "form-alert"}>{query.monitoring === "accepted" ? "Sentry accepted the event. Verify it in the provider dashboard before marking monitoring ready." : "The test was not accepted. Check configuration and provider status."}</p>}
      {monitoring.valid && <form action={sendMonitoringTest}><button className="button button-secondary">Send monitoring test</button></form>}</section>
  </div>;
}
