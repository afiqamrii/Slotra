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
import { deliverEmail, emailReady, escapeEmailHtml } from "@/lib/email-delivery";
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
  report: Awaited<ReturnType<typeof professionalReport>>, currency: string, type: string) {
  const lines = [`${name} · ${type.toLowerCase()} report`,
    `${period.from} to ${period.to} (${report.timezone})`];
  if (type === "OVERVIEW" || type === "REVENUE") lines.push(
    `Booking value: ${bookingMoney(report.totals.bookingValue, currency)}`,
    `Collected: ${bookingMoney(report.totals.collected, currency)}`,
    `Outstanding: ${bookingMoney(report.totals.outstanding, currency)}`);
  if (type === "OVERVIEW" || type === "BOOKINGS") lines.push(
    `Bookings: ${report.totals.bookings}`, `Completed: ${report.totals.completed}`,
    `Cancelled: ${report.totals.cancelled}`, `No-shows: ${report.totals.noShows}`);
  if (type === "OVERVIEW" || type === "RESOURCES") lines.push(
    `Utilisation: ${report.utilization.percent === null ? "Not available" : `${report.utilization.percent}%`}`,
    ...report.utilization.resources.map(item => `${item.name}: ${item.percent === null ? "Not available" : `${item.percent}%`}`));
  if (type === "OVERVIEW" || type === "CUSTOMERS") lines.push(
    `New customers: ${report.customers.new}; returning: ${report.customers.returning}`);
  const text = lines.join("\n");
  return { text, html: `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#173c42">${lines.map((line, index) =>
    index === 0 ? `<h1>${escapeEmailHtml(line)}</h1>` : `<p>${escapeEmailHtml(line)}</p>`).join("")}</div>` };
}
function executiveReportEmail(name: string, period: { from: string; to: string },
  report: Awaited<ReturnType<typeof proExecutiveReport>>) {
  const money = (amount: number) => bookingMoney(amount, report.currency);
  const lines = [`${name} · All Branches overview`, `${period.from} to ${period.to}`,
    `Bookings: ${report.totals.bookings}`, `Booking value: ${money(report.totals.bookingValue)}`,
    `Collected: ${money(report.totals.collected)}`, `Outstanding: ${money(report.totals.outstanding)}`,
    `Utilisation: ${report.totals.utilization === null ? "Not available" : `${report.totals.utilization}%`}`,
    ...report.branches.map(branch => `${branch.name}: ${branch.bookings} bookings · ${money(branch.bookingValue)}`)];
  return { text: lines.join("\n"), html: `<div style="font-family:Arial,sans-serif;line-height:1.65;color:#173c42">${lines.map((line, index) =>
    index === 0 ? `<h1>${escapeEmailHtml(line)}</h1>` : `<p>${escapeEmailHtml(line)}</p>`).join("")}</div>` };
}
export async function runDueReports(db: BookingDatabase, now = new Date()) {
  const due = await db.select({ schedule: reportSchedules, currency: organizations.currency })
    .from(reportSchedules).innerJoin(organizations, eq(organizations.id, reportSchedules.organizationId))
    .where(and(eq(reportSchedules.isActive, true), lte(reportSchedules.nextRunAt, now)))
    .orderBy(asc(reportSchedules.nextRunAt)).limit(20);
  let processed = 0, previews = 0, sent = 0, failed = 0;
  for (const { schedule, currency } of due) {
    try {
      await requireOrganizationFeature(db, schedule.organizationId, "SCHEDULED_REPORTS");
      const period = reportPeriod(schedule.frequency as "WEEKLY" | "MONTHLY", schedule.timezone, schedule.nextRunAt);
      const allBranches = !schedule.branchId && await hasOrganizationFeature(db, schedule.organizationId, "MULTI_BRANCH");
      const content = allBranches ? executiveReportEmail(schedule.name, period,
        await proExecutiveReport(db, schedule.createdByUserId, schedule.organizationId,
          { range: "custom", from: period.from, to: period.to }, schedule.nextRunAt)) :
        reportEmail(schedule.name, period, await professionalReport(db, schedule.organizationId,
          { range: "custom", from: period.from, to: period.to,
            branchId: schedule.branchId ?? undefined }, schedule.nextRunAt), currency, schedule.reportType);
      for (const recipient of schedule.recipients) {
        const [delivery] = await db.insert(reportDeliveries).values({
          organizationId: schedule.organizationId, scheduleId: schedule.id, periodStart: period.from,
          periodEnd: period.to, recipient, status: "PROCESSING", claimedAt: now,
        }).onConflictDoNothing().returning();
        if (!delivery) continue;
        try {
          const outcome = await deliverEmail({ to: recipient,
            subject: `${schedule.name} · ${period.from}–${period.to}`,
            ...content, idempotencyKey: delivery.id });
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
