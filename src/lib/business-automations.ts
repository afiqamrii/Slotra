import "server-only";

import { and, asc, eq, gt, inArray, lte, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import {
  automationExecutions, automationWorkflows, bookings, branches, customers, customerTags,
  organizations, resources,
} from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { BookingError } from "@/lib/booking-availability";
import { bookingDate, bookingTime } from "@/lib/booking-format";
import { deliverEmail, emailReady, escapeEmailHtml } from "@/lib/email-delivery";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";

const workflowTemplate = z.enum(["REMINDER_24_HOURS", "REMINDER_2_HOURS", "INACTIVE_30_DAYS"]);
export type AutomationTemplate = z.infer<typeof workflowTemplate>;
const templateSettings = {
  REMINDER_24_HOURS: { name: "24-hour booking reminder", trigger: "BOOKING_REMINDER", action: "EMAIL_REMINDER",
    config: { leadMinutes: 1440 } },
  REMINDER_2_HOURS: { name: "2-hour booking reminder", trigger: "BOOKING_REMINDER", action: "EMAIL_REMINDER",
    config: { leadMinutes: 120 } },
  INACTIVE_30_DAYS: { name: "Inactive for 30 days", trigger: "CUSTOMER_INACTIVE", action: "TAG_INACTIVE",
    config: { inactiveDays: 30 } },
} as const;
const activeBookingStatuses = ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW"] as const;
const dueWindowMinutes = 30;

async function requireAutomationOwner(database: BookingDatabase, actorId: string, organizationId: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:update"))
    throw new BookingError("PERMISSION_DENIED", "You cannot manage automations.");
  await requireOrganizationFeature(database, organizationId, "AUTOMATIONS");
}

export async function createAutomationWorkflow(database: BookingDatabase, actorId: string,
  organizationId: string, raw: unknown) {
  await requireAutomationOwner(database, actorId, organizationId);
  const template = workflowTemplate.parse(raw);
  const settings = templateSettings[template];
  return database.transaction(async tx => {
    const [venue] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!venue) throw new BookingError("ORGANIZATION_NOT_FOUND", "Venue not found.");
    const existing = await tx.select().from(automationWorkflows)
      .where(eq(automationWorkflows.organizationId, organizationId)).limit(10);
    const same = existing.find(row => row.trigger === settings.trigger && row.action === settings.action &&
      JSON.stringify(row.config) === JSON.stringify(settings.config));
    if (same) return same;
    if (existing.length >= 10) throw new BookingError("AUTOMATION_LIMIT", "You can set up to 10 automations.");
    const [created] = await tx.insert(automationWorkflows).values({
      organizationId, createdByUserId: actorId, ...settings,
    }).returning();
    return created;
  });
}

export async function listAutomationWorkflows(database: BookingDatabase, actorId: string, organizationId: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:view"))
    throw new BookingError("PERMISSION_DENIED", "Automation access denied.");
  await requireOrganizationFeature(database, organizationId, "AUTOMATIONS");
  return database.select().from(automationWorkflows).where(eq(automationWorkflows.organizationId, organizationId))
    .orderBy(asc(automationWorkflows.createdAt)).limit(10);
}

export async function listAutomationExecutions(database: BookingDatabase, actorId: string, organizationId: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "organization:view"))
    throw new BookingError("PERMISSION_DENIED", "Automation access denied.");
  await requireOrganizationFeature(database, organizationId, "AUTOMATIONS");
  return database.select({ execution: automationExecutions, workflowName: automationWorkflows.name })
    .from(automationExecutions).innerJoin(automationWorkflows, and(
      eq(automationExecutions.workflowId, automationWorkflows.id),
      eq(automationExecutions.organizationId, automationWorkflows.organizationId)))
    .where(eq(automationExecutions.organizationId, organizationId))
    .orderBy(sql`${automationExecutions.createdAt} desc`).limit(20);
}

export async function setAutomationActive(database: BookingDatabase, actorId: string,
  organizationId: string, workflowId: string, active: boolean) {
  await requireAutomationOwner(database, actorId, organizationId);
  const id = z.uuid().parse(workflowId);
  const [updated] = await database.update(automationWorkflows).set({ isActive: active, updatedAt: new Date() })
    .where(and(eq(automationWorkflows.organizationId, organizationId), eq(automationWorkflows.id, id))).returning();
  if (!updated) throw new BookingError("AUTOMATION_NOT_FOUND", "Automation not found.");
  return updated;
}

type Workflow = typeof automationWorkflows.$inferSelect;
type RunCounts = { workflows: number; sent: number; previews: number; tagged: number; skipped: number; failed: number };

/** The unique workflow/runKey claim is created before delivery. A repeated scheduler call never sends twice. */
async function claimExecution(database: BookingDatabase, workflow: Workflow, runKey: string,
  target: { bookingId?: string; customerId?: string }) {
  const [claim] = await database.insert(automationExecutions).values({
    organizationId: workflow.organizationId, workflowId: workflow.id, runKey, ...target,
  }).onConflictDoNothing().returning();
  return claim ?? null;
}

async function finishExecution(database: BookingDatabase, organizationId: string, executionId: string,
  status: "SENT" | "DEV_PREVIEW" | "FAILED" | "SKIPPED", reason: string | null, now: Date) {
  await database.update(automationExecutions).set({ status, errorSummary: reason,
    executedAt: now, updatedAt: now }).where(and(
    eq(automationExecutions.organizationId, organizationId), eq(automationExecutions.id, executionId)));
}

async function runBookingReminders(database: BookingDatabase, workflow: Workflow, now: Date, counts: RunCounts) {
  const leadMinutes = workflow.config.leadMinutes;
  if (!Number.isInteger(leadMinutes) || leadMinutes! < 1 || leadMinutes! > 10080) return;
  // A bounded look-ahead prevents a forgotten scheduler from sending a "24-hour" notice just before play.
  const dueStart = new Date(now.getTime() + leadMinutes! * 60_000);
  const dueAfter = new Date(dueStart.getTime() - dueWindowMinutes * 60_000);
  const candidates = await database.select({
    booking: bookings, customerEmail: customers.email, customerName: customers.name,
    venueName: organizations.name, displayName: organizations.displayName,
    timezone: branches.timezone, resourceName: resources.name,
  }).from(bookings)
    .innerJoin(organizations, eq(bookings.organizationId, organizations.id))
    .innerJoin(branches, and(eq(bookings.branchId, branches.id), eq(bookings.organizationId, branches.organizationId)))
    .innerJoin(resources, and(eq(bookings.resourceId, resources.id), eq(bookings.organizationId, resources.organizationId)))
    .leftJoin(customers, and(eq(bookings.customerId, customers.id), eq(bookings.organizationId, customers.organizationId)))
    .where(and(eq(bookings.organizationId, workflow.organizationId), eq(bookings.status, "CONFIRMED"),
      gt(bookings.startAt, dueAfter), lte(bookings.startAt, dueStart)))
    .orderBy(asc(bookings.startAt)).limit(100);
  for (const row of candidates) {
    const booking = row.booking;
    const runKey = `booking:${booking.id}:start:${booking.startAt.toISOString()}:lead:${leadMinutes}`;
    const claim = await claimExecution(database, workflow, runKey, { bookingId: booking.id });
    if (!claim) continue;
    if (!row.customerEmail) {
      await finishExecution(database, workflow.organizationId, claim.id, "SKIPPED",
        "No customer email supplied", now);
      counts.skipped += 1;
      continue;
    }
    const venueName = row.displayName || row.venueName;
    const lines = [
      `Reminder: your booking at ${venueName} is coming up.`,
      `${row.resourceName} · ${bookingDate(booking.startAt, row.timezone)} · ${bookingTime(booking.startAt, row.timezone)}–${bookingTime(booking.endAt, row.timezone)}`,
      `Booking reference: ${booking.bookingReference}`,
    ];
    const text = lines.join("\n");
    try {
      const delivered = await deliverEmail({
        to: row.customerEmail, subject: `Your booking reminder · ${venueName}`, text,
        html: `<p>Hello ${escapeEmailHtml(row.customerName || "there")},</p>${lines.map(line =>
          `<p>${escapeEmailHtml(line)}</p>`).join("")}`,
        idempotencyKey: claim.id,
      });
      await finishExecution(database, workflow.organizationId, claim.id, delivered.status,
        delivered.reason, now);
      if (delivered.status === "SENT") counts.sent += 1;
      else if (delivered.status === "DEV_PREVIEW") counts.previews += 1;
      else counts.failed += 1;
    } catch {
      await finishExecution(database, workflow.organizationId, claim.id, "FAILED",
        "Email provider request failed", now);
      counts.failed += 1;
    }
  }
}

async function runInactiveTags(database: BookingDatabase, workflow: Workflow, now: Date, counts: RunCounts) {
  const inactiveDays = workflow.config.inactiveDays;
  if (!Number.isInteger(inactiveDays) || inactiveDays! < 7 || inactiveDays! > 365) return;
  const cutoff = new Date(now.getTime() - inactiveDays! * 86_400_000);
  const inactiveTag = database.select({ id: customerTags.id }).from(customerTags).where(and(
    eq(customerTags.organizationId, workflow.organizationId), eq(customerTags.customerId, customers.id),
    sql`lower(${customerTags.label}) = 'inactive'`));
  const rows = await database.select({ id: customers.id, lastBookingAt: sql<Date>`max(${bookings.startAt})` })
    .from(customers).innerJoin(bookings, and(
      eq(bookings.organizationId, customers.organizationId), eq(bookings.customerId, customers.id),
      inArray(bookings.status, activeBookingStatuses)))
    // The inner join excludes customers who never booked. Cancelled and expired bookings do not count.
    .where(and(eq(customers.organizationId, workflow.organizationId), notExists(inactiveTag)))
    .groupBy(customers.id)
    .having(lte(sql<Date>`max(${bookings.startAt})`, cutoff))
    .orderBy(asc(sql`max(${bookings.startAt})`)).limit(100);
  for (const row of rows) {
    const runKey = `customer:${row.id}:last:${new Date(row.lastBookingAt).toISOString()}:days:${inactiveDays}`;
    const claim = await claimExecution(database, workflow, runKey, { customerId: row.id });
    if (!claim) continue;
    try {
      const [tag] = await database.insert(customerTags).values({
        organizationId: workflow.organizationId, customerId: row.id, label: "Inactive",
        createdByUserId: workflow.createdByUserId,
      }).onConflictDoNothing().returning({ id: customerTags.id });
      await finishExecution(database, workflow.organizationId, claim.id, tag ? "SENT" : "SKIPPED",
        tag ? null : "Customer already tagged", now);
      if (tag) counts.tagged += 1;
      else counts.skipped += 1;
    } catch {
      await finishExecution(database, workflow.organizationId, claim.id, "FAILED",
        "Could not update customer tag", now);
      counts.failed += 1;
    }
  }
}

/** Invoked only by the secret-protected internal route; never from a booking transaction. */
export async function runDueBusinessAutomations(database: BookingDatabase, now = new Date()) {
  const counts: RunCounts = { workflows: 0, sent: 0, previews: 0, tagged: 0, skipped: 0, failed: 0 };
  const workflows = await database.select({ workflow: automationWorkflows, organizationActive: organizations.isActive })
    .from(automationWorkflows).innerJoin(organizations, eq(automationWorkflows.organizationId, organizations.id))
    .where(eq(automationWorkflows.isActive, true))
    .orderBy(sql`${automationWorkflows.lastRunAt} nulls first`, asc(automationWorkflows.createdAt)).limit(20);
  for (const { workflow, organizationActive } of workflows) {
    if (!organizationActive || !await hasOrganizationFeature(database, workflow.organizationId, "AUTOMATIONS")) continue;
    try {
      if (workflow.trigger === "BOOKING_REMINDER" && workflow.action === "EMAIL_REMINDER") {
        // Production email is opt-in at the deployment level; never claim a successful send without a provider.
        if (process.env.NODE_ENV === "production" && !emailReady()) continue;
        await runBookingReminders(database, workflow, now, counts);
      } else if (workflow.trigger === "CUSTOMER_INACTIVE" && workflow.action === "TAG_INACTIVE") {
        await runInactiveTags(database, workflow, now, counts);
      }
      await database.update(automationWorkflows).set({ lastRunAt: now, updatedAt: now }).where(and(
        eq(automationWorkflows.organizationId, workflow.organizationId), eq(automationWorkflows.id, workflow.id)));
      counts.workflows += 1;
    } catch {
      counts.failed += 1;
      // Keep lastRunAt unchanged so a later run can recover; individual run keys stay idempotent.
    }
  }
  return { ...counts, emailConfigured: emailReady() };
}
