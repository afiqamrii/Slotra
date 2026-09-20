import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { reportDeliveries } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { emailReady } from "@/lib/email-delivery";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { listReportSchedules } from "@/lib/scheduled-reports";
import { addReportSchedule, changeReportSchedule } from "./actions";

export default async function ReportSchedulesPage({ searchParams }: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { organization } = await requirePermission("report:manage_schedule");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "SCHEDULED_REPORTS")) notFound();
  const [schedules, deliveries, params] = await Promise.all([
    listReportSchedules(db, organizationId),
    db.select({ scheduleId: reportDeliveries.scheduleId, status: reportDeliveries.status,
      recipient: reportDeliveries.recipient, periodEnd: reportDeliveries.periodEnd })
      .from(reportDeliveries).where(eq(reportDeliveries.organizationId, organizationId))
      .orderBy(desc(reportDeliveries.createdAt)).limit(20),
    searchParams,
  ]);
  const latest = new Map(deliveries.map(item => [item.scheduleId, item]));
  return <div className="foundation-page pro-reports"><Link href="/reports" className="text-link">← Reports</Link>
    <div className="pro-page-head"><div><p className="eyebrow">PROFESSIONAL / REPORTS</p><h1>Scheduled reports</h1>
      <p>Send a clear weekly or monthly summary to your team.</p></div></div>
    {!emailReady() && <div className="pro-delivery-notice"><strong>Email delivery is not configured in this environment.</strong><p>You can prepare schedules, but no email will be delivered until a verified sender and Resend API key are configured and the report runner is enabled. Development runs are previews only.</p></div>}
    {params.created && <p className="pro-success">Schedule saved. Its next run is shown below.</p>}
    {params.error && <p className="pro-error">Couldn’t save that schedule. Check the name, up to five valid email addresses, and try again.</p>}
    <div className="pro-two-columns"><section className="foundation-card pro-panel"><p className="eyebrow">NEW SCHEDULE</p><h2>What should we send?</h2>
      <form action={addReportSchedule} className="pro-schedule-form"><label>Name<input name="name" required maxLength={80} placeholder="Weekly venue summary" /></label>
        <label>Report<select name="reportType" defaultValue="OVERVIEW"><option value="OVERVIEW">Overview</option><option value="REVENUE">Revenue</option><option value="BOOKINGS">Bookings</option><option value="RESOURCES">Courts & spaces</option><option value="CUSTOMERS">Customers</option></select></label>
        <label>Frequency<select name="frequency" defaultValue="WEEKLY"><option value="WEEKLY">Weekly · Monday 9:00 AM</option><option value="MONTHLY">Monthly · 1st at 9:00 AM</option></select></label>
        <label>Recipients <small>Separate up to 5 emails with commas</small><input name="recipients" type="text" required placeholder="owner@example.com, manager@example.com" /></label>
        <button className="button button-primary">Save schedule</button></form>
      <p className="pro-note">Times follow your branch timezone. Weekly reports cover the previous Monday–Sunday; monthly reports cover the previous calendar month.</p></section>
      <section className="foundation-card pro-panel"><p className="eyebrow">YOUR SCHEDULES</p><h2>Upcoming reports</h2>
        {schedules.length ? <div className="pro-schedule-list">{schedules.map(schedule => <div key={schedule.id}><div><strong>{schedule.name}</strong><small>{schedule.reportType.toLowerCase()} · {schedule.frequency.toLowerCase()} · {schedule.recipients.join(", ")}</small><small>Next: {schedule.nextRunAt.toLocaleString("en-MY", { timeZone: schedule.timezone })} ({schedule.timezone})</small>{latest.get(schedule.id) && <small>Last attempt: {latest.get(schedule.id)!.status.replaceAll("_", " ")} · {latest.get(schedule.id)!.periodEnd}</small>}</div><form action={changeReportSchedule}><input type="hidden" name="id" value={schedule.id} /><input type="hidden" name="active" value={schedule.isActive ? "false" : "true"} /><button className="button button-secondary">{schedule.isActive ? "Pause" : "Resume"}</button></form></div>)}</div> :
          <p className="pro-empty">No schedules yet. Create one when you’re ready to keep your team informed.</p>}</section></div>
  </div>;
}
