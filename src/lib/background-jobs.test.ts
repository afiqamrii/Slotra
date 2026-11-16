import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const delivery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email-delivery", () => ({ deliverEmail: delivery, emailReady: () => true, escapeEmailHtml: (text: string) => text }));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  authorizedJobRequest, backgroundJobSchedule, claimBackgroundTask, finishBackgroundTask,
  maintainEphemeralState, runBackgroundJobs, scheduledJobsConfiguration,
} from "@/lib/background-jobs";
import { dispatchBookingNotifications, queueBookingNotification, reconcileInterruptedBookingNotifications } from "@/lib/booking-notifications";
import { databaseFingerprint } from "@/lib/runtime-config";
import { GET as runJobsRoute } from "@/app/api/internal/run-jobs/route";

describe("central scheduled job safety", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-01T00:00:00Z");
  let organizationId = "", bookingId = "", branchId = "", resourceId = "";
  beforeAll(async () => {
    const entries = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")).entries as { tag: string }[];
    for (const { tag } of entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) await postgres.exec(statement);
    organizationId = (await db.insert(schema.organizations).values({ name: "Jobs Test", slug: "jobs-test" }).returning())[0].id;
    branchId = (await db.insert(schema.branches).values({ organizationId, name: "Main", slug: "main" }).returning())[0].id;
    const sportTypeId = (await db.select().from(schema.sportTypes).limit(1))[0].id;
    resourceId = (await db.insert(schema.resources).values({ organizationId, branchId, sportTypeId, name: "Court 1" }).returning())[0].id;
    const customerId = (await db.insert(schema.customers).values({ organizationId, name: "Player", phone: "+60111111111", email: "player@example.test" }).returning())[0].id;
    bookingId = (await db.insert(schema.bookings).values({ organizationId, branchId, resourceId, customerId,
      bookingReference: "BK-JOB-TEST", status: "CONFIRMED", source: "ONLINE", startAt: new Date("2026-10-02T00:00:00Z"),
      endAt: new Date("2026-10-02T01:00:00Z"), subtotal: 2500, totalAmount: 2500, currency: "MYR" }).returning())[0].id;
  });
  beforeEach(async () => {
    await db.delete(schema.backgroundJobTasks);
    await db.delete(schema.notificationRecords);
    delivery.mockReset().mockResolvedValue({ status: "SENT", providerMessageId: "email-test", reason: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => { await postgres.close(); });

  it("disables unconfigured jobs and denies ordinary preview invocation", () => {
    expect(scheduledJobsConfiguration({}).enabled).toBe(false);
    const configuration = { NODE_ENV: "development", ENABLE_SCHEDULED_JOBS: "true", CRON_SECRET: "c".repeat(32),
      DATABASE_URL: "postgresql://test:test@localhost:5432/staging", BETTER_AUTH_SECRET: "a".repeat(32) };
    expect(scheduledJobsConfiguration(configuration).enabled).toBe(true);
    expect(scheduledJobsConfiguration({ ...configuration, VERCEL_ENV: "preview" }).enabled).toBe(false);
    const target = databaseFingerprint(configuration.DATABASE_URL);
    const staging = { ...configuration, VERCEL_ENV: "preview", DEPLOYMENT_ENV: "staging", ALLOW_STAGING_JOBS: "true",
      EXPECTED_DATABASE_FINGERPRINT: target, PRODUCTION_DATABASE_FINGERPRINT: "f".repeat(64),
      BETTER_AUTH_URL: "https://app.stage.test", NEXT_PUBLIC_APP_URL: "https://app.stage.test",
      NEXT_PUBLIC_BOOKING_URL: "https://book.stage.test", NEXT_PUBLIC_MARKETING_URL: "https://stage.test" };
    expect(scheduledJobsConfiguration(staging).enabled).toBe(true);
    expect(scheduledJobsConfiguration({ ...staging, PRODUCTION_DATABASE_FINGERPRINT: target }).enabled).toBe(false);
  });

  it("rejects missing/wrong scheduler credentials before database access", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect(authorizedJobRequest(new Request("https://app.test/api/internal/run-jobs"))).toBe(false);
    expect((await runJobsRoute(new Request("https://app.test/api/internal/run-jobs", { headers: { Authorization: "Bearer wrong" } }))).status).toBe(401);
    vi.stubEnv("ENABLE_SCHEDULED_JOBS", "false");
    expect((await runJobsRoute(new Request("https://app.test/api/internal/run-jobs", { headers: { Authorization: `Bearer ${"s".repeat(32)}` } }))).status).toBe(503);
  });

  it("allows one atomic lease, recovers interruption, and fences a stale worker", async () => {
    const claims = await Promise.all([claimBackgroundTask(db, "booking-email-outbox", now), claimBackgroundTask(db, "booking-email-outbox", now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    const recovered = await claimBackgroundTask(db, "booking-email-outbox", new Date(now.getTime() + 11 * 60_000));
    expect(recovered?.runId).not.toBe(first.runId);
    await finishBackgroundTask(db, first, { processed: 99 }, false, now);
    const current = (await db.select().from(schema.backgroundJobTasks))[0];
    expect(current.status).toBe("RUNNING");
    expect(current.runId).toBe(recovered!.runId);
  });

  it("isolates failures, persists retry backoff and skips successful replay", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = Object.fromEntries(backgroundJobSchedule.map(task => [task.name, vi.fn(async () => ({ processed: 1 }))]));
    handlers["payment-hold-expiry"] = vi.fn(async () => { throw new Error("secret-provider-payload"); });
    const first = await runBackgroundJobs(db, { now, handlers });
    expect(first.ok).toBe(false);
    expect(first.tasks.filter(task => task.status === "SUCCEEDED")).toHaveLength(6);
    const failed = (await db.select().from(schema.backgroundJobTasks).where(eq(schema.backgroundJobTasks.name, "payment-hold-expiry")))[0];
    expect(failed.nextRunAt.toISOString()).toBe("2026-10-01T00:05:00.000Z");
    expect(JSON.stringify(failed)).not.toContain("secret-provider-payload");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-provider-payload");
    const replay = await runBackgroundJobs(db, { now, handlers });
    expect(replay.tasks.every(task => task.status === "SKIPPED")).toBe(true);
    const retryAt = new Date(now.getTime() + 5 * 60_000);
    await runBackgroundJobs(db, { now: retryAt, handlers });
    const retried = (await db.select().from(schema.backgroundJobTasks).where(eq(schema.backgroundJobTasks.name, "payment-hold-expiry")))[0];
    expect(retried.consecutiveFailures).toBe(2);
    expect(retried.nextRunAt.toISOString()).toBe("2026-10-01T00:15:00.000Z");
  });

  it("does not claim new work after the invocation budget is exhausted", async () => {
    const result = await runBackgroundJobs(db, { now, deadlineAt: Date.now() - 1 });
    expect(result.tasks).toEqual([]);
    expect(await db.select().from(schema.backgroundJobTasks)).toEqual([]);
  });

  it("only one concurrent booking dispatcher sends a persisted notification", async () => {
    await queueBookingNotification(db, organizationId, bookingId, randomUUID(), "BOOKING_CONFIRMED");
    await Promise.all([dispatchBookingNotifications(db, organizationId, bookingId), dispatchBookingNotifications(db, organizationId, bookingId)]);
    expect(delivery).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.notificationRecords))[0].status).toBe("SENT");
  });

  it("does not blindly resend failed or interrupted email and preserves the booking", async () => {
    delivery.mockResolvedValue({ status: "FAILED", providerMessageId: null, reason: "Provider unavailable" });
    await queueBookingNotification(db, organizationId, bookingId, randomUUID(), "BOOKING_CONFIRMED");
    await dispatchBookingNotifications(db, organizationId, bookingId);
    await dispatchBookingNotifications(db, organizationId, bookingId);
    expect(delivery).toHaveBeenCalledTimes(1);
    const [record] = await db.select().from(schema.notificationRecords);
    await db.update(schema.notificationRecords).set({ status: "PROCESSING", updatedAt: new Date(now.getTime() - 20 * 60_000) })
      .where(eq(schema.notificationRecords.id, record.id));
    expect(await reconcileInterruptedBookingNotifications(db, now)).toBe(1);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)))[0].status).toBe("CONFIRMED");
  });

  it("cleans only expired ephemeral state and retains business records", async () => {
    const old = new Date(now.getTime() - 48 * 60 * 60_000), future = new Date(now.getTime() + 60_000);
    await db.insert(schema.verifications).values([{ identifier: "expired", value: "opaque", expiresAt: old },
      { identifier: "live", value: "opaque", expiresAt: future }]);
    await db.insert(schema.rateLimits).values([{ key: "old", count: 1, lastRequest: old.getTime() }, { key: "current", count: 2, lastRequest: now.getTime() }]);
    await db.insert(schema.waitlistEntries).values({ organizationId, branchId, resourceId, name: "Waiter", phone: "+60122222222",
      startAt: new Date(now.getTime() - 120_000), endAt: new Date(now.getTime() - 60_000) });
    const result = await maintainEphemeralState(db, now);
    expect(result).toMatchObject({ expiredTokens: 1, staleCounters: 1, expiredWaitlist: 1 });
    expect(await db.select().from(schema.verifications)).toHaveLength(1);
    expect(await db.select().from(schema.bookings).where(and(eq(schema.bookings.organizationId, organizationId), eq(schema.bookings.id, bookingId)))).toHaveLength(1);
    expect((await db.select().from(schema.waitlistEntries))[0].status).toBe("EXPIRED");
  });
});
