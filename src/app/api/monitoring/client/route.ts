import { createHash } from "node:crypto";
import { getDb } from "@/db/client";
import { configuredHosts } from "@/lib/host-routing";
import { captureOperationalError, monitoringConfiguration } from "@/lib/monitoring";
import { checkPublicRateLimit } from "@/lib/public-booking";

export async function POST(request: Request) {
  if (!monitoringConfiguration().valid) return new Response(null, { status: 204 });
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (!configuredHosts().has(origin.host)) return new Response(null, { status: 403 });
    if (Number(request.headers.get("content-length") ?? 0) > 1024) return new Response(null, { status: 413 });
    // The request body is deliberately ignored: never forward browser URLs, contacts, tokens or arbitrary errors.
    const ip = request.headers.get("x-real-ip") ?? "unknown";
    await checkPublicRateLimit(getDb(), `client-error:${createHash("sha256").update(ip).digest("hex")}`, 10, 60_000);
    await captureOperationalError("client.failed", { code: "CLIENT_RENDER_ERROR" });
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 429 }); }
}
