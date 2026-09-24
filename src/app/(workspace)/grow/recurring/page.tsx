import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { branches, customers, recurringSeries, resources } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { previewRecurringBookings } from "@/lib/business-recurring";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { createRecurringAction } from "../actions";

export const metadata: Metadata = { title: "Recurring Bookings" };
type Params = { branchId?: string; resourceId?: string; customerId?: string; startDate?: string;
  endDate?: string; localTime?: string; durationMinutes?: string; error?: string; created?: string; conflicts?: string };
export default async function RecurringPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { session, organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "RECURRING_BOOKINGS")) redirect("/grow");
  const params = await searchParams;
  const [branch] = await db.select().from(branches).where(and(eq(branches.organizationId, orgId), eq(branches.isActive, true))).limit(1);
  const [spaces, people, series] = await Promise.all([
    db.select({ id: resources.id, name: resources.name, branchId: resources.branchId }).from(resources)
      .where(and(eq(resources.organizationId, orgId), eq(resources.status, "ACTIVE"))).orderBy(resources.name).limit(100),
    db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(customers.name).limit(200),
    db.select({ series: recurringSeries, customer: customers.name, resource: resources.name })
      .from(recurringSeries).leftJoin(customers, and(eq(customers.organizationId, orgId), eq(customers.id, recurringSeries.customerId)))
      .innerJoin(resources, and(eq(resources.organizationId, orgId), eq(resources.id, recurringSeries.resourceId)))
      .where(eq(recurringSeries.organizationId, orgId)).orderBy(recurringSeries.createdAt).limit(50),
  ]);
  const canEdit = hasPermission(member.role, "booking:create");
  const chosenSpace = spaces.find(space => space.id === params.resourceId && space.branchId === branch?.id);
  let preview: Awaited<ReturnType<typeof previewRecurringBookings>> | null = null;
  let previewError: string | null = null;
  if (canEdit && branch && chosenSpace && params.startDate && params.endDate && params.localTime) {
    try {
      preview = await previewRecurringBookings(db, session.user.id, orgId, {
        branchId: branch.id, resourceId: chosenSpace.id, customerId: params.customerId || null,
        startDate: params.startDate, endDate: params.endDate,
        weekday: Temporal.PlainDate.from(params.startDate).dayOfWeek % 7,
        localTime: params.localTime, durationMinutes: Number(params.durationMinutes),
      });
    } catch (error) { previewError = error instanceof BookingError ? error.message : "Check the dates and time."; }
  }
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / BOOKINGS</p><h1>Recurring bookings</h1>
    <p className="foundation-lead">Reserve the same space and time each week. Each week is a separate booking and counts toward your monthly limit.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.created && <p className="pro-success" role="status">{params.created} bookings created{Number(params.conflicts) ? `; ${params.conflicts} could not be booked` : ""}.</p>}
    {canEdit && branch && spaces.length > 0 && <section className="foundation-card grow-form-card"><h2>Choose a weekly time</h2>
      <form action="/grow/recurring" method="get" className="grow-form">
        <input type="hidden" name="branchId" value={branch.id} />
        <label>Space<select name="resourceId" required defaultValue={params.resourceId ?? ""}><option value="" disabled>Choose a space</option>
          {spaces.filter(space => space.branchId === branch.id).map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <label>Customer<select name="customerId" defaultValue={params.customerId ?? ""}><option value="">Walk-in / no customer</option>
          {people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.phone}</option>)}</select></label>
        <div className="grow-form-pair"><label>First date<input name="startDate" type="date" required defaultValue={params.startDate} /></label>
          <label>Last date · within 6 months<input name="endDate" type="date" required defaultValue={params.endDate} /></label></div>
        <div className="grow-form-pair"><label>Start time<input name="localTime" type="time" required defaultValue={params.localTime ?? "18:00"} /></label>
          <label>Duration<select name="durationMinutes" defaultValue={params.durationMinutes ?? "60"}>
            <option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1½ hours</option>
            <option value="120">2 hours</option><option value="180">3 hours</option></select></label></div>
        <button className="button button-secondary" type="submit">Check weekly times</button>
      </form></section>}
    {previewError && <p className="pro-error" role="alert">{previewError}</p>}
    {preview && <section className="foundation-card grow-list-card"><h2>Review the weeks</h2>
      <p><strong>{preview.available} available</strong> · {preview.unavailable} unavailable</p>
      <div className="grow-list">{preview.occurrences.map(item => <div key={item.date}><strong>{item.date}</strong>
        <span>{item.available ? "Available" : item.reason ?? "Unavailable"}</span></div>)}</div>
      {preview.available > 0 && <form action={createRecurringAction} className="grow-form">
        <input type="hidden" name="branchId" value={branch?.id} /><input type="hidden" name="resourceId" value={params.resourceId} />
        <input type="hidden" name="customerId" value={params.customerId ?? ""} />
        <input type="hidden" name="startDate" value={params.startDate} /><input type="hidden" name="endDate" value={params.endDate} />
        <input type="hidden" name="localTime" value={params.localTime} /><input type="hidden" name="durationMinutes" value={params.durationMinutes} />
        {preview.unavailable > 0 && <label className="grow-check"><input type="checkbox" name="skipConflicts" required /> Book only the available weeks</label>}
        <p className="grow-form-help">Times are checked again on save. If someone books first, that week will be reported as a conflict.</p>
        <button className="button button-primary" type="submit">Create {preview.available} bookings</button>
      </form>}</section>}
    <section className="foundation-card grow-list-card"><h2>Weekly series</h2>{series.length ? <div className="grow-list">{series.map(row =>
      <div key={row.series.id}><div><strong>{row.resource}</strong><small>{row.customer ?? "Walk-in"} · {row.series.status}</small></div>
        <span>{row.series.startDate} – {row.series.endDate} · {row.series.localTime}</span>
        <Link href={"/grow/recurring/" + row.series.id}>View dates →</Link></div>)}</div> :
      <p className="grow-empty">No weekly series yet.</p>}</section>
  </div>;
}
