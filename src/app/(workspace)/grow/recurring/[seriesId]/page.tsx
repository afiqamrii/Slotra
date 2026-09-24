import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { bookings, recurringSeries, resources } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { rescheduleFutureAction } from "../../actions";

export const metadata: Metadata = { title: "Weekly Series" };
export default async function SeriesPage({ params, searchParams }: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string; updated?: string; conflicts?: string }>;
}) {
  const { organization, member } = await requirePermission("booking:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "RECURRING_BOOKINGS")) redirect("/grow");
  const { seriesId } = await params;
  const [series] = await db.select().from(recurringSeries).where(and(
    eq(recurringSeries.organizationId, orgId), eq(recurringSeries.id, seriesId))).limit(1);
  if (!series) notFound();
  const [instances, spaces, query] = await Promise.all([
    db.select({ id: bookings.id, startAt: bookings.startAt, status: bookings.status, resource: resources.name })
      .from(bookings).innerJoin(resources, and(eq(resources.organizationId, orgId), eq(resources.id, bookings.resourceId)))
      .where(and(eq(bookings.organizationId, orgId), eq(bookings.recurringSeriesId, seriesId)))
      .orderBy(bookings.startAt),
    db.select({ id: resources.id, name: resources.name }).from(resources)
      .where(and(eq(resources.organizationId, orgId), eq(resources.branchId, series.branchId), eq(resources.status, "ACTIVE")))
      .orderBy(resources.name),
    searchParams,
  ]);
  const canEdit = hasPermission(member.role, "booking:update");
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow/recurring">← Weekly bookings</Link>
    <p className="eyebrow">GROW / RECURRING</p><h1>Weekly series</h1>
    <p className="foundation-lead">Each date is a separate booking. You can change one date in its booking detail, or update this and future dates here.</p>
    {query.error && <p className="pro-error" role="alert">{query.error}</p>}
    {query.updated && <p className="pro-success" role="status">{query.updated} bookings updated{Number(query.conflicts) ? `; ${query.conflicts} could not be changed` : ""}.</p>}
    <section className="foundation-card grow-list-card"><h2>Dates in this series</h2><div className="grow-list">
      {instances.map(item => <div key={item.id}><div><strong>{item.startAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</strong>
        <small>{item.resource} · {item.status.replaceAll("_", " ")}</small></div>
        <Link href={"/bookings/" + item.id + "/reschedule"}>Edit this date</Link></div>)}</div></section>
    {canEdit && instances.length > 0 && <section className="foundation-card grow-form-card"><h2>Edit this and future dates</h2>
      <form action={rescheduleFutureAction} className="grow-form"><input type="hidden" name="seriesId" value={series.id} />
        <label>Start with<select name="fromBookingId">{instances.map(item => <option key={item.id} value={item.id}>
          {item.startAt.toLocaleDateString("en-MY", { dateStyle: "medium" })} · {item.resource}</option>)}</select></label>
        <label>Space<select name="resourceId" defaultValue={series.resourceId}>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
        <div className="grow-form-pair"><label>New start time<input name="localTime" type="time" required defaultValue={series.localTime} /></label>
          <label>Duration · minutes<input name="durationMinutes" type="number" min="30" max="480" step="30" required defaultValue={series.durationMinutes} /></label></div>
        <p className="grow-form-help">Every affected booking is rechecked by the booking engine. Conflicts remain unchanged; some dates may update while others do not.</p>
        <button className="button button-primary" type="submit">Update future bookings</button>
      </form></section>}
  </div>;
}
