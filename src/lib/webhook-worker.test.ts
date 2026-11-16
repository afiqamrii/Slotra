import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createOrganization } from "@/lib/organization-service";
import { canonicalWebhookBody, claimWebhookDeliveries, createWebhookEndpoint, prepareWebhookDelivery,
  queueOutboundEvent, recordWebhookAttempt, rotateWebhookSecret, setWebhookActive, webhookLeaseMs } from "@/lib/pro-webhooks";
import { runWebhookWorkerOnce, type WebhookTransport } from "@/lib/webhook-worker";

describe("offline webhook worker foundation", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-20T00:00:00.000Z");
  let ownerId = "", organizationId = "", otherOrganizationId = "", endpointId = "", secret = "";
  async function enqueue(payload: Record<string, unknown> = { bookingId: "safe-booking", amountMinor: 2000 }) {
    const eventId = (await queueOutboundEvent(db, organizationId, "booking.created", null, randomUUID(), payload))!;
    await db.update(schema.webhookDeliveries).set({ nextAttemptAt: now });
    return eventId;
  }
  async function delivery() { return (await db.select().from(schema.webhookDeliveries))[0]; }
  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    const [owner] = await db.insert(schema.users).values({ name: "Webhook Owner", email: "webhook-owner@example.test" }).returning();
    ownerId = owner.id;
    organizationId = (await createOrganization(db, ownerId, { name: "Webhooks", slug: "webhook-test" }, { startTrial: false })).id;
    otherOrganizationId = (await createOrganization(db, ownerId, { name: "Other", slug: "webhook-other" }, { startTrial: false })).id;
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, organizationId));
  }, 120000);
  beforeEach(async () => {
    vi.stubEnv("SLOTRA_WEBHOOK_SIGNING_KEY", "private-local-test-signing-key-with-at-least-32-characters");
    await db.delete(schema.webhookDeliveries); await db.delete(schema.outboundWebhookEvents); await db.delete(schema.webhookEndpoints);
    await db.update(schema.organizations).set({ planCode: "PRO", isActive: true }).where(eq(schema.organizations.id, organizationId));
    const created = await createWebhookEndpoint(db, ownerId, organizationId, { name: "Operations",
      url: "https://receiver.example.test/hooks", eventTypes: ["booking.created"] });
    endpointId = created.endpoint.id; secret = created.secret;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => postgres.close());

  it("delivers only through an injected fake transport with a canonical signed envelope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const eventId = await enqueue({ z: { last: 2, first: 1 }, a: "safe" });
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ status: 204 });
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => now })).toMatchObject({ claimed: 1, succeeded: 1 });
    const request = transport.mock.calls[0][0], body = JSON.parse(request.body);
    expect(request.url).toBe("https://receiver.example.test/hooks");
    expect(body).toMatchObject({ id: eventId, type: "booking.created", data: { a: "safe", z: { first: 1, last: 2 } } });
    expect(request.body).toContain('"data":{"a":"safe","z":{"first":1,"last":2}}');
    const timestamp = Math.floor(now.getTime() / 1000);
    const digest = createHmac("sha256", secret).update(`${timestamp}.${request.body}`).digest("hex");
    expect(request.headers).toMatchObject({ "X-Slotra-Event-Id": eventId, "X-Slotra-Signature": `t=${timestamp},v1=${digest}` });
    expect(request.body).not.toContain(secret);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await delivery()).status).toBe("SUCCEEDED");
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => now })).toMatchObject({ claimed: 0 });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("allows only one concurrent claimant and fences duplicate and foreign receipts", async () => {
    await enqueue();
    const batches = await Promise.all([claimWebhookDeliveries(db, now), claimWebhookDeliveries(db, now)]);
    const claims = batches.flatMap(batch => batch.claims);
    expect(claims).toHaveLength(1);
    expect(await recordWebhookAttempt(db, { ...claims[0], organizationId: otherOrganizationId }, 204, now)).toBeNull();
    expect(await recordWebhookAttempt(db, claims[0], 204, now)).toMatchObject({ success: true, attempt: 1 });
    expect(await recordWebhookAttempt(db, claims[0], 503, now)).toBeNull();
    expect((await delivery()).status).toBe("SUCCEEDED");
  });

  it("recovers an abandoned lease and rejects the previous worker's late success", async () => {
    await enqueue();
    const [old] = (await claimWebhookDeliveries(db, now)).claims;
    expect((await claimWebhookDeliveries(db, new Date(now.getTime() + webhookLeaseMs - 1))).claims).toHaveLength(0);
    const later = new Date(now.getTime() + webhookLeaseMs);
    expect(await recordWebhookAttempt(db, old, 204, later)).toBeNull();
    const [fresh] = (await claimWebhookDeliveries(db, later)).claims;
    expect(fresh.attempt).toBe(2);
    expect(await recordWebhookAttempt(db, old, 204, later)).toBeNull();
    expect(await recordWebhookAttempt(db, fresh, 204, later)).toMatchObject({ success: true, attempt: 2 });
  });

  it("uses the bounded retry schedule and stops after six unsuccessful attempts", async () => {
    await enqueue();
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ status: 503 });
    let current = now;
    for (const delay of [1, 5, 30, 120, 360]) {
      expect(await runWebhookWorkerOnce(db, transport, { clock: () => current })).toMatchObject({ claimed: 1, pending: 1 });
      const row = await delivery();
      expect(row.nextAttemptAt.getTime()).toBe(current.getTime() + delay * 60_000);
      expect((await claimWebhookDeliveries(db, new Date(row.nextAttemptAt.getTime() - 1))).claims).toHaveLength(0);
      current = row.nextAttemptAt;
    }
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => current })).toMatchObject({ claimed: 1, failed: 1 });
    expect((await delivery()).attemptCount).toBe(6);
    expect((await delivery()).errorSummary).toBe("HTTP 503");
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => new Date(current.getTime() + 86_400_000) })).toMatchObject({ claimed: 0 });
    expect(transport).toHaveBeenCalledTimes(6);
  });

  it.each(["inactive endpoint", "Starter downgrade", "inactive venue"])("does not dispatch for %s", async reason => {
    await enqueue();
    if (reason === "inactive endpoint") await setWebhookActive(db, ownerId, organizationId, endpointId, false);
    if (reason === "Starter downgrade") await db.update(schema.organizations).set({ planCode: "STARTER" }).where(eq(schema.organizations.id, organizationId));
    if (reason === "inactive venue") await db.update(schema.organizations).set({ isActive: false }).where(eq(schema.organizations.id, organizationId));
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ status: 200 });
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => now })).toMatchObject({ claimed: 0, skipped: 1 });
    expect(transport).not.toHaveBeenCalled();
    expect((await delivery()).status).toBe("FAILED");
  });

  it("rechecks endpoint activation and uses the current signing-secret version after claim", async () => {
    await enqueue();
    const [claim] = (await claimWebhookDeliveries(db, now)).claims;
    const currentSecret = await rotateWebhookSecret(db, ownerId, organizationId, endpointId);
    const prepared = await prepareWebhookDelivery(db, claim, now);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected prepared fake delivery");
    const timestamp = Math.floor(now.getTime() / 1000);
    expect(prepared.request.headers["X-Slotra-Signature"]).toBe(`t=${timestamp},v1=${createHmac("sha256", currentSecret)
      .update(`${timestamp}.${prepared.request.body}`).digest("hex")}`);
    await setWebhookActive(db, ownerId, organizationId, endpointId, false);
    expect(await prepareWebhookDelivery(db, claim, now)).toEqual({ ok: false, reason: "ENDPOINT_DISABLED", stale: false });
  });

  it("bounds fake transport time and stores no raw exception or response body", async () => {
    await enqueue();
    let signal: AbortSignal | undefined;
    const transport: WebhookTransport = async (_request, receivedSignal) => { signal = receivedSignal; return new Promise(() => {}); };
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => now, timeoutMs: 5 })).toMatchObject({ claimed: 1, pending: 1 });
    expect(signal?.aborted).toBe(true);
    expect((await delivery()).errorSummary).toBe("Delivery failed");
    const retryAt = (await delivery()).nextAttemptAt;
    expect(await runWebhookWorkerOnce(db, async () => { throw new Error("private endpoint token"); }, { clock: () => retryAt }))
      .toMatchObject({ claimed: 1, pending: 1 });
    expect((await delivery()).errorSummary).not.toContain("private endpoint token");
  });

  it("rejects unsafe stored endpoints and oversized payloads without invoking a transport", async () => {
    await enqueue();
    await db.update(schema.webhookEndpoints).set({ url: "https://127.0.0.1/private" }).where(eq(schema.webhookEndpoints.id, endpointId));
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ status: 200 });
    expect(await runWebhookWorkerOnce(db, transport, { clock: () => now })).toMatchObject({ failed: 1, skipped: 1 });
    expect(transport).not.toHaveBeenCalled();
    expect(() => canonicalWebhookBody({ id: randomUUID(), eventType: "test.ping", createdAt: now,
      payload: { message: "x".repeat(65_536) } })).toThrow("too large");
  });
  it("cannot consume queued attempts without an explicitly supplied transport or signing configuration", async () => {
    await enqueue();
    await expect(runWebhookWorkerOnce(db, undefined as unknown as WebhookTransport, { clock: () => now }))
      .rejects.toThrow("explicitly supplied transport");
    vi.stubEnv("SLOTRA_WEBHOOK_SIGNING_KEY", "");
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ status: 200 });
    await expect(runWebhookWorkerOnce(db, transport, { clock: () => now })).rejects.toThrow("signing is not configured");
    expect(transport).not.toHaveBeenCalled();
    expect(await delivery()).toMatchObject({ status: "PENDING", attemptCount: 0 });
  });
});
