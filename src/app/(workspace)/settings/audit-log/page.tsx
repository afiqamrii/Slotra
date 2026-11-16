import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches, organizationMembers, users } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { listAuditLogs } from "@/lib/pro-access-service";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const dynamic = "force-dynamic";
type Params = { branchId?: string; actorUserId?: string; action?: string; entityType?: string;
  from?: string; to?: string; page?: string };
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organization, session } = await requirePermission("audit:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "AUDIT_LOGS")) return <div className="foundation-page"><h1>Audit log</h1>
    <p>Available on Pro.</p></div>;
  const params = await searchParams;
  const [logs, locations, actors] = await Promise.all([
    listAuditLogs(db, session.user.id, organizationId, params),
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.organizationId, organizationId)),
    db.select({ id: users.id, name: users.name }).from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, organizationId)),
  ]);
  return <div className="foundation-page pro-settings-page"><Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">PRO / ACCOUNTABILITY</p><h1>Audit log</h1>
    <p className="foundation-lead">Important changes across your venue, newest first. Secrets and payment credentials are never shown here.</p>
    <form method="get" className="pro-filter-row"><label className="field">Branch<select name="branchId" defaultValue={params.branchId ?? ""}>
      <option value="">All branches</option>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field">Person<select name="actorUserId" defaultValue={params.actorUserId ?? ""}><option value="">Everyone</option>
        {actors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field">Action<input name="action" defaultValue={params.action ?? ""} placeholder="e.g. role.created" /></label>
      <label className="field">Type<input name="entityType" defaultValue={params.entityType ?? ""} placeholder="e.g. booking" /></label>
      <label className="field">From (UTC)<input type="date" name="from" defaultValue={params.from ?? ""} /></label>
      <label className="field">To (UTC)<input type="date" name="to" defaultValue={params.to ?? ""} /></label>
      <button className="button button-secondary">Filter</button></form>
    <section className="foundation-card">{logs.length ? <div className="data-list">{logs.map(log =>
      <div className="data-row" key={log.id}><span><strong>{log.summary}</strong><small>{log.action} · {log.entityType}
        {log.branchName ? ` · ${log.branchName}` : ""}</small></span><span className="pro-audit-meta">{log.actorName ?? "System"}<br />
        {log.createdAt.toLocaleString("en-MY")}</span></div>)}</div> : <p>No activity matches these filters.</p>}</section>
    {logs.length === 50 && <Link className="button button-secondary" href={"/settings/audit-log?" + new URLSearchParams({
      ...params, page: String(Number(params.page ?? 1) + 1),
    })}>Next page</Link>}
  </div>;
}
