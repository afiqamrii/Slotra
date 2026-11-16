import "server-only";
import { z } from "zod";
import type { BookingDatabase } from "@/lib/booking-availability";
import { claimWebhookDeliveries, prepareWebhookDelivery, recordWebhookAttempt, rejectWebhookClaim,
  type WebhookTransportRequest } from "@/lib/pro-webhooks";

// There is intentionally no HTTP implementation, route, scheduler registration or
// enablement flag. Tests supply a fake transport; real egress needs separate review.
export type WebhookTransport = (request: WebhookTransportRequest, signal: AbortSignal) => Promise<{ status: number }>;
export async function runWebhookWorkerOnce(db: BookingDatabase, transport: WebhookTransport,
  options: { limit?: number; timeoutMs?: number; clock?: () => Date } = {}) {
  if (typeof transport !== "function") throw new Error("Webhook delivery requires an explicitly supplied transport");
  const limit = z.number().int().min(1).max(10).parse(options.limit ?? 5);
  const timeoutMs = z.number().int().min(1).max(5000).parse(options.timeoutMs ?? 5000);
  const clock = options.clock ?? (() => new Date());
  const batch = await claimWebhookDeliveries(db, clock(), limit);
  const stats = { claimed: batch.claims.length, succeeded: 0, pending: 0, failed: 0, skipped: batch.skipped, stale: 0 };
  for (const claim of batch.claims) {
    const prepared = await prepareWebhookDelivery(db, claim, clock());
    if (!prepared.ok) {
      if (prepared.stale) { stats.stale++; continue; }
      if (await rejectWebhookClaim(db, claim, prepared.reason, clock())) { stats.failed++; stats.skipped++; }
      else stats.stale++;
      continue;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let responseStatus: number | null = null;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => transport(prepared.request, controller.signal)),
        new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); }),
      ]);
      responseStatus = response?.status ?? null;
    } catch { /* Store only a safe failure state, never a provider exception or response body. */ }
    finally { clearTimeout(timer); }
    const result = await recordWebhookAttempt(db, claim, responseStatus, clock());
    if (!result) stats.stale++;
    else if (result.success) stats.succeeded++;
    else if (result.status === "PENDING") stats.pending++;
    else stats.failed++;
  }
  return stats;
}
