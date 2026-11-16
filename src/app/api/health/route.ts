import { getDb } from "@/db/client";
import { runtimeConfigurationIssues } from "@/lib/runtime-config";
import { logEvent } from "@/lib/structured-log";
import { venueSchemaReady } from "@/lib/venue-schema";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (runtimeConfigurationIssues().length) throw new Error("Configuration incomplete");
    if (!await venueSchemaReady(getDb(), { refresh: true })) throw new Error("Schema incomplete");
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logEvent("health.failed", { code: "NOT_READY" }, "warn");
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
