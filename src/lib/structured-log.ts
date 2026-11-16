// Never accept Error objects, arbitrary payloads, URLs, contact details or secrets.
export type SafeLogContext = { organizationId?: string; correlationId?: string; route?: string;
  code?: string; status?: number; job?: string; provider?: string };
const safeToken = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_./:\[\]-]{1,120}$/.test(value) ? value : undefined;
export function safeLogRecord(event: string, context: SafeLogContext = {}) {
  return { timestamp: new Date().toISOString(), event: safeToken(event) ?? "application.error",
    organizationId: /^[a-f0-9-]{36}$/i.test(context.organizationId ?? "") ? context.organizationId : undefined,
    correlationId: /^[a-f0-9-]{32,36}$/i.test(context.correlationId ?? "") ? context.correlationId : undefined,
    route: safeToken(context.route), code: safeToken(context.code),
    status: Number.isInteger(context.status) && context.status! >= 100 && context.status! <= 599 ? context.status : undefined,
    job: safeToken(context.job), provider: safeToken(context.provider) };
}
export function logEvent(event: string, context: SafeLogContext = {}, level: "info" | "warn" | "error" = "info") {
  console[level](JSON.stringify(safeLogRecord(event, context)));
}
