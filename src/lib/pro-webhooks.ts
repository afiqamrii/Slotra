import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { outboundWebhookEvents, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";
import { outboundEventTypes, type OutboundEventType } from "@/lib/pro-integration-contracts";

export { outboundEventTypes, type OutboundEventType } from "@/lib/pro-integration-contracts";
const endpointInput = z.object({ name: z.string().trim().min(2).max(100), url: z.url(),
  eventTypes: z.array(z.enum(outboundEventTypes)).min(1).max(outboundEventTypes.length)
    .transform(values => [...new Set(values)]) });
const retryMinutes = [1, 5, 30, 120, 360];

export function safeWebhookUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (url.port && url.port !== "443") || isIP(url.hostname) ||
    url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") || url.hostname.endsWith(".internal"))
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

export async function recordWebhookAttempt(db: BookingDatabase, organizationId: string, deliveryId: string,
  responseStatus: number | null, now = new Date()) {
  // Internal-only receipt updater. Never exposed as a public route or owner action.
  return db.transaction(async tx => {
    const [delivery] = await tx.select().from(webhookDeliveries).where(and(
      eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.id, deliveryId)))
      .for("update").limit(1);
    if (!delivery || !["PENDING", "PROCESSING"].includes(delivery.status)) return null;
    const attempt = delivery.attemptCount + 1;
    const success = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
    const nextDelay = retryMinutes[attempt - 1];
    await tx.update(webhookDeliveries).set({ status: success ? "SUCCEEDED" : nextDelay ? "PENDING" : "FAILED",
      attemptCount: attempt, lastAttemptAt: now, responseStatus,
      errorSummary: success ? null : responseStatus ? `HTTP ${responseStatus}` : "Delivery failed",
      nextAttemptAt: new Date(now.getTime() + (nextDelay ?? 0) * 60_000), updatedAt: now })
      .where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.id, delivery.id)));
    return { success, attempt };
  });
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
