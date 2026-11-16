import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  automationExecutions, backgroundJobTasks, rateLimits, reportDeliveries,
  subscriptionNotifications, verifications, waitlistEntries,
} from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { drainBookingNotifications, reconcileInterruptedBookingNotifications } from "@/lib/booking-notifications";
import { runDueBusinessAutomations } from "@/lib/business-automations";
import { deploymentEnvironment, isPreviewEnvironment, type Environment } from "@/lib/deployment-environment";
import { sweepExpiredHolds } from "@/lib/payment-service";
import { runtimeConfigurationIssues } from "@/lib/runtime-config";
import { runDueReports } from "@/lib/scheduled-reports";
import { logEvent } from "@/lib/structured-log";
import { deliverSubscriptionNotices } from "@/lib/subscription-notifications";
import { reconcileSubscriptionLifecycles } from "@/lib/subscription-service";

const minute = 60_000;
const leaseMinutes = 10;
export const jobRunBudgetMs = 250_000;
export const backgroundJobSchedule = [
  { name: "payment-hold-expiry", intervalMinutes: 5 },
  { name: "booking-email-outbox", intervalMinutes: 5 },
  { name: "subscription-lifecycle", intervalMinutes: 15 },
  { name: "subscription-email-outbox", intervalMinutes: 5 },
  { name: "scheduled-reports", intervalMinutes: 15 },
  { name: "business-automations", intervalMinutes: 5 },
  { name: "ephemeral-maintenance", intervalMinutes: 60 },
] as const;
type JobName = typeof backgroundJobSchedule[number]["name"];
type Counts = Record<string, number | boolean>;
type JobHandler = (db: BookingDatabase, now: Date, deadlineAt: number) => Promise<Counts>;

export function scheduledJobsConfiguration(env: Environment = process.env) {
  if (env.ENABLE_SCHEDULED_JOBS !== "true") return { enabled: false, reason: "Scheduled jobs are not enabled." };
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32)
    return { enabled: false, reason: "The scheduler secret must be configured." };
  const environment = deploymentEnvironment(env);
  // Ordinary previews never run jobs. A deliberately isolated staging project must opt in separately.
  if ((isPreviewEnvironment(env) || environment === "staging") &&
      (env.DEPLOYMENT_ENV !== "staging" || env.ALLOW_STAGING_JOBS !== "true"))
    return { enabled: false, reason: "Jobs are disabled for this preview or staging environment." };
  if (runtimeConfigurationIssues(env).length)
    return { enabled: false, reason: "The deployment and database target must be validated before jobs run." };
  return { enabled: true, reason: "Scheduler access is configured; successful executions must still be verified." };
}

export function authorizedJobRequest(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The update is an atomic compare-and-set. No session/advisory lock survives through network calls. */
export async function claimBackgroundTask(db: BookingDatabase, name: JobName, now: Date) {
  await db.insert(backgroundJobTasks).values({ name, nextRunAt: now }).onConflictDoNothing();
  const [claim] = await db.update(backgroundJobTasks).set({ status: "RUNNING", runId: randomUUID(),
    leaseExpiresAt: new Date(now.getTime() + leaseMinutes * minute), lastStartedAt: now, updatedAt: now })
    .where(and(eq(backgroundJobTasks.name, name), lte(backgroundJobTasks.nextRunAt, now),
      or(isNull(backgroundJobTasks.leaseExpiresAt), lte(backgroundJobTasks.leaseExpiresAt, now))))
    .returning();
  return claim ?? null;
}

export async function finishBackgroundTask(db: BookingDatabase, claim: NonNullable<Awaited<ReturnType<typeof claimBackgroundTask>>>,
  result: Counts, failed: boolean, now: Date) {
  const interval = backgroundJobSchedule.find(job => job.name === claim.name)!.intervalMinutes;
  const failures = failed ? claim.consecutiveFailures + 1 : 0;
  const delayMinutes = failed ? Math.min(360, 5 * 2 ** Math.min(failures - 1, 7)) : interval;
  // Fencing token prevents a stale worker from clearing a successor's lease.
  await db.update(backgroundJobTasks).set({ status: failed ? "FAILED" : "SUCCEEDED", leaseExpiresAt: null,
    lastFinishedAt: now, ...(failed ? {} : { lastSucceededAt: now }), consecutiveFailures: failures,
    lastErrorCode: failed ? "JOB_EXECUTION_FAILED" : null, lastResult: result,
    nextRunAt: new Date(now.getTime() + delayMinutes * minute), updatedAt: now })
    .where(and(eq(backgroundJobTasks.name, claim.name), eq(backgroundJobTasks.runId, claim.runId!)));
}

/** Only expired ephemeral credentials/counters are deleted. Business and financial history is retained. */
export async function maintainEphemeralState(db: BookingDatabase, now = new Date()) {
  const stale = new Date(now.getTime() - 24 * 60 * minute);
  const expiredTokens = db.select({ id: verifications.id }).from(verifications)
    .where(lt(verifications.expiresAt, stale)).orderBy(verifications.expiresAt).limit(500);
  const tokens = await db.delete(verifications).where(and(inArray(verifications.id, expiredTokens), lt(verifications.expiresAt, stale)))
    .returning({ id: verifications.id });
  const staleCounters = db.select({ id: rateLimits.id }).from(rateLimits)
    .where(lt(rateLimits.lastRequest, stale.getTime())).orderBy(rateLimits.lastRequest).limit(500);
  const counters = await db.delete(rateLimits).where(and(inArray(rateLimits.id, staleCounters), lt(rateLimits.lastRequest, stale.getTime())))
    .returning({ id: rateLimits.id });
  const elapsedWaitlist = db.select({ id: waitlistEntries.id }).from(waitlistEntries)
    .where(and(inArray(waitlistEntries.status, ["WAITING", "NOTIFIED"]), lte(waitlistEntries.endAt, now)))
    .orderBy(waitlistEntries.endAt).limit(200);
  const waitlist = await db.update(waitlistEntries).set({ status: "EXPIRED", updatedAt: now })
    .where(and(inArray(waitlistEntries.id, elapsedWaitlist), inArray(waitlistEntries.status, ["WAITING", "NOTIFIED"]),
      lte(waitlistEntries.endAt, now))).returning({ id: waitlistEntries.id });
  const interruptedBefore = new Date(now.getTime() - 15 * minute);
  const reason = "Delivery was interrupted; reconcile with the provider before retrying";
  const subscriptionIds = db.select({ id: subscriptionNotifications.id }).from(subscriptionNotifications)
    .where(and(eq(subscriptionNotifications.status, "PROCESSING"), lt(subscriptionNotifications.updatedAt, interruptedBefore))).limit(100);
  const subscription = await db.update(subscriptionNotifications).set({ status: "FAILED", failureReason: reason, updatedAt: now })
    .where(and(inArray(subscriptionNotifications.id, subscriptionIds), eq(subscriptionNotifications.status, "PROCESSING"),
      lt(subscriptionNotifications.updatedAt, interruptedBefore))).returning({ id: subscriptionNotifications.id });
  const reportIds = db.select({ id: reportDeliveries.id }).from(reportDeliveries)
    .where(and(eq(reportDeliveries.status, "PROCESSING"), lt(reportDeliveries.updatedAt, interruptedBefore))).limit(100);
  const reports = await db.update(reportDeliveries).set({ status: "FAILED", failureReason: reason, updatedAt: now })
    .where(and(inArray(reportDeliveries.id, reportIds), eq(reportDeliveries.status, "PROCESSING"),
      lt(reportDeliveries.updatedAt, interruptedBefore))).returning({ id: reportDeliveries.id });
  const executionIds = db.select({ id: automationExecutions.id }).from(automationExecutions)
    .where(and(eq(automationExecutions.status, "PENDING"), lt(automationExecutions.updatedAt, interruptedBefore))).limit(100);
  const automations = await db.update(automationExecutions).set({ status: "FAILED", errorSummary: reason, updatedAt: now })
    .where(and(inArray(automationExecutions.id, executionIds), eq(automationExecutions.status, "PENDING"),
      lt(automationExecutions.updatedAt, interruptedBefore))).returning({ id: automationExecutions.id });
  return { expiredTokens: tokens.length, staleCounters: counters.length, expiredWaitlist: waitlist.length,
    interruptedSubscriptions: subscription.length, interruptedReports: reports.length, interruptedAutomations: automations.length,
    interruptedBookingEmails: await reconcileInterruptedBookingNotifications(db, now) };
}

const handlers: Record<JobName, JobHandler> = {
  "payment-hold-expiry": async (db, now) => ({ expired: await sweepExpiredHolds(db, now, 25) }),
  "booking-email-outbox": async (db, _now, deadline) => drainBookingNotifications(db, deadline),
  "subscription-lifecycle": (db, now) => reconcileSubscriptionLifecycles(db, now),
  "subscription-email-outbox": (db, _now, deadline) => deliverSubscriptionNotices(db, deadline),
  "scheduled-reports": (db, now, deadline) => runDueReports(db, now, deadline),
  "business-automations": (db, now, deadline) => runDueBusinessAutomations(db, now, deadline),
  "ephemeral-maintenance": (db, now) => maintainEphemeralState(db, now),
};

export async function runBackgroundJobs(db: BookingDatabase, options: {
  now?: Date; deadlineAt?: number; handlers?: Partial<Record<JobName, JobHandler>>;
} = {}) {
  const now = options.now ?? new Date();
  const deadlineAt = options.deadlineAt ?? Date.now() + jobRunBudgetMs;
  const tasks: { name: JobName; status: "SUCCEEDED" | "FAILED" | "SKIPPED" }[] = [];
  for (const task of backgroundJobSchedule) {
    if (Date.now() >= deadlineAt - 15_000) break;
    const claim = await claimBackgroundTask(db, task.name, now);
    if (!claim) { tasks.push({ name: task.name, status: "SKIPPED" }); continue; }
    // Each task gets a share of the request budget so one provider does not starve unrelated maintenance.
    const taskDeadline = Math.min(deadlineAt - 15_000, Date.now() + 25_000);
    try {
      const result = await (options.handlers?.[task.name] ?? handlers[task.name])(db, now, taskDeadline);
      const failed = typeof result.failed === "number" && result.failed > 0;
      await finishBackgroundTask(db, claim, result, failed, options.now ?? new Date());
      tasks.push({ name: task.name, status: failed ? "FAILED" : "SUCCEEDED" });
      if (failed) logEvent("job.failed", { job: task.name, correlationId: claim.runId!, code: "ITEM_FAILURE" }, "error");
    } catch {
      await finishBackgroundTask(db, claim, {}, true, options.now ?? new Date());
      logEvent("job.failed", { job: task.name, correlationId: claim.runId!, code: "JOB_EXECUTION_FAILED" }, "error");
      tasks.push({ name: task.name, status: "FAILED" });
    }
  }
  return { ok: tasks.every(task => task.status !== "FAILED"), tasks };
}

/** Safe aggregate evidence for authorized integration settings; no per-tenant results or secrets. */
export async function backgroundJobHealth(db: BookingDatabase, now = new Date()) {
  const configuration = scheduledJobsConfiguration();
  if (!configuration.enabled) return { status: "NOT_CONFIGURED" as const, message: configuration.reason, lastSuccessAt: null };
  try {
    const rows = await db.select().from(backgroundJobTasks).limit(backgroundJobSchedule.length);
    const allObserved = backgroundJobSchedule.every(task => rows.some(row => row.name === task.name && row.lastSucceededAt));
    const unhealthy = rows.some(row => row.status === "FAILED" ||
      (row.status === "RUNNING" && row.leaseExpiresAt && row.leaseExpiresAt < now) ||
      (row.nextRunAt.getTime() + 15 * minute < now.getTime()));
    const latest = rows.flatMap(row => row.lastSucceededAt ? [row.lastSucceededAt] : []).sort((a, b) => +b - +a)[0];
    return { status: allObserved && !unhealthy ? "CONNECTED" as const : "DEGRADED" as const,
      message: allObserved && !unhealthy ? "All scheduled tasks have recent successful execution evidence." :
        "The scheduler needs an initial successful run or attention to failed or overdue work.", lastSuccessAt: latest?.toISOString() ?? null };
  } catch {
    return { status: "MISCONFIGURED" as const, message: "Scheduler state is unavailable. Review database migrations.", lastSuccessAt: null };
  }
}
