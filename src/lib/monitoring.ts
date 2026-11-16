import { deploymentEnvironment } from "@/lib/deployment-environment";
import { logEvent, safeLogRecord, type SafeLogContext } from "@/lib/structured-log";

export function monitoringConfiguration() {
  const raw = process.env.SENTRY_DSN;
  if (!raw) return { configured: false, valid: false };
  try {
    const url = new URL(raw);
    const valid = url.protocol === "https:" && /^o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io$/.test(url.hostname) && !url.port &&
      /^[a-f0-9]{32}$/i.test(url.username) && !url.password && /^\/\d+$/.test(url.pathname) && !url.search && !url.hash;
    return { configured: true, valid };
  } catch { return { configured: true, valid: false }; }
}

// Minimal Sentry envelope adapter: only allowlisted event codes/context, no automatic PII or request bodies.
export async function captureOperationalError(event: string, context: SafeLogContext = {}) {
  const correlationId = context.correlationId ?? crypto.randomUUID();
  logEvent(event, { ...context, correlationId }, "error");
  if (!monitoringConfiguration().valid) return { accepted: false, correlationId };
  const dsn = new URL(process.env.SENTRY_DSN!);
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const record = safeLogRecord(event, { ...context, correlationId });
  const payload = { event_id: eventId, timestamp: Date.now() / 1000, platform: "javascript", level: "error",
    message: record.event, environment: deploymentEnvironment(), tags: record };
  const envelope = [JSON.stringify({ event_id: eventId, dsn: dsn.toString(), sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }), JSON.stringify(payload)].join("\n");
  try {
    const response = await fetch(`${dsn.origin}/api${dsn.pathname}/envelope/`, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7,sentry_key=${dsn.username},sentry_client=slotra-safe-events/1.0` },
      body: envelope, signal: AbortSignal.timeout(3000) });
    if (!response.ok) logEvent("monitoring.failed", { code: "PROVIDER_REJECTED", status: response.status }, "warn");
    return { accepted: response.ok, correlationId };
  } catch { logEvent("monitoring.failed", { code: "UNREACHABLE" }, "warn"); return { accepted: false, correlationId }; }
}
