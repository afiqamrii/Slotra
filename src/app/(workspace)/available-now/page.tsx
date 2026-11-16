import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { staffAvailableNow } from "@/lib/booking-management";
import { branchContext } from "@/lib/branch-context";
import { authorizedMembership } from "@/lib/organization-service";
import { normalizeCalendarQuery } from "@/lib/calendar-presentation";
import { AvailableNowBoard } from "@/components/available-now-board";

export const metadata: Metadata = { title: "Available Now" };
export default async function AvailableNowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization, session } = await requirePermission("booking:view");
  const { branchId } = normalizeCalendarQuery(await searchParams);
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const data = await staffAvailableNow(getDb(), session.user.id, organization.organizationId,
    branchId ?? (selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined));
  const createAccess = data.branch ? await authorizedMembership(getDb(), session.user.id, organization.organizationId, "booking:create", data.branch.id) : null;
  return <div className="booking-ops-page"><header className="booking-page-head"><div><p className="eyebrow">OPERATIONS</p><h1>Available Now</h1><p>See what is open, in use or blocked. Choose a space to check session times.</p></div>
    <Link className="button button-secondary" href={"/calendar?" + new URLSearchParams({ view: "agenda", ...(data.branch ? { branchId: data.branch.id } : {}) })}><CalendarDays size={17} aria-hidden /> View calendar</Link></header>
    {data.branches.length > 1 && <nav className="booking-tabs" aria-label="Choose branch">{data.branches.map(item => <Link key={item.id} className={item.id === data.branch?.id ? "booking-tab active" : "booking-tab"} aria-current={item.id === data.branch?.id ? "page" : undefined} href={"/available-now?branchId=" + item.id}>{item.name}{item.isActive ? "" : " (inactive)"}</Link>)}</nav>}
    {data.branch ? <AvailableNowBoard key={data.branch.id} spaces={data.spaces.map(space => ({ ...space, until: space.until?.toISOString() ?? null }))}
      branchId={data.branch.id} branchName={data.branch.name} branchActive={data.branch.isActive} timezone={data.branch.timezone} at={data.at.toISOString()} canCreate={!!createAccess && data.branch.isActive} /> :
      <div className="booking-empty"><h2>No branch configured</h2><p>Add a branch and courts or spaces to see their current status.</p></div>}
  </div>;
}
