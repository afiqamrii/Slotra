import { and, asc, count, eq, lte } from "drizzle-orm";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { branches, organizations, reportDeliveries, reportSchedules } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { professionalReport } from "@/lib/professional-reporting";
import { proExecutiveReport } from "@/lib/pro-reporting";
import { deliverEmail, emailReady } from "@/lib/email-delivery";
import { scheduledReportEmailTemplate } from "@/lib/email-templates";
import { bookingMoney } from "@/lib/booking-format";

const scheduleInput = z.object({
  name: z.string().trim().min(2).max(80),
  reportType: z.enum(["OVERVIEW", "REVENUE", "BOOKINGS", "RESOURCES", "CUSTOMERS"]),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  recipients: z.array(z.email().trim().toLowerCase()).min(1).max(5),
  branchId: z.uuid().nullable().optional(),
});
export type ScheduleInput = z.infer<typeof scheduleInput>;
async function requireScheduleAccess(db: BookingDatabase, actorId: string, organizationId: string) {
  const manager = await authorizedMembership(db, actorId, organizationId, "report:manage_schedule");
  const financial = await authorizedMembership(db, actorId, organizationId, "report:view_financial");
  if (!manager || !financial || manager.branchScope !== "ALL")
    throw new Error("You cannot manage report schedules.");
}
export function nextReportRun(frequency: "WEEKLY" | "MONTHLY", timezone: string, after = new Date()) {
  const local = Temporal.Instant.from(after.toISOString()).toZonedDateTimeISO(timezone);
  let date = local.toPlainDate();
  if (frequency === "WEEKLY") date = date.add({ days: (8 - date.dayOfWeek) % 7 });
  else date = date.with({ day: 1 }).add({ months: 1 });
  let result = Temporal.ZonedDateTime.from({ timeZone: timezone, year: date.year, month: date.month, day: date.day, hour: 9 });
  if (Temporal.ZonedDateTime.compare(result, local) <= 0) {
    date = frequency === "WEEKLY" ? date.add({ days: 7 }) : date.add({ months: 1 });
    result = Temporal.ZonedDateTime.from({ timeZone: timezone, year: date.year, month: date.month, day: date.day, hour: 9 });
  }
  return new Date(Number(result.epochMilliseconds));
}
export function reportPeriod(frequency: "WEEKLY" | "MONTHLY", timezone: string, due: Date) {
  const date = Temporal.Instant.from(due.toISOString()).toZonedDateTimeISO(timezone).toPlainDate();
  const to = date.subtract({ days: 1 });
  const from = frequency === "WEEKLY" ? to.subtract({ days: 6 }) : date.with({ day: 1 }).subtract({ months: 1 });
  return { from: from.toString(), to: to.toString() };
}
export async function createReportSchedule(db: BookingDatabase, organizationId: string, userId: string,
  raw: unknown, now = new Date()) {
  await requireOrganizationFeature(db, organizationId, "SCHEDULED_REPORTS");
  await requireScheduleAccess(db, userId, organizationId);
  const input = scheduleInput.parse(raw);
  const [branchRows, existing, [venue], multiBranch] = await Promise.all([
    db.select({ id: branches.id, timezone: branches.timezone }).from(branches).where(and(
      eq(branches.organizationId, organizationId), eq(branches.isActive, true))).orderBy(asc(branches.createdAt)),
    db.select({ total: count() }).from(reportSchedules).where(eq(reportSchedules.organizationId, organizationId)),
    db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    hasOrganizationFeature(db, organizationId, "MULTI_BRANCH"),
  ]);
  if (!branchRows.length || !venue) throw new Error("Set up an active branch first.");
  if (existing[0]?.total >= 10) throw new Error("You can set up to 10 scheduled reports.");
  if (!multiBranch && input.branchId) throw new Error("Branch selection is available on Pro.");
  if (multiBranch && !input.branchId && input.reportType !== "OVERVIEW")
    throw new Error("All Branches schedules use the Overview report.");
  const branch = input.branchId ? branchRows.find(row => row.id === input.branchId) :
    multiBranch ? null : branchRows[0];
  if (input.branchId && !branch) throw new Error("Branch not found.");
  const timezone = branch?.timezone ?? venue.timezone;
  const [schedule] = await db.insert(reportSchedules).values({ organizationId, createdByUserId: userId,
    ...input, branchId: branch?.id ?? null, recipients: [...new Set(input.recipients)], timezone,
    nextRunAt: nextReportRun(input.frequency, timezone, now) }).returning();
  return schedule;
}
export async function listReportSchedules(db: BookingDatabase, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "SCHEDULED_REPORTS");
  return db.select().from(reportSchedules).where(eq(reportSchedules.organizationId, organizationId))
    .orderBy(asc(reportSchedules.createdAt)).limit(10);
}
export async function setReportScheduleActive(db: BookingDatabase, organizationId: string, actorId: string,
  scheduleId: string, isActive: boolean) {
  await requireOrganizationFeature(db, organizationId, "SCHEDULED_REPORTS");
  await requireScheduleAccess(db, actorId, organizationId);
  const [updated] = await db.update(reportSchedules).set({ isActive, updatedAt: new Date() })
    .where(and(eq(reportSchedules.organizationId, organizationId), eq(reportSchedules.id, scheduleId))).returning();
  if (!updated) throw new Error("Report schedule not found.");
  return updated;
}
function reportEmail(name: string, period: { from: string; to: string },
  report: Awaited<ReturnType<typeof professionalReport>>, currency: string, type: string, venueName: string) {
  const rows: { label: string; value: string }[] = [];
  if (type === "OVERVIEW" || type === "REVENUE") rows.push(
    { label: "Booking value", value: bookingMoney(report.totals.bookingValue, currency) },
    { label: "Collected", value: bookingMoney(report.totals.collected, currency) },
    { label: "Outstanding", value: bookingMoney(report.totals.outstanding, currency) });
  if (type === "OVERVIEW" || type === "BOOKINGS") rows.push(
    { label: "Bookings", value: String(report.totals.bookings) }, { label: "Completed", value: String(report.totals.completed) },
    { label: "Cancelled", value: String(report.totals.cancelled) }, { label: "No-shows", value: String(report.totals.noShows) });
  if (type === "OVERVIEW" || type === "RESOURCES") rows.push(
    { label: "Utilisation", value: report.utilization.percent === null ? "Not available" : `${report.utilization.percent}%` },
    ...report.utilization.resources.map(item => ({ label: item.name, value: item.percent === null ? "Not available" : `${item.percent}%` })));
  if (type === "OVERVIEW" || type === "CUSTOMERS") rows.push(
    { label: "New customers", value: String(report.customers.new) }, { label: "Returning customers", value: String(report.customers.returning) });
  return scheduledReportEmailTemplate({ venueName, reportName: `${name} · ${type.toLowerCase()} report`,
    period: `${period.from} to ${period.to}`, timezone: report.timezone, rows });
}
function executiveReportEmail(name: string, period: { from: string; to: string },
  report: Awaited<ReturnType<typeof proExecutiveReport>>, venueName: string) {
  const money = (amount: number) => bookingMoney(amount, report.currency);
  const rows = [{ label: "Bookings", value: String(report.totals.bookings) },
    { label: "Booking value", value: money(report.totals.bookingValue) },
    { label: "Collected", value: money(report.totals.collected) },
    { label: "Outstanding", value: money(report.totals.outstanding) },
    { label: "Utilisation", value: report.totals.utilization === null ? "Not available" : `${report.totals.utilization}%` },
    ...report.branches.map(branch => ({ label: branch.name, value: `${branch.bookings} bookings · ${money(branch.bookingValue)}` }))];
  return scheduledReportEmailTemplate({ venueName, reportName: `${name} · All Branches overview`,
    period: `${period.from} to ${period.to}`, rows });
}
export async function runDueReports(db: BookingDatabase, now = new Date(), deadlineAt = Number.POSITIVE_INFINITY) {
  const due = await db.select({ schedule: reportSchedules, currency: organizations.currency,
    venueName: organizations.name, displayName: organizations.displayName })
    .from(reportSchedules).innerJoin(organizations, eq(organizations.id, reportSchedules.organizationId))
    .where(and(eq(reportSchedules.isActive, true), lte(reportSchedules.nextRunAt, now)))
    .orderBy(asc(reportSchedules.nextRunAt)).limit(20);
  let processed = 0, previews = 0, sent = 0, failed = 0;
  for (const { schedule, currency, venueName, displayName } of due) {
    if (Date.now() >= deadlineAt) break;
    try {
      await requireOrganizationFeature(db, schedule.organizationId, "SCHEDULED_REPORTS");
      const period = reportPeriod(schedule.frequency as "WEEKLY" | "MONTHLY", schedule.timezone, schedule.nextRunAt);
      const allBranches = !schedule.branchId && await hasOrganizationFeature(db, schedule.organizationId, "MULTI_BRANCH");
      const content = allBranches ? executiveReportEmail(schedule.name, period,
        await proExecutiveReport(db, schedule.createdByUserId, schedule.organizationId,
          { range: "custom", from: period.from, to: period.to }, schedule.nextRunAt), displayName || venueName) :
        reportEmail(schedule.name, period, await professionalReport(db, schedule.organizationId,
          { range: "custom", from: period.from, to: period.to,
            branchId: schedule.branchId ?? undefined }, schedule.nextRunAt), currency, schedule.reportType, displayName || venueName);
      let exhaustedBudget = false;
      for (const recipient of schedule.recipients) {
        if (Date.now() >= deadlineAt) { exhaustedBudget = true; break; }
        const [delivery] = await db.insert(reportDeliveries).values({
          organizationId: schedule.organizationId, scheduleId: schedule.id, periodStart: period.from,
          periodEnd: period.to, recipient, status: "PROCESSING", claimedAt: now,
        }).onConflictDoNothing().returning();
        if (!delivery) continue;
        try {
          const outcome = await deliverEmail({ to: recipient, ...content, idempotencyKey: delivery.id });
          await db.update(reportDeliveries).set({ status: outcome.status,
            providerMessageId: outcome.providerMessageId, failureReason: outcome.reason,
            sentAt: outcome.status === "SENT" ? new Date() : null, updatedAt: new Date() })
            .where(eq(reportDeliveries.id, delivery.id));
          if (outcome.status === "SENT") sent += 1;
          if (outcome.status === "DEV_PREVIEW") previews += 1;
          if (outcome.status === "FAILED") failed += 1;
        } catch {
          failed += 1;
          await db.update(reportDeliveries).set({ status: "FAILED", failureReason: "Email provider request failed",
            updatedAt: new Date() }).where(eq(reportDeliveries.id, delivery.id));
        }
      }
      // Leave the period due when the time budget ends; the unique recipient claims skip completed work next run.
      if (exhaustedBudget) break;
      await db.update(reportSchedules).set({ nextRunAt: nextReportRun(
        schedule.frequency as "WEEKLY" | "MONTHLY", schedule.timezone, schedule.nextRunAt), updatedAt: new Date() })
        .where(and(eq(reportSchedules.organizationId, schedule.organizationId), eq(reportSchedules.id, schedule.id)));
      processed += 1;
    } catch {
      failed += 1;
      // Keep due for retry; no fabricated delivery or schedule advance.
    }
  }
  return { processed, sent, previews, failed, emailConfigured: emailReady() };
}
