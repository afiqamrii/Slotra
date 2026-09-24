import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { resources, waitlistEntries } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const metadata: Metadata = { title: "Waitlist" };
export default async function WaitlistPage() {
  const { organization } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "WAITLIST")) redirect("/grow");
  const entries = await db.select({ entry: waitlistEntries, space: resources.name }).from(waitlistEntries)
    .innerJoin(resources, and(eq(resources.organizationId, orgId), eq(resources.id, waitlistEntries.resourceId)))
    .where(eq(waitlistEntries.organizationId, orgId)).orderBy(waitlistEntries.createdAt).limit(100);
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / WAITLIST</p><h1>Waitlist</h1>
    <p className="foundation-lead">Guests can request a notification when a full time opens. The waitlist does not hold a space; booking is first come, first served.</p>
    <section className="foundation-card grow-list-card"><h2>Recent requests</h2>{entries.length ?
      <div className="grow-list">{entries.map(({ entry, space }) => <div key={entry.id}>
        <div><strong>{entry.name}</strong><small>{space} · {entry.phone}</small></div>
        <span>{entry.startAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</span>
        <b>{entry.status === "NOTIFIED" ? "Notified" : entry.status === "WAITING" ? "Waiting" : entry.status.toLowerCase()}</b>
      </div>)}</div> : <p className="grow-empty">No waitlist requests yet. When a guest taps “Notify me” on a full time, it appears here.</p>}</section>
    <p className="grow-form-help">Email alerts require a configured email provider. Without one, entries stay waiting; no delivery is claimed.</p>
  </div>;
}
