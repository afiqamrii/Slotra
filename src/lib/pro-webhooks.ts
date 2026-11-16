import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { outboundWebhookEvents, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";
import { outboundEventTypes, type OutboundEventType } from "@/lib/pro-integration-contracts";
import { checkPublicRateLimit } from "@/lib/public-booking";
import { organizationBillingAccess } from "@/lib/subscription-access";

export { outboundEventTypes, type OutboundEventType } from "@/lib/pro-integration-contracts";
const endpointInput = z.object({ name: z.string().trim().min(2).max(100), url: z.url(),
  eventTypes: z.array(z.enum(outboundEventTypes)).min(1).max(outboundEventTypes.length)
    .transform(values => [...new Set(values)]) });
const retryMinutes = [1, 5, 30, 120, 360];
export const webhookLeaseMs = 10 * 60_000;
export const webhookMaxAttempts = retryMinutes.length + 1;
export type WebhookDeliveryClaim = { id: string; organizationId: string; endpointId: string; eventId: string;
  attempt: number; claimedAt: Date };
export type WebhookTransportRequest = { url: string; body: string; headers: Readonly<Record<string, string>> };
type DeliveryCandidate = { delivery: typeof webhookDeliveries.$inferSelect;
  endpoint: typeof webhookEndpoints.$inferSelect; event: typeof outboundWebhookEvents.$inferSelect };

export function safeWebhookUrl(raw: string) {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (url.port && url.port !== "443") || isIP(hostname) || !hostname.includes(".") ||
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal"))
    throw new Error("Use a public HTTPS endpoint on port 443");
  return url.toString();
}

function signingSecret(endpointId: string, version: number) {
  const master = process.env.SLOTRA_WEBHOOK_SIGNING_KEY;
  if (!master || master.length < 32) throw new Error("Webhook signing is not configured");
  return createHmac("sha256", master).update(`slotra-webhook:${endpointId}:${version}`).digest("hex");
}

export function signWebhookPayload(secret: string, body: string, timestamp: number) {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function manageWebhooks(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "WEBHOOKS");
  const member = await authorizedMembership(db, actorId, organizationId, "integration:manage");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL")
    throw new Error("Permission denied");
}

export async function createWebhookEndpoint(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await manageWebhooks(db, actorId, organizationId);
  const input = endpointInput.parse(raw);
  const url = safeWebhookUrl(input.url);
  if (!process.env.SLOTRA_WEBHOOK_SIGNING_KEY || process.env.SLOTRA_WEBHOOK_SIGNING_KEY.length < 32)
    throw new Error("Webhook signing is not configured");
  return db.transaction(async tx => {
    const [endpoint] = await tx.insert(webhookEndpoints).values({ organizationId, createdByUserId: actorId,
      name: input.name, url, eventTypes: input.eventTypes }).returning();
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "webhook.created", entityType: "webhook",
      entityId: endpoint.id, summary: `Created ${endpoint.name} webhook` });
    return { endpoint, secret: signingSecret(endpoint.id, endpoint.secretVersion) };
  });
}

export async function setWebhookActive(db: BookingDatabase, actorId: string, organizationId: string,
  endpointId: string, active: boolean) {
  await manageWebhooks(db, actorId, organizationId);
  if (!z.uuid().safeParse(endpointId).success) throw new Error("Webhook not found");
  await db.transaction(async tx => {
    const [endpoint] = await tx.update(webhookEndpoints).set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.organizationId, organizationId), eq(webhookEndpoints.id, endpointId)))
      .returning({ id: webhookEndpoints.id, name: webhookEndpoints.name });
    if (!endpoint) throw new Error("Webhook not found");
    await recordAudit(tx, { organizationId, actorUserId: actorId,
      action: active ? "webhook.enabled" : "webhook.disabled", entityType: "webhook", entityId: endpoint.id,
      summary: `${active ? "Enabled" : "Disabled"} ${endpoint.name} webhook` });
  });
}

export async function rotateWebhookSecret(db: BookingDatabase, actorId: string, organizationId: string, endpointId: string) {
  await manageWebhooks(db, actorId, organizationId);
  if (!z.uuid().safeParse(endpointId).success) throw new Error("Webhook not found");
  return db.transaction(async tx => {
    const [endpoint] = await tx.update(webhookEndpoints).set({ secretVersion: sql`${webhookEndpoints.secretVersion} + 1`,
      updatedAt: new Date() }).where(and(eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, endpointId))).returning();
    if (!endpoint) throw new Error("Webhook not found");
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "webhook.secret_rotated",
      entityType: "webhook", entityId: endpoint.id, summary: `Rotated ${endpoint.name} signing secret` });
    return signingSecret(endpoint.id, endpoint.secretVersion);
  });
}

export async function queueOutboundEvent(db: BookingDatabase, organizationId: string, type: OutboundEventType,
  entityId: string | null, idempotencyKey: string, data: Record<string, unknown>) {
  if (!await hasOrganizationFeature(db, organizationId, "WEBHOOKS")) return null;
  return db.transaction(async tx => {
    const [created] = await tx.insert(outboundWebhookEvents).values({ organizationId, eventType: type,
      entityId, idempotencyKey, payload: data }).onConflictDoNothing().returning({ id: outboundWebhookEvents.id });
    if (!created) return null;
    const endpoints = await tx.select({ id: webhookEndpoints.id, eventTypes: webhookEndpoints.eventTypes })
      .from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.isActive, true))).limit(100);
    const matching = endpoints.filter(endpoint => endpoint.eventTypes.includes(type));
    if (matching.length) await tx.insert(webhookDeliveries).values(matching.map(endpoint => ({
      organizationId, endpointId: endpoint.id, eventId: created.id,
    })));
    return created.id;
  });
}

export async function queueTestWebhook(db: BookingDatabase, actorId: string, organizationId: string, endpointId: string) {
  await manageWebhooks(db, actorId, organizationId);
  const [endpoint] = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.organizationId, organizationId), eq(webhookEndpoints.id, endpointId),
      eq(webhookEndpoints.isActive, true))).limit(1);
  if (!endpoint) throw new Error("Webhook not found");
  await checkPublicRateLimit(db, `webhook-test:${organizationId}:${actorId}`, 10, 3_600_000);
  const eventId = randomUUID();
  await db.insert(outboundWebhookEvents).values({ id: eventId, organizationId,
    eventType: "test.ping", idempotencyKey: `test:${eventId}`, payload: { message: "Slotra test event" } });
  const [delivery] = await db.insert(webhookDeliveries).values({ organizationId, endpointId, eventId }).returning();
  return delivery.id;
}

// A separate approved egress worker will claim and deliver these records. This module never sends network traffic.
export async function dueWebhookDeliveries(db: BookingDatabase, now = new Date()) {
  return db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
    .where(or(and(eq(webhookDeliveries.status, "PENDING"), lte(webhookDeliveries.nextAttemptAt, now)),
      and(eq(webhookDeliveries.status, "PROCESSING"), lte(webhookDeliveries.lastAttemptAt,
        new Date(now.getTime() - 600_000)))))
    .orderBy(asc(webhookDeliveries.nextAttemptAt)).limit(100);
}

function dueDelivery(now: Date) {
  return or(and(eq(webhookDeliveries.status, "PENDING"), lte(webhookDeliveries.nextAttemptAt, now)),
    and(eq(webhookDeliveries.status, "PROCESSING"), lte(webhookDeliveries.lastAttemptAt, new Date(now.getTime() - webhookLeaseMs))));
}
async function blockedDelivery(db: BookingDatabase, row: DeliveryCandidate, now: Date) {
  if (!row.endpoint.isActive) return "ENDPOINT_DISABLED";
  if (row.event.eventType !== "test.ping" && !row.endpoint.eventTypes.includes(row.event.eventType)) return "EVENT_NOT_SUBSCRIBED";
  const access = await organizationBillingAccess(db, row.delivery.organizationId, now);
  if (!access.organization.isActive || !access.features.WEBHOOKS) return "WEBHOOK_FEATURE_UNAVAILABLE";
  return null;
}

// Internal-only claims. No scheduler, route or network adapter calls this in the application.
export async function claimWebhookDeliveries(db: BookingDatabase, now = new Date(), limit = 5) {
  z.number().int().min(1).max(10).parse(limit);
  const master = process.env.SLOTRA_WEBHOOK_SIGNING_KEY;
  if (!master || master.length < 32) throw new Error("Webhook signing is not configured");
  return db.transaction(async tx => {
    const candidates = await tx.select({ delivery: webhookDeliveries, endpoint: webhookEndpoints, event: outboundWebhookEvents })
      .from(webhookDeliveries).innerJoin(webhookEndpoints, and(eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        eq(webhookEndpoints.organizationId, webhookDeliveries.organizationId)))
      .innerJoin(outboundWebhookEvents, and(eq(outboundWebhookEvents.id, webhookDeliveries.eventId),
        eq(outboundWebhookEvents.organizationId, webhookDeliveries.organizationId)))
      .where(dueDelivery(now)).orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
      // PostgreSQL requires an unqualified relation name in the OF clause.
      .limit(limit).for("update", { of: alias(webhookDeliveries, "webhook_deliveries"), skipLocked: true });
    const claims: WebhookDeliveryClaim[] = [];
    let skipped = 0;
    for (const row of candidates) {
      const blocked = row.delivery.attemptCount >= webhookMaxAttempts ? "ATTEMPT_LIMIT_REACHED" : await blockedDelivery(tx, row, now);
      if (blocked) {
        await tx.update(webhookDeliveries).set({ status: "FAILED", responseStatus: null, errorSummary: blocked, updatedAt: now })
          .where(and(eq(webhookDeliveries.organizationId, row.delivery.organizationId), eq(webhookDeliveries.id, row.delivery.id)));
        skipped++;
        continue;
      }
      const attempt = row.delivery.attemptCount + 1;
      await tx.update(webhookDeliveries).set({ status: "PROCESSING", attemptCount: attempt,
        lastAttemptAt: now, responseStatus: null, errorSummary: null, updatedAt: now })
        .where(and(eq(webhookDeliveries.organizationId, row.delivery.organizationId), eq(webhookDeliveries.id, row.delivery.id)));
      claims.push({ id: row.delivery.id, organizationId: row.delivery.organizationId, endpointId: row.endpoint.id,
        eventId: row.event.id, attempt, claimedAt: now });
    }
    return { claims, skipped };
  });
}

function canonicalValue(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error("Webhook payload is invalid");
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))) return value;
  if (Array.isArray(value) && value.length <= 100) return value.map(item => canonicalValue(item, depth + 1));
  if (typeof value === "object" && value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (entries.length <= 100) return Object.fromEntries(entries.map(([key, item]) => [key, canonicalValue(item, depth + 1)]));
  }
  throw new Error("Webhook payload is invalid");
}
export function canonicalWebhookBody(event: { id: string; eventType: string; createdAt: Date; payload: Record<string, unknown> }) {
  const body = JSON.stringify({ id: event.id, type: event.eventType, createdAt: event.createdAt.toISOString(), data: canonicalValue(event.payload) });
  if (Buffer.byteLength(body, "utf8") > 65_536) throw new Error("Webhook payload is too large");
  return body;
}
function ownsClaim(delivery: typeof webhookDeliveries.$inferSelect, claim: WebhookDeliveryClaim, now: Date) {
  return delivery.status === "PROCESSING" && delivery.organizationId === claim.organizationId &&
    delivery.endpointId === claim.endpointId && delivery.eventId === claim.eventId && delivery.attemptCount === claim.attempt &&
    delivery.lastAttemptAt?.getTime() === claim.claimedAt.getTime() && now.getTime() < claim.claimedAt.getTime() + webhookLeaseMs;
}
export async function prepareWebhookDelivery(db: BookingDatabase, claim: WebhookDeliveryClaim, now = new Date()): Promise<
  { ok: true; request: WebhookTransportRequest } | { ok: false; reason: string; stale: boolean }> {
  const [row] = await db.select({ delivery: webhookDeliveries, endpoint: webhookEndpoints, event: outboundWebhookEvents })
    .from(webhookDeliveries).innerJoin(webhookEndpoints, and(eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      eq(webhookEndpoints.organizationId, webhookDeliveries.organizationId)))
    .innerJoin(outboundWebhookEvents, and(eq(outboundWebhookEvents.id, webhookDeliveries.eventId),
      eq(outboundWebhookEvents.organizationId, webhookDeliveries.organizationId)))
    .where(and(eq(webhookDeliveries.id, claim.id), eq(webhookDeliveries.organizationId, claim.organizationId))).limit(1);
  if (!row || !ownsClaim(row.delivery, claim, now)) return { ok: false, reason: "STALE_CLAIM", stale: true };
  const blocked = await blockedDelivery(db, row, now);
  if (blocked) return { ok: false, reason: blocked, stale: false };
  try {
    const url = safeWebhookUrl(row.endpoint.url), body = canonicalWebhookBody(row.event);
    return { ok: true, request: { url, body, headers: { "Content-Type": "application/json",
      "X-Slotra-Event-Id": row.event.id, "X-Slotra-Delivery-Id": row.delivery.id, "X-Slotra-Event": row.event.eventType,
      "X-Slotra-Signature": signWebhookPayload(signingSecret(row.endpoint.id, row.endpoint.secretVersion), body, Math.floor(now.getTime() / 1000)) } } };
  } catch { return { ok: false, reason: "DELIVERY_CONFIGURATION_INVALID", stale: false }; }
}

async function settleWebhookClaim(db: BookingDatabase, claim: WebhookDeliveryClaim, responseStatus: number | null,
  now: Date, terminalReason?: string) {
  return db.transaction(async tx => {
    const [delivery] = await tx.select().from(webhookDeliveries).where(and(
      eq(webhookDeliveries.organizationId, claim.organizationId), eq(webhookDeliveries.id, claim.id)))
      .for("update").limit(1);
    if (!delivery || !ownsClaim(delivery, claim, now)) return null;
    const attempt = claim.attempt;
    const success = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
    const nextDelay = terminalReason ? null : retryMinutes[attempt - 1];
    const status = success ? "SUCCEEDED" : nextDelay ? "PENDING" : "FAILED";
    await tx.update(webhookDeliveries).set({ status, responseStatus,
      errorSummary: terminalReason ?? (success ? null : responseStatus ? `HTTP ${responseStatus}` : "Delivery failed"),
      nextAttemptAt: new Date(now.getTime() + (nextDelay ?? 0) * 60_000), updatedAt: now })
      .where(and(eq(webhookDeliveries.organizationId, claim.organizationId), eq(webhookDeliveries.id, delivery.id)));
    return { success, attempt, status };
  });
}
export async function recordWebhookAttempt(db: BookingDatabase, claim: WebhookDeliveryClaim,
  responseStatus: number | null, now = new Date()) {
  const safeStatus = responseStatus !== null && Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599 ? responseStatus : null;
  return settleWebhookClaim(db, claim, safeStatus, now);
}
export async function rejectWebhookClaim(db: BookingDatabase, claim: WebhookDeliveryClaim, reason: string, now = new Date()) {
  const safeReason = ["ENDPOINT_DISABLED", "EVENT_NOT_SUBSCRIBED", "WEBHOOK_FEATURE_UNAVAILABLE", "DELIVERY_CONFIGURATION_INVALID"].includes(reason)
    ? reason : "DELIVERY_CONFIGURATION_INVALID";
  return settleWebhookClaim(db, claim, null, now, safeReason);
}

export async function listWebhookEndpoints(db: BookingDatabase, actorId: string, organizationId: string) {
  await manageWebhooks(db, actorId, organizationId);
  return db.select({ id: webhookEndpoints.id, name: webhookEndpoints.name, url: webhookEndpoints.url,
    eventTypes: webhookEndpoints.eventTypes, isActive: webhookEndpoints.isActive, createdAt: webhookEndpoints.createdAt })
    .from(webhookEndpoints).where(eq(webhookEndpoints.organizationId, organizationId))
    .orderBy(desc(webhookEndpoints.createdAt)).limit(100);
}

export async function listWebhookDeliveries(db: BookingDatabase, actorId: string, organizationId: string,
  endpointId: string) {
  await manageWebhooks(db, actorId, organizationId);
  if (!z.uuid().safeParse(endpointId).success) throw new Error("Webhook not found");
  return db.select({ id: webhookDeliveries.id, status: webhookDeliveries.status,
    attemptCount: webhookDeliveries.attemptCount, responseStatus: webhookDeliveries.responseStatus,
    errorSummary: webhookDeliveries.errorSummary, lastAttemptAt: webhookDeliveries.lastAttemptAt,
    eventType: outboundWebhookEvents.eventType })
    .from(webhookDeliveries).innerJoin(outboundWebhookEvents, and(eq(webhookDeliveries.eventId, outboundWebhookEvents.id),
      eq(webhookDeliveries.organizationId, outboundWebhookEvents.organizationId)))
    .where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.endpointId, endpointId)))
    .orderBy(desc(webhookDeliveries.createdAt)).limit(50);
}
